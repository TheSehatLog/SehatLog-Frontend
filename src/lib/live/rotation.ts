// Key rotation on the patient's device, after a hospital is removed: new category keys,
// wrapped to every remaining connected hospital and to the escrow, uploaded in one call.

import * as sc from "../sehatcrypto/index.ts";
import { ApiError, fromB64, toB64, type Bytes, type ConnectionView, type WrappedKey } from "./api.ts";
import type { Call } from "./escrow.ts";

export type Rotated = { category: string; version: number; key: Bytes };

export async function rotateKeys(call: Call, recordId: string, categories: string[]): Promise<Rotated[]> {
  const { versions } = await call<{ versions: Record<string, number> }>(`/v1/records/${recordId}/key-versions`);
  const rotated: Rotated[] = categories.map((category) => ({ category, version: versions[category] + 1, key: sc.randomBytes(32) }));
  const wrap = async (pub: Bytes, r: Rotated): Promise<WrappedKey> => ({
    category: r.category,
    key_version: r.version,
    wrapped: toB64(await sc.wrapToPublicKey(pub, sc.categoryContext(recordId, r.category, r.version), r.key)),
  });

  const { connections } = await call<{ connections: ConnectionView[] }>(`/v1/records/${recordId}/connections`);
  const connectionKeys = [];
  for (const c of connections.filter((x) => x.active)) {
    const mine = rotated.filter((r) => c.categories.includes(r.category));
    if (mine.length && c.facility.public_key) {
      const pub = fromB64(c.facility.public_key);
      connectionKeys.push({ connection_id: c.connection_id, keys: await Promise.all(mine.map((r) => wrap(pub, r))) });
    }
  }

  let escrowKeys: WrappedKey[] = [];
  try {
    const esc = await call<{ public_key: string }>(`/v1/records/${recordId}/escrow`);
    escrowKeys = await Promise.all(rotated.map((r) => wrap(fromB64(esc.public_key), r)));
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }

  await call(`/v1/records/${recordId}/key-rotations`, {
    method: "POST",
    body: { rotations: rotated.map((r) => ({ category: r.category, new_version: r.version })), escrow_keys: escrowKeys, connection_keys: connectionKeys },
  });
  return rotated;
}
