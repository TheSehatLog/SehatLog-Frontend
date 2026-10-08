// Emergency escrow from the browser (crypto spec section 6).
//  - Patient device: create the escrow key, split it into S/R/I, enrol each part at its
//    custodian, upload the sealed key and the escrow-wrapped category keys.
//  - Hospital key service: collect the three parts with a release ticket, open the
//    escrow key and unwrap the category keys. Only this browser ever combines the parts.

import * as sc from "../sehatcrypto/index.ts";
import { fromB64, toB64, type Bytes, type WrappedKey } from "./api.ts";
import type { KeyRing } from "./records.ts";

export const GROUPS = ["sehatlog", "regulator", "independent"] as const;
export type Group = (typeof GROUPS)[number];
export type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

/** Base URL for a custodian group (proxied by next.config.ts). */
export const custodianUrl = (group: Group, base = "") => `${base}/custodians/${group}`;

async function custodian<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Custodian refused (${res.status}): ${(data as { error?: string } | null)?.error ?? "unreachable"}`);
  return data as T;
}

/** Wraps every key in the ring to the escrow public key. */
export async function escrowWrap(recordId: string, ring: KeyRing, escrowPub: Bytes): Promise<WrappedKey[]> {
  const out: WrappedKey[] = [];
  for (const [cat, vers] of ring) {
    for (const [ver, key] of vers) {
      out.push({ category: cat, key_version: ver, wrapped: toB64(await sc.wrapToPublicKey(escrowPub, sc.categoryContext(recordId, cat, ver), key)) });
    }
  }
  return out;
}

/** Patient device: sets up emergency escrow for a record. */
export async function setupEscrow(call: Call, recordId: string, ring: KeyRing, base = "") {
  const escrowPriv = sc.randomBytes(32);
  const escrowPub = await sc.x25519PublicKey(escrowPriv);
  const parts: Record<Group, Bytes> = { sehatlog: sc.randomBytes(32), regulator: sc.randomBytes(32), independent: sc.randomBytes(32) };
  const k = sc.combineEscrowParts(parts.sehatlog, parts.regulator, parts.independent);
  const nonce = sc.randomBytes(12);
  const sealed = await sc.sealEscrowKey(k, nonce, escrowPriv, recordId);

  // Parts first: a sealed key without its parts would be unopenable.
  const { ticket } = await call<{ ticket: string }>(`/v1/records/${recordId}/escrow-enrolment`, { method: "POST" });
  for (const g of GROUPS) await custodian(`${custodianUrl(g, base)}/v1/parts/${recordId}`, "PUT", { ticket, part: toB64(parts[g]) });

  await call(`/v1/records/${recordId}/escrow`, {
    method: "PUT",
    body: { public_key: toB64(escrowPub), seal_nonce: toB64(nonce), sealed: toB64(sealed), keys: await escrowWrap(recordId, ring, escrowPub) },
  });
}

export type ReleaseBundle = {
  release_id: string;
  ticket: string;
  categories: string[];
  escrow: { public_key: string; seal_nonce: string; sealed: string };
  escrow_keys: WrappedKey[];
};

/** Hospital key service: collect the parts, open the escrow key, unwrap the category keys. */
export async function openRelease(recordId: string, bundle: ReleaseBundle, facilityPriv: Bytes, base = ""): Promise<KeyRing> {
  const got: Bytes[] = [];
  for (const g of GROUPS) {
    const r = await custodian<{ wrapped_part: string }>(`${custodianUrl(g, base)}/v1/release`, "POST", { ticket: bundle.ticket });
    got.push(await sc.unwrapWithPrivateKey(facilityPriv, sc.escrowPartContext(bundle.release_id, g), fromB64(r.wrapped_part)));
  }
  const k = sc.combineEscrowParts(got[0], got[1], got[2]);
  const escrowPriv = await sc.openEscrowKey(k, fromB64(bundle.escrow.seal_nonce), fromB64(bundle.escrow.sealed), recordId);
  const ring: KeyRing = new Map();
  for (const w of bundle.escrow_keys) {
    const key = await sc.unwrapWithPrivateKey(escrowPriv, sc.categoryContext(recordId, w.category, w.key_version), fromB64(w.wrapped));
    if (!ring.has(w.category)) ring.set(w.category, new Map());
    ring.get(w.category)!.set(w.key_version, key);
  }
  return ring;
}
