/* eslint-disable @typescript-eslint/no-explicit-any -- seeding script reads untyped API JSON */
// Seeds the hackathon demo story on a fresh stack (SehatLog-Backend\scripts\demo-reset.ps1
// runs this after dev-stack.ps1 -Reset):
//
//   Musa Bello has a history at Lagos Central Teaching Hospital: penicillin allergy,
//   blood group, insulin-dependent diabetes. His emergency access is set up, Aisha is his
//   next of kin, and his keys are backed up under a recovery code (printed for the demo).
//
// Everything is created exactly as in real use: keys on "Musa's phone" (this script),
// entries encrypted and signed by Lagos Central's clinicians, opened through Lagos
// Central's key service, merged by its consultant.

import { writeFileSync } from "node:fs";
import * as sc from "../../src/lib/sehatcrypto/index.ts";
import * as rec from "../../src/lib/live/records.ts";
import * as esc from "../../src/lib/live/escrow.ts";
import * as sealed from "../../src/lib/live/sealed.ts";
import { fromB64, toB64 } from "../../src/lib/live/api.ts";
import { newRecoveryCode, uploadBackup } from "../../src/lib/live/backup.ts";
import { keyServiceUnwrapper } from "../../src/lib/live/unwrap.ts";
import { BACKEND, KEY_SERVICE, MUSA, WEB, call, caller, deviceSig, ok, signIn, staffWho, stepUp } from "../e2e/lib.mts";

const CATS = ["basic", "clinical", "medications", "labs", "imaging", "sensitive"];
const BOLA = staffWho("bola.adebayo"), KOLA = staffWho("kola.martins");

// 1. Musa's phone: record keys, emergency escrow, recovery code.
const musa = await signIn(MUSA);
const musaMe = await call("/v1/me", musa);
const recordId: string = musaMe.record_id;
const ring: rec.KeyRing = new Map(CATS.map((c) => [c, new Map([[1, sc.randomBytes(32)]])]));
await esc.setupEscrow(caller(musa) as any, recordId, ring, WEB);
const code = newRecoveryCode();
await uploadBackup(caller(musa) as any, recordId, ring, code);
ok("Musa: keys created, emergency escrow set up, keys backed up under a recovery code");

// 2. Lagos Central asks; Musa approves full access on his phone (signed consent).
const bola = await signIn(BOLA);
await call(`/v1/records/${recordId}/access-requests`, bola, {
  categories: ["clinical", "medications", "labs"],
  patient_can_consent: true,
  reason_sealed: await sealed.sealToFacilityAndCircle(caller(bola) as any, JSON.stringify({ reason: "Diabetes clinic follow-up" }), "request-reason", recordId, "fac_lcth"),
});
const req = (await call("/v1/me/access-requests", musa)).requests[0];
const granted = ["clinical", "medications", "labs"];
await call(`/v1/access-requests/${req.request_id}/approve`, musa, {
  ...(await stepUp(MUSA, musa)),
  level: "full",
  categories: granted,
  wrapped_keys: await rec.wrapKeysForFacility(recordId, ring, ["basic", ...granted], fromB64(req.facility.public_key)),
  device_signature: await deviceSig({ action: "approve", subjectId: req.request_id, recordId, signerId: musaMe.id, level: "full", categories: granted }),
});
ok("Lagos Central connected with Musa's signed consent");

// 3. Dr Adebayo writes his history; Dr Martins reviews and merges each entry.
const lcth = await call("/v1/me", bola);
const bolaSeed = sc.randomBytes(32);
await call("/v1/me/signing-key", bola, { public_key: toB64(await sc.ed25519PublicKey(bolaSeed)), ...(await stepUp(BOLA, bola)) }, "PUT");
const kola = await signIn(KOLA);
const kolaSeed = sc.randomBytes(32);
await call("/v1/me/signing-key", kola, { public_key: toB64(await sc.ed25519PublicKey(kolaSeed)), ...(await stepUp(KOLA, kola)) }, "PUT");
const hospRing = await rec.unwrapFacilityKeys(recordId, (await call(`/v1/records/${recordId}/access`, bola)).keys, keyServiceUnwrapper(KEY_SERVICE.fac_lcth, () => bola));

const history: { category: string; payload: rec.Payload }[] = [
  { category: "basic", payload: { kind: "Allergy", title: "Penicillin allergy: anaphylaxis", details: "Collapsed after IV ampicillin, 2021. Avoid all penicillins.", fields: { Severity: "Severe" } } },
  { category: "basic", payload: { kind: "Vitals", title: "Blood group O+", fields: { "Blood group": "O", Rhesus: "Positive", Genotype: "AS" } } },
  { category: "basic", payload: { kind: "Diagnosis", title: "Type 1 diabetes, insulin-dependent", details: "Diagnosed 2009. Risk of hypoglycaemia.", fields: { ICD: "E10" } } },
  { category: "medications", payload: { kind: "Prescription", title: "Insulin glargine 20 units nightly; insulin aspart with meals", fields: { Prescriber: "Dr. Kola Martins" } } },
  { category: "labs", payload: { kind: "Lab result", title: "HbA1c 8.1%", details: "Above target; dose adjusted.", fields: { HbA1c: "8.1 %", Date: "2026-09-14" } } },
  { category: "clinical", payload: { kind: "Note", title: "Diabetes clinic review", details: "Two hypoglycaemic episodes last month. Advised to carry glucose. Next review in 3 months." } },
];
for (const h of history) {
  const k = rec.latestKey(hospRing, h.category)!;
  const p = await call(
    `/v1/records/${recordId}/proposals`,
    bola,
    await rec.buildProposal({ recordId, category: h.category, keyVersion: k.version, categoryKey: k.key, facilityPub: fromB64(lcth.facility.public_key), signingSeed: bolaSeed, payload: h.payload }),
  );
  await call(`/v1/proposals/${p.proposal_id}/merge`, kola, { merge_signature: await rec.mergeSignature(kolaSeed, p) });
}
ok(`Lagos Central recorded ${history.length} entries (allergy, blood group, diabetes, insulin, HbA1c, clinic note), each reviewed and merged`);

const codeText = sc.encodeRecoveryCode(code);
const out = `SehatLog hackathon demo: seeded ${new Date().toISOString()}

Musa Bello  NIN 34567890123  record ${recordId}
  History at Lagos Central Teaching Hospital (6 entries, 3 in the Basic Emergency Profile).
  Next of kin: Aisha Bello (NIN 23456789012).
  Recovery code (for "Musa gets a new phone"): ${codeText}

Password for every account: sehatlog-dev-pass. Authenticator codes: go run ./cmd/devseed codes
`;
// A hosted demo (SEHATLOG_WEB set) gets its own file, so the local stack's isn't overwritten.
writeFileSync(`${BACKEND}bin/${process.env.SEHATLOG_WEB ? "demo-hosted.txt" : "demo.txt"}`, out);
console.log("\n" + out);
