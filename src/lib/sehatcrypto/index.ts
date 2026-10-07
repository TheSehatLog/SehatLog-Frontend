// SehatLog crypto spec v1, TypeScript implementation (WebCrypto).
// Spec and vectors: SehatLog-Backend/crypto-spec. Must match vectors.json byte for byte.
//
// Private keys are passed as raw bytes here so the implementation can be checked against
// the vectors. Production code keeps them as non-extractable CryptoKeys (device secure
// storage / hospital HSM) and only uses the byte form in tests.

type Bytes = Uint8Array<ArrayBuffer>;

const subtle = () => globalThis.crypto.subtle;
const enc = (s: string): Bytes => new TextEncoder().encode(s) as Bytes;

export const KEY_SIZE = 32;
export const NONCE_SIZE = 12;

export function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function b64urlToBytes(s: string): Bytes {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Bytes;
}

// ---- 1. Entry encryption ----

export function entryAad(recordId: string, category: string, keyVersion: number): Bytes {
  return enc(`sehatlog/v1/entry|${recordId}|${category}|${keyVersion}`);
}

async function gcmKey(raw: Bytes, usage: KeyUsage) {
  if (raw.length !== KEY_SIZE) throw new Error("sehatcrypto: key must be 32 bytes");
  return subtle().importKey("raw", raw, "AES-GCM", false, [usage]);
}

export async function sealEntry(dek: Bytes, nonce: Bytes, plaintext: Bytes, recordId: string, category: string, keyVersion: number): Promise<Bytes> {
  if (nonce.length !== NONCE_SIZE) throw new Error("sehatcrypto: nonce must be 12 bytes");
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: entryAad(recordId, category, keyVersion) }, await gcmKey(dek, "encrypt"), plaintext);
  return new Uint8Array(ct);
}

export async function openEntry(dek: Bytes, nonce: Bytes, ciphertext: Bytes, recordId: string, category: string, keyVersion: number): Promise<Bytes> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: nonce, additionalData: entryAad(recordId, category, keyVersion) }, await gcmKey(dek, "decrypt"), ciphertext);
  return new Uint8Array(pt);
}

// ---- 2. AES Key Wrap (RFC 3394) ----

export async function aesKwWrap(kek: Bytes, key: Bytes): Promise<Bytes> {
  const kw = await subtle().importKey("raw", kek, "AES-KW", false, ["wrapKey"]);
  const k = await subtle().importKey("raw", key, "AES-GCM", true, ["encrypt"]);
  return new Uint8Array(await subtle().wrapKey("raw", k, kw, "AES-KW"));
}

export async function aesKwUnwrap(kek: Bytes, wrapped: Bytes): Promise<Bytes> {
  const kw = await subtle().importKey("raw", kek, "AES-KW", false, ["unwrapKey"]);
  const k = await subtle().unwrapKey("raw", wrapped, kw, "AES-KW", "AES-GCM", true, ["encrypt"]);
  return new Uint8Array(await subtle().exportKey("raw", k));
}

// ---- 3. Wrapping to an X25519 public key ----

const X25519_PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]);
const ED25519_PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

async function x25519Private(priv: Bytes) {
  return subtle().importKey("pkcs8", concat(X25519_PKCS8_PREFIX, priv), { name: "X25519" }, true, ["deriveBits"]);
}

export async function x25519PublicKey(priv: Bytes): Promise<Bytes> {
  const jwk = await subtle().exportKey("jwk", await x25519Private(priv));
  return b64urlToBytes(jwk.x!);
}

async function x25519Shared(priv: Bytes, pub: Bytes): Promise<Bytes> {
  const pubKey = await subtle().importKey("raw", pub, { name: "X25519" }, false, []);
  return new Uint8Array(await subtle().deriveBits({ name: "X25519", public: pubKey }, await x25519Private(priv), 256));
}

async function wrapKek(shared: Bytes, ephPub: Bytes, recipientPub: Bytes, context: string): Promise<Bytes> {
  const ikm = await subtle().importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: concat(ephPub, recipientPub), info: enc(`sehatlog/v1/wrap|${context}`) }, ikm, 256);
  return new Uint8Array(bits);
}

export const categoryContext = (recordId: string, category: string, version: number) => `category|${recordId}|${category}|${version}`;
export const entryKeyContext = (entryId: string) => `dek|${entryId}`;
export const escrowPartContext = (releaseId: string, group: "sehatlog" | "regulator" | "independent") => `escrow-part|${releaseId}|${group}`;

/** Wraps `key` to `recipientPub`. Pass `ephemeralPriv` only in tests. */
export async function wrapToPublicKey(recipientPub: Bytes, context: string, key: Bytes, ephemeralPriv: Bytes = randomBytes(32)): Promise<Bytes> {
  const ephPub = await x25519PublicKey(ephemeralPriv);
  const kek = await wrapKek(await x25519Shared(ephemeralPriv, recipientPub), ephPub, recipientPub, context);
  return concat(ephPub, await aesKwWrap(kek, key));
}

export async function unwrapWithPrivateKey(recipientPriv: Bytes, context: string, blob: Bytes): Promise<Bytes> {
  if (blob.length < 56) throw new Error("sehatcrypto: wrapped key too short");
  const ephPub = blob.slice(0, 32);
  const kek = await wrapKek(await x25519Shared(recipientPriv, ephPub), ephPub, await x25519PublicKey(recipientPriv), context);
  return aesKwUnwrap(kek, blob.slice(32));
}

// ---- 4. Author signature ----

export type Envelope = {
  recordId: string;
  entryId: string;
  category: string;
  keyVersion: number;
  nonce: Bytes;
  ciphertext: Bytes;
  wrappedDek: Bytes;
  authorWrappedDek: Bytes;
  amendsEntryId: string; // "" for a new entry
  inputMethod: "typed" | "detected_device" | "detected_ocr" | "detected_voice";
};

export function signingInput(e: Envelope): Bytes {
  return enc(
    [
      "sehatlog/v1/entry-sig",
      e.recordId,
      e.entryId,
      e.category,
      String(e.keyVersion),
      toBase64(e.nonce),
      toBase64(e.ciphertext),
      toBase64(e.wrappedDek),
      toBase64(e.authorWrappedDek),
      e.amendsEntryId,
      e.inputMethod,
    ].join("\n"),
  );
}

export function mergeSigningInput(proposalId: string, entryId: string, recordId: string, authorSignature: Bytes): Bytes {
  return enc(["sehatlog/v1/merge-sig", proposalId, entryId, recordId, toBase64(authorSignature)].join("\n"));
}

export async function signMerge(seed: Bytes, proposalId: string, entryId: string, recordId: string, authorSignature: Bytes): Promise<Bytes> {
  const k = await subtle().importKey("pkcs8", concat(ED25519_PKCS8_PREFIX, seed), "Ed25519", false, ["sign"]);
  return new Uint8Array(await subtle().sign("Ed25519", k, mergeSigningInput(proposalId, entryId, recordId, authorSignature)));
}

export async function ed25519PublicKey(seed: Bytes): Promise<Bytes> {
  const k = await subtle().importKey("pkcs8", concat(ED25519_PKCS8_PREFIX, seed), "Ed25519", true, ["sign"]);
  return b64urlToBytes((await subtle().exportKey("jwk", k)).x!);
}

export async function signEnvelope(seed: Bytes, e: Envelope): Promise<Bytes> {
  const k = await subtle().importKey("pkcs8", concat(ED25519_PKCS8_PREFIX, seed), "Ed25519", false, ["sign"]);
  return new Uint8Array(await subtle().sign("Ed25519", k, signingInput(e)));
}

export async function verifyEnvelope(pub: Bytes, e: Envelope, sig: Bytes): Promise<boolean> {
  const k = await subtle().importKey("raw", pub, "Ed25519", false, ["verify"]);
  return subtle().verify("Ed25519", k, sig, signingInput(e));
}

// ---- 5. NIN blind index (server-side; here for vector parity) ----

export async function blindIndex(pepper: Bytes, nin: string): Promise<string> {
  const k = await subtle().importKey("raw", pepper, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await subtle().sign("HMAC", k, enc(`sehatlog/v1/nin|${nin}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- 6. Emergency escrow ----

export function combineEscrowParts(s: Bytes, r: Bytes, i: Bytes): Bytes {
  if (s.length !== 32 || r.length !== 32 || i.length !== 32) throw new Error("sehatcrypto: escrow parts must be 32 bytes");
  return s.map((b, n) => b ^ r[n] ^ i[n]);
}

export async function sealEscrowKey(k: Bytes, nonce: Bytes, escrowPrivate: Bytes, recordId: string): Promise<Bytes> {
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc(`sehatlog/v1/escrow|${recordId}`) }, await gcmKey(k, "encrypt"), escrowPrivate);
  return new Uint8Array(ct);
}

export async function openEscrowKey(k: Bytes, nonce: Bytes, sealed: Bytes, recordId: string): Promise<Bytes> {
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: nonce, additionalData: enc(`sehatlog/v1/escrow|${recordId}`) }, await gcmKey(k, "decrypt"), sealed);
  return new Uint8Array(pt);
}
