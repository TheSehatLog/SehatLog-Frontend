/* eslint-disable @typescript-eslint/no-explicit-any -- test scripts read untyped API JSON */
// NIN + fingerprint (simulated national identity register) and lost-device recovery, live.
//   node scripts/e2e/recovery.e2e.mts   (after dev-stack.ps1 -Reset and next dev -p 3210)

import * as sc from "../../src/lib/sehatcrypto/index.ts";
import * as esc from "../../src/lib/live/escrow.ts";
import type { KeyRing } from "../../src/lib/live/records.ts";
import { toB64 } from "../../src/lib/live/api.ts";
import { finishDeskRecovery, newRecoveryCode, recoveryStatus, restoreWithCode, startDeskRecovery, uploadBackup } from "../../src/lib/live/backup.ts";
import { AISHA, MUSA, WEB, call, caller, ok, refused, signIn, staffWho, stepUp } from "./lib.mts";

const scan = async (nin: string): Promise<string> =>
  (await call<{ people: { nin: string; template: string }[] }>("/v1/dev/fingerprints")).people.find((p) => p.nin === nin)!.template;
const CATS = ["basic", "clinical", "medications", "labs", "imaging", "sensitive"];
const sameRing = (a: KeyRing, b: KeyRing) => CATS.every((c) => toB64(a.get(c)!.get(1)!) === toB64(b.get(c)!.get(1)!));

// 1. Records desk: the register knows the NIN, and the adult's finger matches it.
const kemi = await signIn(staffWho("records.igh"));
await refused(call("/v1/records", kemi, { nin: "11122233344", fingerprint: await scan("67890123456") }), 422, "unknown NIN");
await refused(call("/v1/records", kemi, { nin: "67890123456", fingerprint: await scan(AISHA.login.nin) }), 422, "someone else's finger");
const chinedu = await call("/v1/records", kemi, { nin: "67890123456", fingerprint: await scan("67890123456") });
ok(`records desk enrolled Chinedu Okafor (${chinedu.record_id}): NIN found in the register, fingerprint matched; unknown NIN and wrong finger refused`);

// 2. An unconscious patient with no ID: the doctor identifies them by fingerprint.
const doc = await signIn(staffWho("amaka.obi"));
const byNin = await call("/v1/lookup", doc, { nin: AISHA.login.nin });
const byFinger = await call("/v1/lookup", doc, { fingerprint: await scan(AISHA.login.nin) });
if (byFinger.record_id !== byNin.record_id) throw new Error("fingerprint found the wrong record");
ok(`doctor identified the patient by fingerprint alone: ${byFinger.record_id}`);

// Aisha's first device: keys, emergency escrow, and a recovery code.
const aisha = await signIn(AISHA);
const rec = byNin.record_id;
const ring: KeyRing = new Map(CATS.map((c) => [c, new Map([[1, sc.randomBytes(32)]])]));
await esc.setupEscrow(caller(aisha) as any, rec, ring, WEB);
const code = newRecoveryCode();
await uploadBackup(caller(aisha) as any, rec, ring, code);

// 3. Emergency profile released only for the patient's own finger.
await refused(call(`/v1/records/${rec}/emergency-profile`, doc, { fingerprint: await scan(MUSA.login.nin) }), 403, "another person's finger");
await call(`/v1/records/${rec}/emergency-profile`, doc, { fingerprint: await scan(AISHA.login.nin) });
ok("Basic Emergency Profile released for the patient's finger, refused for someone else's");

// 4. Lost phone, code kept: a new device restores the keys from the typed code.
const typed = sc.encodeRecoveryCode(code).toLowerCase().replaceAll("-", " ").replaceAll("1", "l");
const restored = await restoreWithCode(caller(aisha) as any, rec, typed);
if (!sameRing(restored.ring, ring)) throw new Error("restored keys differ");
ok(`new device restored all ${CATS.length} keys from the recovery code (typed carelessly: "${typed.slice(0, 14)}…")`);

// 5. Lost phone and code: recovery at a records desk, released to the new device's key only.
const devPriv = sc.randomBytes(32);
await call("/v1/me/device-key", aisha, { key_id: "e2e-newphone", public_key: toB64(await sc.x25519PublicKey(devPriv)) }, "PUT");
const req = await startDeskRecovery(caller(aisha) as any, rec, "e2e-newphone", await stepUp(AISHA, aisha));
await refused(call(`/v1/recovery-requests/${req.request_id}/release`, aisha, {}), 409, "release before the desk check");
await refused(call("/v1/recovery-requests/verify", kemi, { nin: AISHA.login.nin, desk_code: req.desk_code, fingerprint: await scan(MUSA.login.nin) }), 403, "desk check with the wrong finger");
await call("/v1/recovery-requests/verify", kemi, { nin: AISHA.login.nin, desk_code: req.desk_code, fingerprint: await scan(AISHA.login.nin) });
if ((await recoveryStatus(caller(aisha) as any, req.request_id)).status !== "verified") throw new Error("not verified");
const recovered = await finishDeskRecovery(caller(aisha) as any, rec, req.request_id, devPriv, WEB);
if (!sameRing(recovered, ring)) throw new Error("desk recovery gave different keys");
await refused(call(`/v1/recovery-requests/${req.request_id}/release`, aisha, {}), 409, "second release");
const alerts = (await call("/v1/me/notifications", aisha)).notifications.map((n: any) => n.kind);
if (!["recovery_requested", "recovery_verified", "recovery_released"].every((k) => alerts.includes(k))) throw new Error("recovery alerts missing");
ok(`records desk recovery: NIN + desk code ${req.desk_code} + fingerprint; the custodians released the parts to the new device, which recovered all ${CATS.length} keys`);
ok("Aisha was alerted at each step (requested, verified, released); a second release was refused");
