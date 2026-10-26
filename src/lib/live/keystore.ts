// Where this browser keeps keys in the live development app.
//
// DEVELOPMENT ONLY. Keys are kept as hex in localStorage so they survive reloads. In
// production: patient keys live in the device keystore (non-extractable, backed up via
// the recovery phrase and escrow), the signing key in the staff device's secure storage,
// and the facility private key in the hospital HSM behind the hospital key service.

import { fromHex, toHex, type Bytes } from "./api";

export const CATEGORIES = ["basic", "clinical", "medications", "labs", "imaging", "sensitive"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<string, string> = {
  basic: "Basic Emergency Profile",
  clinical: "Clinical history",
  medications: "Medications",
  labs: "Lab results",
  imaging: "Imaging",
  sensitive: "Sensitive (restricted)",
};

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: keys last for this page only.
  }
}

// ---- Patient (or guardian) record keys: category -> version -> key ----

type RecordKeys = Record<string, Record<string, string>>;
const recordKey = (recordId: string) => `sehatlog.keys.record.${recordId}`;

export function getRecordKeys(recordId: string): Map<string, Map<number, Bytes>> | null {
  const raw = read<RecordKeys>(recordKey(recordId));
  if (!raw) return null;
  return new Map(Object.entries(raw).map(([cat, vers]) => [cat, new Map(Object.entries(vers).map(([v, k]) => [Number(v), fromHex(k)]))]));
}

/** Creates version-1 keys for every category. Only for a record that has none yet. */
export function createRecordKeys(recordId: string) {
  const raw: RecordKeys = {};
  for (const c of CATEGORIES) raw[c] = { "1": toHex(crypto.getRandomValues(new Uint8Array(32))) };
  write(recordKey(recordId), raw);
}

/** Adds a new key version (after a rotation). */
export function addRecordKey(recordId: string, category: string, version: number, key: Uint8Array) {
  const raw = read<RecordKeys>(recordKey(recordId)) ?? {};
  raw[category] = { ...(raw[category] ?? {}), [String(version)]: toHex(key) };
  write(recordKey(recordId), raw);
}

/** Replaces the ring (after a restore). */
export function setRecordKeys(recordId: string, ring: Map<string, Map<number, Uint8Array>>) {
  const raw: RecordKeys = {};
  for (const [cat, vers] of ring) raw[cat] = Object.fromEntries([...vers].map(([v, k]) => [String(v), toHex(k)]));
  write(recordKey(recordId), raw);
}

// ---- Recovery code: kept on this device so later key changes re-upload the backup ----

export const getRecoveryCode = (recordId: string) => {
  const h = read<string>(`sehatlog.keys.recovery.${recordId}`);
  return h ? fromHex(h) : null;
};
export const setRecoveryCode = (recordId: string, code: Uint8Array) => write(`sehatlog.keys.recovery.${recordId}`, toHex(code));

// ---- Citizen device key (X25519): sealed reasons, comments and dispute text ----

export type DeviceKey = { keyId: string; priv: Uint8Array<ArrayBuffer> };

export function getDeviceKey(citizenId: string): DeviceKey | null {
  const v = read<{ keyId: string; priv: string }>(`sehatlog.keys.device.${citizenId}`);
  return v ? { keyId: v.keyId, priv: fromHex(v.priv) } : null;
}

/** Returns this browser's device key for the citizen, creating it on first use. */
export function ensureDeviceKey(citizenId: string): DeviceKey {
  const existing = getDeviceKey(citizenId);
  if (existing) return existing;
  const k = { keyId: "web-" + toHex(crypto.getRandomValues(new Uint8Array(6))), priv: crypto.getRandomValues(new Uint8Array(32)) };
  write(`sehatlog.keys.device.${citizenId}`, { keyId: k.keyId, priv: toHex(k.priv) });
  return k;
}

/** This browser's Ed25519 seed for signing consents (crypto spec section 9), same key id as the device key. */
export function ensureDeviceSigningKey(citizenId: string): { keyId: string; seed: Uint8Array<ArrayBuffer> } {
  const { keyId } = ensureDeviceKey(citizenId);
  const h = read<string>(`sehatlog.keys.devsign.${citizenId}`);
  if (h) return { keyId, seed: fromHex(h) };
  const seed = crypto.getRandomValues(new Uint8Array(32));
  write(`sehatlog.keys.devsign.${citizenId}`, toHex(seed));
  return { keyId, seed };
}

// ---- Staff signing seed ----

export const getSigningSeed = (staffId: string) => {
  const h = read<string>(`sehatlog.keys.signing.${staffId}`);
  return h ? fromHex(h) : null;
};
export const setSigningSeed = (staffId: string, seed: Uint8Array) => write(`sehatlog.keys.signing.${staffId}`, toHex(seed));

// ---- Facility private key (stand-in for the hospital key service) ----

export const getFacilityKey = (facilityId: string) => {
  const h = read<string>(`sehatlog.keys.facility.${facilityId}`);
  return h ? fromHex(h) : null;
};
export const setFacilityKey = (facilityId: string, priv: Uint8Array) => write(`sehatlog.keys.facility.${facilityId}`, toHex(priv));
