import assert from "node:assert/strict";
import test from "node:test";
import { allergiesOf, checkAllergies, medicineName } from "./allergy.ts";

const penicillin = { kind: "Allergy", title: "Penicillin allergy: anaphylaxis", details: "Collapsed after IV ampicillin, 2021. Avoid all penicillins." };
const sulfa = { kind: "Allergy", title: "Sulfa drugs", fields: { Reaction: "Rash" } };
const codeine = { kind: "Allergy", title: "Codeine: severe vomiting" };

test("a penicillin is stopped against a penicillin allergy", () => {
  const got = checkAllergies("Amoxicillin 500 mg capsules", [penicillin]);
  assert.equal(got.length, 1);
  assert.equal(got[0].level, "stop");
  assert.match(got[0].message, /Amoxicillin is a penicillin/);
  assert.equal(got[0].allergy, penicillin.title);
});

test("the named medicine itself is stopped", () => {
  assert.equal(checkAllergies("Codeine phosphate 30 mg", [codeine])[0].message, "Recorded allergy to Codeine.");
  assert.equal(checkAllergies("Ampicillin 1 g IV", [penicillin])[0].level, "stop");
});

test("classes match through aliases and members", () => {
  assert.equal(checkAllergies("Co-trimoxazole 960 mg", [sulfa])[0].level, "stop");
  assert.equal(checkAllergies("Tramadol 50 mg", [codeine])[0].message, "Tramadol is an opioid. The patient has a recorded opioid allergy.");
});

test("cross-reactive classes get a caution, not a stop", () => {
  const got = checkAllergies("Ceftriaxone 1 g IV", [penicillin]);
  assert.deepEqual(got.map((a) => a.level), ["caution"]);
});

test("unrelated medicines pass", () => {
  assert.deepEqual(checkAllergies("Azithromycin 500 mg once daily", [penicillin, sulfa, codeine]), []);
  assert.deepEqual(checkAllergies("Paracetamol 1 g", [penicillin]), []);
  assert.deepEqual(checkAllergies("", [penicillin]), []);
});

test("only current Allergy entries count", () => {
  const items = [
    { payload: penicillin, status: "current" },
    { payload: { kind: "Allergy", title: "Old: latex" }, status: "superseded" },
    { payload: { kind: "Note", title: "Penicillin given in 2019" }, status: "current" },
    { payload: null, status: "current" },
  ];
  assert.deepEqual(allergiesOf(items), [penicillin]);
  assert.equal(medicineName("  Metformin 500mg"), "metformin");
});
