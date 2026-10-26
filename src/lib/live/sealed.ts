// Sealed free text (crypto spec section 8): request reasons, review comments and dispute
// text are encrypted in the browser to the facility and the record's circle. The API
// stores and forwards them but cannot read them.

import * as sc from "../sehatcrypto/index.ts";
import { fromB64, toB64, type Bytes, type SealedText } from "./api.ts";
import { localUnwrapper, type Unwrapper } from "./unwrap.ts";

export type { SealedText };
export type Reader = { id: string; publicKey: Bytes };

export type Purpose = "request-reason" | "review-comment" | "dispute-reason" | "dispute-resolution";

/** The record's circle (holder or guardians, NOK, family) and their device keys. */
export type Recipients = {
  record_id: string;
  circle: { citizen_id: string; relation: string; keys: { key_id: string; public_key: string }[] }[];
};

type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

export async function sealFor(text: string, purpose: Purpose, recordId: string, readers: Reader[]): Promise<SealedText> {
  const key = sc.randomBytes(32);
  const ct = await sc.sealText(key, sc.randomBytes(12), text, purpose, recordId);
  const seen = new Set<string>();
  const keys = [];
  for (const r of readers) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    keys.push({ to: r.id, wrapped: toB64(await sc.wrapToPublicKey(r.publicKey, sc.textContext(purpose, recordId), key)) });
  }
  return { ciphertext: toB64(ct), keys };
}

/** Opens sealed text as one reader; null if it wasn't sealed to that reader. */
export async function openSealed(
  s: SealedText | null | undefined,
  readerId: string,
  key: Bytes | Unwrapper, // a device private key, or the hospital key service
  purpose: Purpose,
  recordId: string,
): Promise<string | null> {
  const k = s?.keys.find((x) => x.to === readerId);
  if (!s || !k) return null;
  const unwrap = typeof key === "function" ? key : localUnwrapper(key);
  const contentKey = await unwrap(sc.textContext(purpose, recordId), fromB64(k.wrapped));
  return sc.openText(contentKey, fromB64(s.ciphertext), purpose, recordId);
}

/** Every registered device of the record's circle. */
export async function circleReaders(call: Call, recordId: string): Promise<Reader[]> {
  const r = await call<Recipients>(`/v1/records/${recordId}/recipients`);
  return r.circle.flatMap((m) => m.keys.map((k) => ({ id: `${m.citizen_id}:${k.key_id}`, publicKey: fromB64(k.public_key) })));
}

const facilityKeys = new Map<string, Bytes>();

/** A facility as a reader, from its directory entry. */
export async function facilityReader(call: Call, facilityId: string): Promise<Reader> {
  let pub = facilityKeys.get(facilityId);
  if (!pub) {
    const f = await call<{ public_key: string }>(`/v1/facilities/${facilityId}`);
    pub = fromB64(f.public_key);
    facilityKeys.set(facilityId, pub);
  }
  return { id: facilityId, publicKey: pub };
}

/** Seals to a facility plus the record's circle. */
export async function sealToFacilityAndCircle(call: Call, text: string, purpose: Purpose, recordId: string, facilityId: string): Promise<SealedText> {
  const [fac, circle] = await Promise.all([facilityReader(call, facilityId), circleReaders(call, recordId)]);
  return sealFor(text, purpose, recordId, [fac, ...circle]);
}

/** A request reason is {"reason", "incapacity"} JSON. */
export function parseRequestReason(text: string | null): { reason: string; incapacity?: string } | null {
  if (text == null) return null;
  try {
    const v = JSON.parse(text) as { reason?: string; incapacity?: string };
    return { reason: v.reason ?? "", incapacity: v.incapacity || undefined };
  } catch {
    return { reason: text };
  }
}
