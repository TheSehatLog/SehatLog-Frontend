import assert from "node:assert/strict";
import { test } from "node:test";
import * as sc from "../sehatcrypto/index.ts";
import { openSealed, parseRequestReason, sealFor } from "./sealed.ts";

test("sealed text opens for each listed reader and nobody else", async () => {
  const fac = sc.randomBytes(32);
  const dev = sc.randomBytes(32);
  const other = sc.randomBytes(32);
  const text = JSON.stringify({ reason: "Road traffic accident", incapacity: "Unconscious" });
  const s = await sealFor(text, "request-reason", "rec_1", [
    { id: "fac_igh", publicKey: await sc.x25519PublicKey(fac) },
    { id: "ctz_musa:web-1", publicKey: await sc.x25519PublicKey(dev) },
    { id: "fac_igh", publicKey: await sc.x25519PublicKey(fac) }, // duplicates collapse
  ]);
  assert.equal(s.keys.length, 2);
  assert.equal(await openSealed(s, "fac_igh", fac, "request-reason", "rec_1"), text);
  assert.equal(await openSealed(s, "ctz_musa:web-1", dev, "request-reason", "rec_1"), text);
  assert.equal(await openSealed(s, "ctz_other:web-1", other, "request-reason", "rec_1"), null);
  await assert.rejects(openSealed(s, "fac_igh", fac, "request-reason", "rec_2"), "bound to its record");
  await assert.rejects(openSealed(s, "fac_igh", fac, "review-comment", "rec_1"), "bound to its purpose");
  assert.deepEqual(parseRequestReason(text), { reason: "Road traffic accident", incapacity: "Unconscious" });
});
