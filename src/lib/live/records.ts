// Record crypto for the live app, built on the shared spec library (sehatcrypto).

import * as sc from "../sehatcrypto/index.ts";
import { fromB64, toB64, toHex, type Bytes, type Envelope, type WrappedKey } from "./api.ts";

export type Payload = { kind: string; title: string; details?: string; fields?: Record<string, string> };

export type KeyRing = Map<string, Map<number, Bytes>>; // category -> version -> key

/** Wraps the patient's category keys to a facility (approval with the patient's own keys). */
export async function wrapKeysForFacility(recordId: string, ring: KeyRing, categories: string[], facilityPub: Bytes): Promise<WrappedKey[]> {
  const out: WrappedKey[] = [];
  for (const cat of categories) {
    for (const [ver, key] of ring.get(cat) ?? []) {
      out.push({ category: cat, key_version: ver, wrapped: toB64(await sc.wrapToPublicKey(facilityPub, sc.categoryContext(recordId, cat, ver), key)) });
    }
  }
  return out;
}

/** Hospital side: opens the category keys wrapped to the facility. */
export async function unwrapFacilityKeys(recordId: string, keys: WrappedKey[], facilityPriv: Bytes): Promise<KeyRing> {
  const ring: KeyRing = new Map();
  for (const k of keys) {
    const key = await sc.unwrapWithPrivateKey(facilityPriv, sc.categoryContext(recordId, k.category, k.key_version), fromB64(k.wrapped));
    if (!ring.has(k.category)) ring.set(k.category, new Map());
    ring.get(k.category)!.set(k.key_version, key);
  }
  return ring;
}

/** Decrypts an entry or proposal: with the category key, or as the author facility. */
export async function decryptEnvelope(e: Envelope, ring: KeyRing | null, own?: { facilityId: string; priv: Bytes }): Promise<Payload | null> {
  try {
    let dek: Bytes | null = null;
    const catKey = ring?.get(e.category)?.get(e.key_version);
    if (catKey) dek = await sc.aesKwUnwrap(catKey, fromB64(e.wrapped_dek));
    else if (own && own.facilityId === e.facility_id) dek = await sc.unwrapWithPrivateKey(own.priv, sc.entryKeyContext(e.entry_id), fromB64(e.author_wrapped_dek));
    if (!dek) return null;
    const plain = await sc.openEntry(dek, fromB64(e.nonce), fromB64(e.ciphertext), e.record_id, e.category, e.key_version);
    return JSON.parse(new TextDecoder().decode(plain)) as Payload;
  } catch {
    return null;
  }
}

/** Encrypts and signs a new entry or amendment, ready for POST /v1/records/{id}/proposals. */
export async function buildProposal(input: {
  recordId: string;
  category: string;
  keyVersion: number;
  categoryKey: Bytes;
  facilityPub: Bytes;
  signingSeed: Bytes;
  payload: Payload;
  amendsEntryId?: string;
  inputMethod?: sc.Envelope["inputMethod"];
}) {
  const entryId = "ent_" + toHex(sc.randomBytes(8));
  const dek = sc.randomBytes(32);
  const nonce = sc.randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(input.payload)) as Bytes;
  const ciphertext = await sc.sealEntry(dek, nonce, plaintext, input.recordId, input.category, input.keyVersion);
  const wrappedDek = await sc.aesKwWrap(input.categoryKey, dek);
  const authorWrappedDek = await sc.wrapToPublicKey(input.facilityPub, sc.entryKeyContext(entryId), dek);
  const env: sc.Envelope = {
    recordId: input.recordId,
    entryId,
    category: input.category,
    keyVersion: input.keyVersion,
    nonce,
    ciphertext,
    wrappedDek,
    authorWrappedDek,
    amendsEntryId: input.amendsEntryId ?? "",
    inputMethod: input.inputMethod ?? "typed",
  };
  return {
    entry_id: entryId,
    category: input.category,
    key_version: input.keyVersion,
    nonce: toB64(nonce),
    ciphertext: toB64(ciphertext),
    wrapped_dek: toB64(wrappedDek),
    author_wrapped_dek: toB64(authorWrappedDek),
    author_signature: toB64(await sc.signEnvelope(input.signingSeed, env)),
    amends_entry_id: env.amendsEntryId,
    input_method: env.inputMethod,
  };
}

export async function mergeSignature(seed: Bytes, p: { proposal_id: string; entry_id: string; record_id: string; author_signature: string }) {
  return toB64(await sc.signMerge(seed, p.proposal_id, p.entry_id, p.record_id, fromB64(p.author_signature)));
}

/** Latest key version held for a category. */
export function latestKey(ring: KeyRing | null, category: string): { version: number; key: Bytes } | null {
  const vers = ring?.get(category);
  if (!vers || vers.size === 0) return null;
  const version = Math.max(...vers.keys());
  return { version, key: vers.get(version)! };
}
