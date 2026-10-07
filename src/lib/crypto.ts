// Real end-to-end encryption in the browser (WebCrypto).
//
// Key hierarchy for one patient:
//   category key (AES-KW 256, versioned)  -- one per patient per data category
//     wraps -> entry key (AES-GCM 256)     -- one per record entry
//                encrypts -> entry content
//   category keys are wrapped (RSA-OAEP) to each connected hospital's public key
//   and to the emergency escrow. Entry keys are also wrapped to the author
//   hospital, so a removed hospital can still read only what it wrote itself.

import type { EntryPayload, Sealed } from "./types";

const subtle = () => globalThis.crypto.subtle;

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const RSA: RsaHashedKeyGenParams = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

export async function generateKeyPair(extractable = false): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey; spki: string }> {
  const pair = await subtle().generateKey(RSA, extractable, ["wrapKey", "unwrapKey"]);
  const spki = toB64(await subtle().exportKey("spki", pair.publicKey));
  return { publicKey: pair.publicKey, privateKey: pair.privateKey, spki };
}

// ---- Emergency escrow: S + R + I ----
// The escrow private key is encrypted under K = S xor R xor I. SehatLog holds S, both
// regulators hold R, both independent bodies hold I, so a release always needs
// SehatLog + one regulator + one independent body. (Production uses threshold
// decryption so the parts are never combined in one place.)

export type EscrowParts = { S: Uint8Array<ArrayBuffer>; R: Uint8Array<ArrayBuffer>; I: Uint8Array<ArrayBuffer> };

function xor3(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = a[i] ^ b[i] ^ c[i];
  return out;
}

const escrowAad = (recordId: string) => new TextEncoder().encode(`sehatlog/escrow|${recordId}`);

export async function sealEscrowPrivateKey(privateKey: CryptoKey, recordId: string): Promise<{ parts: EscrowParts; ciphertext: string; iv: string }> {
  const parts = { S: rand32(), R: rand32(), I: rand32() };
  const k = await subtle().importKey("raw", xor3(parts.S, parts.R, parts.I), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pkcs8 = await subtle().exportKey("pkcs8", privateKey);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: escrowAad(recordId) }, k, pkcs8);
  return { parts, ciphertext: toB64(ct), iv: toB64(iv) };
}

export async function openEscrowPrivateKey(sealed: { ciphertext: string; iv: string }, parts: EscrowParts, recordId: string): Promise<CryptoKey> {
  const k = await subtle().importKey("raw", xor3(parts.S, parts.R, parts.I), "AES-GCM", false, ["decrypt"]);
  const pkcs8 = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv), additionalData: escrowAad(recordId) }, k, fromB64(sealed.ciphertext));
  return subtle().importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["unwrapKey"]);
}

function rand32(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function shortFingerprint(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const h = new Uint8Array(await subtle().digest("SHA-256", bytes));
  return Array.from(h.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function importPublicKey(spki: string): Promise<CryptoKey> {
  return subtle().importKey("spki", fromB64(spki), { name: "RSA-OAEP", hash: "SHA-256" }, true, ["wrapKey"]);
}

export function generateCategoryKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-KW", length: 256 }, true, ["wrapKey", "unwrapKey"]) as Promise<CryptoKey>;
}

export async function wrapForPublicKey(key: CryptoKey, publicKey: CryptoKey): Promise<string> {
  return toB64(await subtle().wrapKey("raw", key, publicKey, { name: "RSA-OAEP" }));
}

export function unwrapCategoryKey(wrapped: string, privateKey: CryptoKey): Promise<CryptoKey> {
  return subtle().unwrapKey("raw", fromB64(wrapped), privateKey, { name: "RSA-OAEP" }, { name: "AES-KW" }, true, [
    "wrapKey",
    "unwrapKey",
  ]);
}

export async function seal(
  payload: EntryPayload,
  categoryKey: CryptoKey,
  keyVersion: number,
  authorPublicKey: CryptoKey,
): Promise<Sealed> {
  const dek = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await subtle().encrypt({ name: "AES-GCM", iv }, dek, data);
  const wrappedDek = await subtle().wrapKey("raw", dek, categoryKey, "AES-KW");
  const authorWrappedDek = await subtle().wrapKey("raw", dek, authorPublicKey, { name: "RSA-OAEP" });
  return {
    ciphertext: toB64(ciphertext),
    iv: toB64(iv),
    keyVersion,
    wrappedDek: toB64(wrappedDek),
    authorWrappedDek: toB64(authorWrappedDek),
  };
}

async function decryptWithDek(sealed: Sealed, dek: CryptoKey): Promise<EntryPayload> {
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv) }, dek, fromB64(sealed.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain)) as EntryPayload;
}

export async function openWithCategoryKey(sealed: Sealed, categoryKey: CryptoKey): Promise<EntryPayload> {
  const dek = await subtle().unwrapKey("raw", fromB64(sealed.wrappedDek), categoryKey, "AES-KW", "AES-GCM", false, [
    "decrypt",
  ]);
  return decryptWithDek(sealed, dek);
}

export async function openAsAuthor(sealed: Sealed, hospitalPrivateKey: CryptoKey): Promise<EntryPayload> {
  const dek = await subtle().unwrapKey(
    "raw",
    fromB64(sealed.authorWrappedDek),
    hospitalPrivateKey,
    { name: "RSA-OAEP" },
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return decryptWithDek(sealed, dek);
}

// Keyed hash of a NIN so the database index cannot be read back as a citizen list.
export async function blindIndex(nin: string): Promise<string> {
  const key = await subtle().importKey(
    "raw",
    new TextEncoder().encode("demo-pepper-held-in-hsm"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await subtle().sign("HMAC", key, new TextEncoder().encode(nin));
  return Array.from(new Uint8Array(mac).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}
