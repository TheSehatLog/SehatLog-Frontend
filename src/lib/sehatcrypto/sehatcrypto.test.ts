// Checks this implementation against the shared vectors from SehatLog-Backend/crypto-spec.
// Run: npm run test:crypto
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as sc from "./index.ts";

const v = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));
const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16)) as Uint8Array<ArrayBuffer>;
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const utf8 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const rejects = (p: Promise<unknown>) => assert.rejects(p);

test("spec version", () => assert.equal(v.spec, "sehatlog-crypto-v1"));

test("aes_kw", async () => {
  for (const c of v.aes_kw) {
    assert.equal(toHex(await sc.aesKwWrap(hex(c.kek), hex(c.key))), c.wrapped, c.name);
    assert.equal(toHex(await sc.aesKwUnwrap(hex(c.kek), hex(c.wrapped))), c.key, c.name);
  }
});

test("entry_seal", async () => {
  for (const c of v.entry_seal) {
    const ct = await sc.sealEntry(hex(c.dek), hex(c.nonce), utf8(c.plaintext_utf8), c.record_id, c.category, c.key_version);
    assert.equal(toHex(ct), c.ciphertext, c.name);
    const pt = await sc.openEntry(hex(c.dek), hex(c.nonce), ct, c.record_id, c.category, c.key_version);
    assert.equal(new TextDecoder().decode(pt), c.plaintext_utf8, c.name);
    await rejects(sc.openEntry(hex(c.dek), hex(c.nonce), ct, c.record_id, "sensitive", c.key_version));
  }
});

test("key_wrap", async () => {
  for (const c of v.key_wrap) {
    assert.equal(toHex(await sc.x25519PublicKey(hex(c.recipient_private))), c.recipient_public, c.name);
    assert.equal(toHex(await sc.x25519PublicKey(hex(c.ephemeral_private))), c.ephemeral_public, c.name);
    const blob = await sc.wrapToPublicKey(hex(c.recipient_public), c.context, hex(c.key), hex(c.ephemeral_private));
    assert.equal(toHex(blob), c.wrapped, c.name);
    assert.equal(toHex(await sc.unwrapWithPrivateKey(hex(c.recipient_private), c.context, hex(c.wrapped))), c.key, c.name);
    await rejects(sc.unwrapWithPrivateKey(hex(c.recipient_private), c.context + "x", hex(c.wrapped)));
  }
});

test("random ephemeral wrap round-trips", async () => {
  const priv = sc.randomBytes(32);
  const key = sc.randomBytes(32);
  const blob = await sc.wrapToPublicKey(await sc.x25519PublicKey(priv), "dek|ent_test", key);
  assert.equal(toHex(await sc.unwrapWithPrivateKey(priv, "dek|ent_test", blob)), toHex(key));
});

test("blind_index", async () => {
  for (const c of v.blind_index) assert.equal(await sc.blindIndex(hex(c.pepper), c.nin), c.index);
});

test("entry_signature", async () => {
  for (const c of v.entry_signature) {
    const env: sc.Envelope = {
      recordId: c.record_id,
      entryId: c.entry_id,
      category: c.category,
      keyVersion: c.key_version,
      nonce: hex(c.nonce),
      ciphertext: hex(c.ciphertext),
      wrappedDek: hex(c.wrapped_dek),
      authorWrappedDek: hex(c.author_wrapped_dek),
      amendsEntryId: c.amends_entry_id,
      inputMethod: c.input_method,
    };
    assert.equal(new TextDecoder().decode(sc.signingInput(env)), c.signing_input_utf8);
    assert.equal(toHex(await sc.ed25519PublicKey(hex(c.seed))), c.public_key);
    assert.equal(toHex(await sc.signEnvelope(hex(c.seed), env)), c.signature);
    assert.ok(await sc.verifyEnvelope(hex(c.public_key), env, hex(c.signature)));
    assert.ok(!(await sc.verifyEnvelope(hex(c.public_key), { ...env, keyVersion: env.keyVersion + 1 }, hex(c.signature))));
    assert.ok(!(await sc.verifyEnvelope(hex(c.public_key), { ...env, amendsEntryId: "ent_other" }, hex(c.signature))));
  }
});

test("merge_signature", async () => {
  for (const c of v.merge_signature) {
    const input = sc.mergeSigningInput(c.proposal_id, c.entry_id, c.record_id, hex(c.author_signature));
    assert.equal(new TextDecoder().decode(input), c.signing_input_utf8);
    assert.equal(toHex(await sc.signMerge(hex(c.reviewer_seed), c.proposal_id, c.entry_id, c.record_id, hex(c.author_signature))), c.signature);
  }
});

test("dispense_signature", async () => {
  for (const c of v.dispense_signature) {
    const input = sc.dispenseSigningInput(c.entry_id, c.record_id, c.facility_id, hex(c.merge_signature));
    assert.equal(new TextDecoder().decode(input), c.signing_input_utf8);
    assert.equal(toHex(await sc.ed25519PublicKey(hex(c.pharmacist_seed))), c.pharmacist_public_key);
    assert.equal(toHex(await sc.signDispense(hex(c.pharmacist_seed), c.entry_id, c.record_id, c.facility_id, hex(c.merge_signature))), c.signature);
  }
});

test("file_seal", async () => {
  for (const c of v.file_seal) {
    const sealed = await sc.sealFile(hex(c.key), hex(c.nonce), hex(c.plaintext), c.record_id, c.file_id, c.category);
    assert.equal(toHex(sealed), c.sealed);
    assert.equal(toHex(await sc.openFile(hex(c.key), hex(c.sealed), c.record_id, c.file_id, c.category)), c.plaintext);
    await rejects(sc.openFile(hex(c.key), hex(c.sealed), "rec_other", c.file_id, c.category));
  }
});

test("text_seal", async () => {
  for (const c of v.text_seal) {
    assert.equal(toHex(await sc.sealText(hex(c.content_key), hex(c.nonce), c.text_utf8, c.purpose, c.record_id)), c.sealed);
    const pub = await sc.x25519PublicKey(hex(c.recipient_private));
    assert.equal(toHex(await sc.wrapToPublicKey(pub, sc.textContext(c.purpose, c.record_id), hex(c.content_key), hex(c.ephemeral_private))), c.wrapped);
    const key = await sc.unwrapWithPrivateKey(hex(c.recipient_private), sc.textContext(c.purpose, c.record_id), hex(c.wrapped));
    assert.equal(await sc.openText(key, hex(c.sealed), c.purpose, c.record_id), c.text_utf8);
    await rejects(sc.openText(key, hex(c.sealed), "review-comment", c.record_id));
  }
});

test("consent_signature", async () => {
  for (const c of v.consent_signature) {
    const con = {
      action: c.action as "approve",
      subjectId: c.subject_id,
      recordId: c.record_id,
      signerId: c.signer_id,
      level: c.level,
      categories: c.categories,
      durationHours: c.duration_hours,
    };
    assert.equal(sc.consentStatement(con), c.statement_utf8);
    assert.equal(toHex(await sc.signConsent(hex(c.seed), con)), c.signature);
    assert.equal(toHex(await sc.ed25519PublicKey(hex(c.seed))), c.public_key);
    assert.ok(await sc.verifyConsent(hex(c.public_key), c.statement_utf8, hex(c.signature)));
    assert.ok(!(await sc.verifyConsent(hex(c.public_key), c.statement_utf8.replace("record=", "record=x"), hex(c.signature))));
  }
});

test("key_backup", async () => {
  for (const c of v.key_backup) {
    const code = hex(c.code);
    assert.equal(sc.encodeRecoveryCode(code), c.code_text);
    assert.equal(toHex(sc.decodeRecoveryCode(c.typed_as)), c.code);
    assert.throws(() => sc.decodeRecoveryCode(c.code_text.slice(0, 30)));
    assert.equal(toHex(await sc.backupKey(code, c.record_id)), c.backup_key);
    assert.equal(toHex(await sc.sealBackup(code, hex(c.nonce), new TextEncoder().encode(c.plaintext_utf8) as Uint8Array<ArrayBuffer>, c.record_id)), c.sealed);
    assert.equal(new TextDecoder().decode(await sc.openBackup(code, hex(c.sealed), c.record_id)), c.plaintext_utf8);
    await rejects(sc.openBackup(code, hex(c.sealed), "rec_other"));
  }
});

test("escrow", async () => {
  for (const c of v.escrow) {
    const k = sc.combineEscrowParts(hex(c.s), hex(c.r), hex(c.i));
    assert.equal(toHex(k), c.k);
    assert.equal(toHex(await sc.sealEscrowKey(k, hex(c.nonce), hex(c.escrow_private), c.record_id)), c.sealed);
    assert.equal(toHex(await sc.openEscrowKey(k, hex(c.nonce), hex(c.sealed), c.record_id)), c.escrow_private);
    const zero = new Uint8Array(32);
    await rejects(sc.openEscrowKey(sc.combineEscrowParts(hex(c.s), zero, zero), hex(c.nonce), hex(c.sealed), c.record_id));
  }
});
