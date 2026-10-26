/* eslint-disable @typescript-eslint/no-explicit-any -- test scripts read untyped API JSON */
// Hospital key service, live: staff open record keys, entry keys, escrow parts and sealed
// text through their hospital's key service; the browser never holds the hospital key.
//   node scripts/e2e/keyservice.e2e.mts   (after dev-stack.ps1 -Reset and next dev -p 3210)

import { readFileSync } from "node:fs";
import * as sc from "../../src/lib/sehatcrypto/index.ts";
import * as rec from "../../src/lib/live/records.ts";
import * as esc from "../../src/lib/live/escrow.ts";
import * as sealed from "../../src/lib/live/sealed.ts";
import { fromB64, toB64 } from "../../src/lib/live/api.ts";
import { keyServiceUnwrapper } from "../../src/lib/live/unwrap.ts";
import { AISHA, BACKEND, KEY_SERVICE, MUSA, WEB, call, caller, devFacilityKey, deviceSig, ok, signIn, staffWho, stepUp } from "./lib.mts";

const AMAKA = staffWho("amaka.obi"), TUNDE = staffWho("tunde.adeyemi"), NGOZI = staffWho("ngozi.eze"), KUNLE = staffWho("kunle.ade"), KEMI = staffWho("records.igh");
const CATS = ["basic", "clinical", "medications", "labs", "imaging", "sensitive"];
const newRing = (): rec.KeyRing => new Map(CATS.map((c) => [c, new Map([[1, sc.randomBytes(32)]])]));

// The key service holds the facility key devseed generated, not some other key.
const info = await (await fetch(`${KEY_SERVICE.fac_igh}/v1/info`)).json();
if (info.public_key !== toB64(await sc.x25519PublicKey(devFacilityKey("fac_igh")))) throw new Error("key service holds the wrong key");
ok("Ikeja General's key service holds the facility key published in the directory");

// 1. Dr Obi asks for access; Aisha approves on her device with keys wrapped to the hospital.
const doc = await signIn(AMAKA);
const me = await call("/v1/me", doc);
if (me.facility.key_service_url !== KEY_SERVICE.fac_igh) throw new Error("facility has no key service URL");
const { record_id } = await call("/v1/lookup", doc, { nin: AISHA.login.nin });
const reason_sealed = await sealed.sealToFacilityAndCircle(caller(doc) as any, JSON.stringify({ reason: "Chest pain" }), "request-reason", record_id, "fac_igh");
await call(`/v1/records/${record_id}/access-requests`, doc, { categories: ["clinical", "labs"], reason_sealed, patient_can_consent: true });
const aisha = await signIn(AISHA);
const aishaId = (await call("/v1/me", aisha)).id;
const ring = newRing();
const req = (await call("/v1/me/access-requests", aisha)).requests[0];
await call(`/v1/access-requests/${req.request_id}/approve`, aisha, {
  ...(await stepUp(AISHA, aisha)),
  level: "full",
  categories: ["clinical", "labs"],
  wrapped_keys: await rec.wrapKeysForFacility(record_id, ring, ["basic", "clinical", "labs"], fromB64(req.facility.public_key)),
  device_signature: await deviceSig({ action: "approve", subjectId: req.request_id, recordId: record_id, signerId: aishaId, level: "full", categories: ["clinical", "labs"] }),
});

// 2. The doctor opens the record keys through the key service.
const docKeys = keyServiceUnwrapper(KEY_SERVICE.fac_igh, () => doc);
const access = await call(`/v1/records/${record_id}/access`, doc);
const hospRing = await rec.unwrapFacilityKeys(record_id, access.keys, docKeys);
if (toB64(hospRing.get("clinical")!.get(1)!) !== toB64(ring.get("clinical")!.get(1)!)) throw new Error("wrong clinical key");
ok(`doctor opened ${access.keys.length} record keys through the hospital key service (re-wrapped to this session only)`);

// 3. She writes an entry; the consultant decrypts the proposal with the entry key (dek context) and merges.
const docSeed = sc.randomBytes(32);
await call("/v1/me/signing-key", doc, { public_key: toB64(await sc.ed25519PublicKey(docSeed)), ...(await stepUp(AMAKA, doc)) }, "PUT");
const k = rec.latestKey(hospRing, "clinical")!;
const proposal = await call(
  `/v1/records/${record_id}/proposals`,
  doc,
  await rec.buildProposal({
    recordId: record_id, category: "clinical", keyVersion: k.version, categoryKey: k.key, facilityPub: fromB64(me.facility.public_key), signingSeed: docSeed,
    payload: { kind: "Diagnosis", title: "Unstable angina" },
  }),
);
const tunde = await signIn(TUNDE);
const tundeKeys = keyServiceUnwrapper(KEY_SERVICE.fac_igh, () => tunde);
const seen = await rec.decryptEnvelope(proposal, null, { facilityId: "fac_igh", unwrap: tundeKeys });
if (seen?.title !== "Unstable angina") throw new Error("reviewer could not open the proposal");
const tundeSeed = sc.randomBytes(32);
await call("/v1/me/signing-key", tunde, { public_key: toB64(await sc.ed25519PublicKey(tundeSeed)), ...(await stepUp(TUNDE, tunde)) }, "PUT");
const entry = await call(`/v1/proposals/${proposal.proposal_id}/merge`, tunde, { merge_signature: await rec.mergeSignature(tundeSeed, proposal) });
ok(`reviewer opened the proposed entry through the key service and merged it: "${seen.title}"`);

// 4. Sealed text: Aisha disputes it; the Medical Director reads the dispute through the key service.
const d = await call(`/v1/entries/${entry.entry_id}/disputes`, aisha, {
  reason_sealed: await sealed.sealToFacilityAndCircle(caller(aisha) as any, "I was told it was reflux", "dispute-reason", record_id, "fac_igh"),
});
const ngozi = await signIn(NGOZI);
const queue = (await call("/v1/facility/disputes?status=open", ngozi)).disputes;
const text = await sealed.openSealed(queue.find((x: any) => x.dispute_id === d.dispute_id).reason_sealed, "fac_igh", keyServiceUnwrapper(KEY_SERVICE.fac_igh, () => ngozi), "dispute-reason", record_id);
if (text !== "I was told it was reflux") throw new Error("Medical Director could not read the dispute");
ok("Medical Director read the sealed dispute through the key service");

// 5. Refusals: another hospital's staff, and a non-clinical role.
const kunle = await signIn(KUNLE);
const wrapped = fromB64(access.keys.find((x: any) => x.category === "clinical").wrapped);
const ctx = sc.categoryContext(record_id, "clinical", 1);
const expectRefusal = async (url: string, token: string, why: RegExp, who: string) => {
  try {
    await keyServiceUnwrapper(url, () => token)(ctx, wrapped);
  } catch (e) {
    if (why.test((e as Error).message)) return ok(`${who}: refused (${(e as Error).message})`);
    throw e;
  }
  throw new Error(`${who} unwrapped Ikeja General's key`);
};
await expectRefusal(KEY_SERVICE.fac_igh, kunle, /another facility/, "lab scientist from Ade Diagnostics at Ikeja General's key service");
await expectRefusal(KEY_SERVICE.fac_ade, kunle, /not allowed|cannot unwrap/, "Ade Diagnostics' own key service, for Ikeja General's key");
await expectRefusal(KEY_SERVICE.fac_igh, await signIn(KEMI), /not allowed/, "Ikeja General's records officer");
const anon = await fetch(`${KEY_SERVICE.fac_igh}/v1/unwrap`, { method: "POST", body: "{}" });
if (anon.status !== 401) throw new Error(`unauthenticated unwrap answered ${anon.status}`);
ok("a request without a SehatLog session: refused (401)");

// 6. Emergency: Musa can't consent; Aisha (next of kin) approves; the hospital opens escrow parts via the key service.
const musa = await signIn(MUSA);
const musaRec = (await call("/v1/me", musa)).record_id;
const musaRing = newRing();
await esc.setupEscrow(caller(musa) as any, musaRec, musaRing, WEB);
await call(`/v1/records/${musaRec}/access-requests`, doc, {
  categories: ["clinical"],
  patient_can_consent: false,
  reason_sealed: await sealed.sealToFacilityAndCircle(caller(doc) as any, JSON.stringify({ reason: "Collapsed", incapacity: "Unconscious" }), "request-reason", musaRec, "fac_igh"),
});
const nokReq = (await call("/v1/me/access-requests", aisha)).requests.find((r: any) => r.record_id === musaRec);
const con = await call(`/v1/access-requests/${nokReq.request_id}/approve`, aisha, {
  ...(await stepUp(AISHA, aisha)),
  level: "full",
  categories: ["clinical"],
  wrapped_keys: [],
  device_signature: await deviceSig({ action: "approve", subjectId: nokReq.request_id, recordId: musaRec, signerId: aishaId, level: "full", categories: ["clinical"] }),
});
const bundle = await call(`/v1/connections/${con.connection_id}/escrow-release`, doc);
const fromEscrow = await esc.openRelease(musaRec, bundle, docKeys, WEB);
if (toB64(fromEscrow.get("clinical")!.get(1)!) !== toB64(musaRing.get("clinical")!.get(1)!)) throw new Error("escrow gave the wrong key");
ok("next-of-kin approval: the key service opened the three escrow parts; the hospital recovered Musa's clinical key");

// 7. Every unwrap is logged at the hospital and in the patient's activity log.
const log = readFileSync(`${BACKEND}keyservice-data/fac_igh/unwraps.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const audit = (await call(`/v1/records/${record_id}/audit`, aisha)).events.filter((e: any) => e.action.startsWith("hospital key service unwrapped"));
if (!log.some((l) => !l.ok && l.role === "Records Officer") || audit.length === 0) throw new Error("unwraps not logged");
ok(`hospital log holds ${log.length} unwraps (${log.filter((l) => !l.ok).length} refused); Aisha's activity log shows ${audit.length} key-service events`);
