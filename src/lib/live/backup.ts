// Surviving a lost device (crypto spec sections 11 and 12).
//  - Recovery code: the device seals the record keys under a code the person writes down
//    and uploads the sealed backup; on a new device, typing the code restores the keys.
//  - Records desk: without the code, a Records Officer checks NIN + fingerprint, then the
//    escrow releases the keys to this device's own key.

import * as sc from "../sehatcrypto/index.ts";
import { fromB64, toB64, type Bytes } from "./api.ts";
import { openRelease, type ReleaseBundle } from "./escrow.ts";
import type { KeyRing } from "./records.ts";
import { localUnwrapper } from "./unwrap.ts";

type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

export const newRecoveryCode = () => sc.randomBytes(sc.RECOVERY_CODE_SIZE);

function ringToJson(ring: KeyRing): string {
  const keys: Record<string, Record<string, string>> = {};
  for (const [cat, vers] of ring) {
    keys[cat] = {};
    for (const [v, k] of vers) keys[cat][String(v)] = toB64(k);
  }
  return JSON.stringify({ v: 1, keys });
}

function ringFromJson(text: string): KeyRing {
  const parsed = JSON.parse(text) as { v: number; keys: Record<string, Record<string, string>> };
  if (parsed.v !== 1) throw new Error("Unsupported backup version");
  return new Map(Object.entries(parsed.keys).map(([cat, vers]) => [cat, new Map(Object.entries(vers).map(([v, k]) => [Number(v), fromB64(k)]))]));
}

/** Seals the ring under the code and uploads it (every version is kept server-side). */
export async function uploadBackup(call: Call, recordId: string, ring: KeyRing, code: Bytes) {
  const sealed = await sc.sealBackup(code, sc.randomBytes(12), new TextEncoder().encode(ringToJson(ring)) as Bytes, recordId);
  await call(`/v1/records/${recordId}/key-backup`, { method: "PUT", body: { backup: toB64(sealed) } });
}

/** Downloads the latest backup and opens it with the typed code. */
export async function restoreWithCode(call: Call, recordId: string, typed: string): Promise<{ ring: KeyRing; code: Bytes }> {
  let code: Bytes;
  try {
    code = sc.decodeRecoveryCode(typed);
  } catch {
    throw new Error("A recovery code is 32 letters and digits, like YTAY-2D3H-…");
  }
  const { backup } = await call<{ backup: string }>(`/v1/records/${recordId}/key-backup`);
  try {
    return { ring: ringFromJson(new TextDecoder().decode(await sc.openBackup(code, fromB64(backup), recordId))), code };
  } catch {
    throw new Error("That recovery code doesn't open this record's backup.");
  }
}

export type RecoveryRequest = { request_id: string; status: "pending" | "verified" | "released" | "cancelled" | "expired"; desk_code?: string; expires_at: string };

/** Starts desk recovery from this device (needs password + second factor). */
export const startDeskRecovery = (call: Call, recordId: string, deviceKeyId: string, stepUp: Record<string, string>) =>
  call<RecoveryRequest>(`/v1/records/${recordId}/recovery-requests`, { method: "POST", body: { ...stepUp, device_key_id: deviceKeyId } });

export const recoveryStatus = (call: Call, id: string) => call<RecoveryRequest>(`/v1/recovery-requests/${id}`);

/** After the desk check: the custodians wrap their parts to this device's key; open them here. */
export async function finishDeskRecovery(call: Call, recordId: string, requestId: string, devicePriv: Bytes, base = ""): Promise<KeyRing> {
  const bundle = await call<ReleaseBundle>(`/v1/recovery-requests/${requestId}/release`, { method: "POST" });
  return openRelease(recordId, bundle, localUnwrapper(devicePriv), base);
}
