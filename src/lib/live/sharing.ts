// Sharing record keys between a record's managers' devices (crypto spec section 10): a
// child's guardians, or one citizen's browser and phone. Each key version is wrapped to the
// other device's X25519 key exactly as for a hospital.

import * as sc from "../sehatcrypto/index.ts";
import { fromB64, toB64 } from "./api.ts";
import { addRecordKey, type DeviceKey } from "./keystore.ts";
import type { Recipients } from "./sealed.ts";

type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;
type Ring = Map<string, Map<number, Uint8Array<ArrayBuffer>>>;

/** Wraps every key version to every other manager device. Returns how many devices got them. */
export async function shareRecordKeys(call: Call, recordId: string, ring: Ring, self: string): Promise<number> {
  const r = await call<Recipients>(`/v1/records/${recordId}/recipients`);
  const devices = r.circle
    .filter((m) => m.relation === "holder" || m.relation === "guardian")
    .flatMap((m) => m.keys.map((k) => ({ id: `${m.citizen_id}:${k.key_id}`, pub: fromB64(k.public_key) })))
    .filter((d) => d.id !== self);
  const keys = [];
  for (const d of devices)
    for (const [category, versions] of ring)
      for (const [version, key] of versions)
        keys.push({ to: d.id, category, key_version: version, wrapped: toB64(await sc.wrapToPublicKey(d.pub, sc.categoryContext(recordId, category, version), key)) });
  if (keys.length) await call(`/v1/records/${recordId}/shared-keys`, { method: "PUT", body: { keys } });
  return devices.length;
}

/** Opens keys other devices shared with this one and adds the missing ones. Returns how many were added. */
export async function receiveSharedKeys(call: Call, recordId: string, citizenId: string, device: DeviceKey, ring: Ring | null): Promise<number> {
  const { keys } = await call<{ keys: { to: string; category: string; key_version: number; wrapped: string }[] }>(`/v1/records/${recordId}/shared-keys`);
  let added = 0;
  for (const k of keys) {
    if (k.to !== `${citizenId}:${device.keyId}` || ring?.get(k.category)?.has(k.key_version)) continue;
    try {
      const key = await sc.unwrapWithPrivateKey(device.priv, sc.categoryContext(recordId, k.category, k.key_version), fromB64(k.wrapped));
      addRecordKey(recordId, k.category, k.key_version, key);
      added++;
    } catch {
      // Wrapped to an older key of this device: skip.
    }
  }
  return added;
}
