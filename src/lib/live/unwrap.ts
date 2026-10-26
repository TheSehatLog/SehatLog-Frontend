// Opening keys wrapped to a hospital (crypto spec section 3) without the browser holding
// the hospital's private key. The hospital key service unwraps each key and re-wraps it to
// a key that exists only in this tab's memory; the API decides what each staff member may
// open, and every unwrap is logged at the hospital and in the patient's activity log.

import * as sc from "../sehatcrypto/index.ts";
import { fromB64, toB64, type Bytes } from "./api.ts";

/** Opens one key wrapped to the facility, for a given wrap context. */
export type Unwrapper = (context: string, wrapped: Bytes) => Promise<Bytes>;

/** Development fallback only: a facility private key held in this browser. */
export const localUnwrapper =
  (priv: Bytes): Unwrapper =>
  (context, wrapped) =>
    sc.unwrapWithPrivateKey(priv, context, wrapped);

type Pending = { context: string; wrapped: Bytes; resolve: (k: Bytes) => void; reject: (e: Error) => void };

/**
 * The hospital key service. Unwraps requested in the same tick are sent as one batch
 * (up to 200 per call), so opening a whole record is a handful of requests.
 */
export function keyServiceUnwrapper(baseUrl: string, token: () => string | undefined): Unwrapper {
  const sessionPriv = sc.randomBytes(32); // this tab only; never stored
  const sessionPub = sc.x25519PublicKey(sessionPriv);
  let queue: Pending[] = [];
  let scheduled = false;

  async function flush() {
    scheduled = false;
    const batch = queue;
    queue = [];
    for (let i = 0; i < batch.length; i += 200) {
      const chunk = batch.slice(i, i + 200);
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/unwrap`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token() ?? ""}` },
          body: JSON.stringify({ device_public_key: toB64(await sessionPub), items: chunk.map((p) => ({ context: p.context, wrapped: toB64(p.wrapped) })) }),
        });
        const data = (await res.json().catch(() => null)) as { items?: { rewrapped?: string; error?: string }[]; error?: string } | null;
        if (!res.ok || !data?.items) throw new Error(data?.error ?? `Hospital key service unavailable (${res.status})`);
        await Promise.all(
          chunk.map(async (p, j) => {
            const it = data.items![j];
            if (!it?.rewrapped) return p.reject(new Error(it?.error ?? "Key not released"));
            try {
              p.resolve(await sc.unwrapWithPrivateKey(sessionPriv, p.context, fromB64(it.rewrapped)));
            } catch (e) {
              p.reject(e instanceof Error ? e : new Error("Re-wrapped key did not open"));
            }
          }),
        );
      } catch (e) {
        for (const p of chunk) p.reject(e instanceof Error ? e : new Error("Hospital key service unavailable"));
      }
    }
  }

  return (context, wrapped) =>
    new Promise<Bytes>((resolve, reject) => {
      queue.push({ context, wrapped, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
      }
    });
}
