import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { BACKEND, NIN, registerSigningKey, scanFinger, signIn, stepUp } from "./helpers";

// The hackathon demo story (DEMO.md), clicked through on the seeded stack:
// Musa collapses and arrives unconscious, without ID, at Ikeja General.
test.describe.configure({ mode: "serial" });

const people: Record<string, Page> = {};
async function as(browser: Browser, who: string): Promise<Page> {
  if (!people[who]) people[who] = await (await browser.newContext()).newPage();
  return people[who];
}

test("before the demo: Aisha (Musa's next of kin) is signed in on her phone", async ({ browser }) => {
  const aisha = await as(browser, "aisha");
  await signIn(aisha, "citizen", NIN.aisha);
  await expect(aisha.getByText("No hospital is waiting for your approval.")).toBeVisible();
});

test("1. unconscious, no ID: a fingerprint finds Musa and releases his emergency profile", async ({ browser }) => {
  const doc = await as(browser, "doctor");
  await signIn(doc, "staff", "amaka.obi");
  await registerSigningKey(doc, "amaka.obi");
  await doc.getByRole("navigation").getByRole("link", { name: "Patients" }).click();
  await scanFinger(doc.locator("section").filter({ hasText: "Find a patient" }), "Musa Bello", "Scan and identify");
  const profile = doc.locator("section").filter({ hasText: "Basic Emergency Profile" });
  await scanFinger(profile, "Musa Bello", "Scan and release");
  await expect(profile.getByText("Penicillin allergy: anaphylaxis")).toBeVisible();
  await expect(profile.getByText("Blood group O+")).toBeVisible();
  await expect(profile.getByText("Type 1 diabetes, insulin-dependent")).toBeVisible();
});

test("2. he can't consent: the request goes to his next of kin, who approves on her phone", async ({ browser }) => {
  const doc = await as(browser, "doctor");
  await doc.getByLabel("Reason (encrypted: only the approvers and your facility can read it)").fill("Collapsed at home, found unresponsive");
  await doc.getByRole("button", { name: "Unable to consent" }).click();
  await doc.getByRole("button", { name: "Send request" }).click();
  await expect(doc.getByText("Waiting for next of kin")).toBeVisible();

  const aisha = await as(browser, "aisha");
  await aisha.reload();
  await expect(aisha.getByText("You are next of kin, and the patient cannot consent")).toBeVisible();
  await expect(aisha.getByText(/Collapsed at home, found unresponsive · Patient status: Unconscious/)).toBeVisible();
  await aisha.getByRole("button", { name: "Review and approve" }).click();
  const approve = aisha.getByRole("dialog");
  await stepUp(approve, NIN.aisha);
  await approve.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(aisha.getByText("No hospital is waiting for your approval.")).toBeVisible();
});

test("3. Ikeja General opens his full history from Lagos Central through the escrow", async ({ browser }) => {
  const doc = await as(browser, "doctor");
  await doc.getByRole("button", { name: "Refresh" }).first().click();
  await doc.getByRole("button", { name: "Unlock keys from emergency escrow" }).click();
  await expect(doc.getByText("Diabetes clinic review")).toBeVisible();
  await expect(doc.getByText("HbA1c 8.1%")).toBeVisible();
});

test("4. emergency treatment goes on the record at once (fast-track), pending review", async ({ browser }) => {
  const doc = await as(browser, "doctor");
  await doc.getByRole("button", { name: "Propose entry" }).click();
  const dialog = doc.getByRole("dialog");
  await dialog.getByLabel("Title").fill("Severe hypoglycaemia: IV dextrose 50 ml given");
  await dialog.getByLabel("Details").fill("Glucose 1.9 mmol/L on arrival. Recovered consciousness in 10 minutes. No penicillin given.");
  await dialog.getByText(/Emergency fast-track/).click();
  await dialog.getByRole("button", { name: "Sign and merge now" }).click();
  await expect(dialog.getByText(/Merged as an emergency entry/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click().catch(() => {});
  await expect(doc.getByText("Emergency · pending review").first()).toBeVisible();
});

test("5. Musa wakes up: a new phone, his recovery code, and a full account of who saw what", async ({ browser }) => {
  const code = readFileSync(`${BACKEND}bin\\demo.txt`, "utf8").match(/Recovery code[^:]*: ([0-9A-Z-]+)/)![1];
  const musa = await as(browser, "musa");
  await signIn(musa, "citizen", NIN.musa);
  const mine = musa.locator("section").filter({ hasText: "My record (" });
  await mine.getByPlaceholder("Recovery code: XXXX-XXXX-…").fill(code);
  await mine.getByRole("button", { name: "Restore" }).click();
  await mine.getByRole("button", { name: "Health record" }).click();
  await expect(mine.getByText("Severe hypoglycaemia: IV dextrose 50 ml given")).toBeVisible();
  await mine.getByRole("button", { name: "Activity log" }).click();
  await expect(mine.getByText(/identified by fingerprint/).first()).toBeVisible();
  await expect(mine.getByText(/approved access \(nok, full\)/).first()).toBeVisible();
  await expect(mine.getByText(/hospital key service unwrapped/).first()).toBeVisible();
  await mine.getByRole("button", { name: /Connected hospitals/ }).click();
  await expect(mine.getByText("Ikeja General Hospital")).toBeVisible();
  await expect(mine.getByText("Lagos Central Teaching Hospital")).toBeVisible();
});

test("6. the discharge prescription: the allergy check stops a penicillin, a consultant merges the safe one", async ({ browser }) => {
  const doc = await as(browser, "doctor");
  await doc.getByRole("button", { name: "Propose entry" }).click();
  const dialog = doc.getByRole("dialog");
  await dialog.getByLabel("Entry type").selectOption("Prescription");
  await dialog.getByLabel("Medicine and strength").fill("Amoxicillin 500 mg capsules");
  // Checked in the doctor's browser against his decrypted allergies; SehatLog never sees either.
  await expect(dialog.getByText("Stop: allergy conflict.")).toBeVisible();
  await expect(dialog.getByText(/Amoxicillin is a penicillin/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Sign and submit" })).toBeDisabled();
  await dialog.getByLabel("Medicine and strength").fill("Azithromycin 500 mg tablets");
  await expect(dialog.getByText(/Allergy check passed/)).toBeVisible();
  await dialog.getByLabel("Dose", { exact: true }).fill("1 tablet by mouth");
  await dialog.getByLabel("Frequency", { exact: true }).fill("Once daily");
  await dialog.getByLabel("Duration", { exact: true }).fill("3 days");
  await dialog.getByLabel("Quantity", { exact: true }).fill("3 tablets");
  await dialog.getByRole("button", { name: "Sign and submit" }).click();
  await expect(dialog.getByText(/Submitted/)).toBeVisible();

  const tunde = await as(browser, "consultant");
  await signIn(tunde, "staff", "tunde.adeyemi");
  await registerSigningKey(tunde, "tunde.adeyemi");
  await tunde.getByRole("navigation").getByRole("link", { name: "Review queue" }).click();
  await expect(tunde.getByRole("cell", { name: "Azithromycin 500 mg tablets" })).toBeVisible();
  await tunde.getByRole("button", { name: "Sign and merge" }).click();
  await expect(tunde.getByText("Nothing to review.")).toBeVisible();
});

test("7. at the pharmacy: Musa approves on his phone, the pharmacist re-checks and dispenses once", async ({ browser }) => {
  const pharm = await as(browser, "pharmacist");
  await signIn(pharm, "staff", "ifeoma.okafor");
  await registerSigningKey(pharm, "ifeoma.okafor");
  await pharm.getByRole("navigation").getByRole("link", { name: "Patients" }).click();
  await pharm.getByPlaceholder("11-digit NIN").fill(NIN.musa);
  await pharm.getByRole("button", { name: "Look up" }).click();
  await pharm.getByRole("button", { name: "Send request" }).click();

  const musa = await as(browser, "musa");
  await musa.reload();
  await musa.getByRole("button", { name: "Review and approve" }).click();
  const approve = musa.getByRole("dialog");
  await stepUp(approve, NIN.musa);
  await approve.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(musa.getByText("No hospital is waiting for your approval.")).toBeVisible();

  await pharm.getByRole("button", { name: "Refresh" }).first().click();
  // The pharmacy opens only Basic (allergies) and Medications, never the clinical notes.
  await expect(pharm.getByText("Azithromycin 500 mg tablets")).toBeVisible();
  await expect(pharm.getByText("Diabetes clinic review")).toHaveCount(0);
  await pharm.getByRole("button", { name: "Dispense", exact: true }).click();
  const dialog = pharm.getByRole("dialog");
  await expect(dialog.getByText(/Allergy check passed/)).toBeVisible();
  await dialog.getByText(/I have checked the patient's identity/).click();
  await dialog.getByRole("button", { name: "Sign and dispense" }).click();
  await expect(dialog.getByText("Dispensed. The patient has been notified.")).toBeVisible();
  await expect(pharm.getByText(/Dispensed at Opebi Community Pharmacy/)).toBeVisible();
  await expect(pharm.getByRole("button", { name: "Dispense", exact: true })).toHaveCount(0);

  await musa.reload();
  const mine = musa.locator("section").filter({ hasText: "My record (" });
  await mine.getByRole("button", { name: "Health record" }).click();
  await expect(mine.getByText(/Dispensed at Opebi Community Pharmacy/)).toBeVisible();
  await mine.getByRole("button", { name: "Activity log" }).click();
  await expect(mine.getByText(/dispensed prescription/).first()).toBeVisible();
});
