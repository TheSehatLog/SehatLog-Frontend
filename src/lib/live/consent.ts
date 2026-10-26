// Consents signed on the citizen's device (crypto spec section 9): approvals, declines
// and removals carry an Ed25519 signature over exactly what was decided.

import * as sc from "../sehatcrypto/index.ts";
import { fromB64, toB64 } from "./api.ts";
import { ensureDeviceSigningKey } from "./keystore.ts";

export type DeviceSignature = { key_id: string; public_key: string; signature: string };

export async function deviceSignature(c: sc.Consent): Promise<DeviceSignature> {
  const k = ensureDeviceSigningKey(c.signerId);
  return { key_id: k.keyId, public_key: toB64(await sc.ed25519PublicKey(k.seed)), signature: toB64(await sc.signConsent(k.seed, c)) };
}

export type SignedConsent = {
  id: number;
  record_id: string;
  citizen_id: string;
  key_id: string;
  action: "approve" | "decline" | "remove";
  subject_id: string;
  statement: string;
  signature: string;
  public_key: string;
  created_at: string;
};

/** Checks a stored consent locally: the statement really was signed by that device key. */
export const verifySignedConsent = (c: SignedConsent) => sc.verifyConsent(fromB64(c.public_key), c.statement, fromB64(c.signature)).catch(() => false);
