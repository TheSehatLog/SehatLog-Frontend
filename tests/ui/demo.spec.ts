import { expect, test, type Browser, type Page } from "@playwright/test";
import { NIN, registerSigningKey, scanFinger, signIn, stepUp } from "./helpers";

// The hackathon demo path, clicked through in real browsers against the real stack.
// Each person has their own browser context: their own session and device keys.
test.describe.configure({ mode: "serial" });

const people: Record<string, Page> = {};
let recoveryCode = "";

async function as(browser: Browser, who: string): Promise<Page> {
  if (!people[who]) people[who] = await (await browser.newContext()).newPage();
  return people[who];
}

test("a doctor asks for access and the patient approves on her own device", async ({ browser }) => {
  // Aisha already uses SehatLog on this device: keys and a recovery code.
  const aisha = await as(browser, "aisha");
  await signIn(aisha, "citizen", NIN.aisha);
  const mine = aisha.locator("section").filter({ hasText: "My record (" });
  await mine.getByRole("button", { name: "Create keys on this device" }).click();
  await mine.getByRole("button", { name: "Create recovery code" }).click();
  const codeDialog = aisha.getByRole("dialog", { name: "Your recovery code" });
  recoveryCode = (await codeDialog.locator("p.font-mono").innerText()).trim();
  expect(recoveryCode).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
  await codeDialog.getByRole("button", { name: "I've written it down" }).click();

  const doc = await as(browser, "doctor");
  await signIn(doc, "staff", "amaka.obi");
  await registerSigningKey(doc, "amaka.obi");
  await doc.getByRole("navigation").getByRole("link", { name: "Patients" }).click();
  await doc.getByPlaceholder("11-digit NIN").fill(NIN.aisha);
  await doc.getByRole("button", { name: "Look up" }).click();
  await doc.getByRole("button", { name: "Send request" }).click();
  await expect(doc.getByText("Waiting for the patient")).toBeVisible();

  // The reason was encrypted in the doctor's browser; only the patient's devices open it.
  await aisha.reload();
  await expect(aisha.getByText("Reason: Outpatient consultation")).toBeVisible();
  await aisha.getByRole("button", { name: "Review and approve" }).click();
  const approve = aisha.getByRole("dialog");
  await stepUp(approve, NIN.aisha);
  await approve.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(aisha.getByText("No hospital is waiting for your approval.")).toBeVisible();
});

test("the hospital verifies the signed consent and adds an entry; a consultant merges it", async ({ browser }) => {
  const doc = await as(browser, "doctor");
  await doc.getByRole("button", { name: "Refresh" }).first().click();
  await expect(doc.getByText(/Consent signed on ctz_aisha's device/)).toBeVisible();

  await doc.getByRole("button", { name: "Propose entry" }).click();
  const dialog = doc.getByRole("dialog");
  await dialog.getByLabel("Entry type").selectOption("Allergy");
  await dialog.getByLabel("Title").fill("Penicillin allergy");
  await dialog.getByLabel("Details").fill("Hives and wheeze after amoxicillin, 2019.");
  await dialog.getByRole("button", { name: "Sign and submit" }).click();
  await expect(dialog.getByText(/Submitted/)).toBeVisible();

  const tunde = await as(browser, "consultant");
  await signIn(tunde, "staff", "tunde.adeyemi");
  await registerSigningKey(tunde, "tunde.adeyemi");
  await tunde.getByRole("navigation").getByRole("link", { name: "Review queue" }).click();
  // Decrypted through Ikeja General's key service, in the consultant's browser only.
  await expect(tunde.getByRole("cell", { name: "Penicillin allergy" })).toBeVisible();
  await tunde.getByRole("button", { name: "Sign and merge" }).click();
  await expect(tunde.getByText("Nothing to review.")).toBeVisible();
});

test("the patient sees the entry and her signed consents", async ({ browser }) => {
  const aisha = await as(browser, "aisha");
  await aisha.reload();
  const mine = aisha.locator("section").filter({ hasText: "My record (" });
  await mine.getByRole("button", { name: "Health record" }).click();
  await expect(mine.getByText("Penicillin allergy")).toBeVisible();
  await mine.getByRole("button", { name: "Signed consents" }).click();
  await expect(mine.getByText(/✓ signed by ctz_aisha on device/)).toBeVisible();
});

test("the records desk enrols a new patient with NIN and fingerprint", async ({ browser }) => {
  const kemi = await as(browser, "records");
  await signIn(kemi, "staff", "records.igh");
  await kemi.getByRole("navigation").getByRole("link", { name: "Records desk" }).click();
  const enrol = kemi.locator("section").filter({ hasText: "Enrol a patient" });
  await enrol.getByLabel(/^NIN/).fill("67890123456");
  await scanFinger(enrol, "Aisha Bello", "Scan and enrol");
  await expect(enrol.getByText("the fingerprint does not match this NIN")).toBeVisible();
  await scanFinger(enrol, "Chinedu Okafor", "Scan and enrol");
  await expect(enrol.getByText(/^Enrolled: record rec_/)).toBeVisible();
});

test("a lost phone: a new device restores the keys with the recovery code", async ({ browser }) => {
  const newDevice = await (await browser.newContext()).newPage();
  await signIn(newDevice, "citizen", NIN.aisha);
  const mine = newDevice.locator("section").filter({ hasText: "My record (" });
  await mine.getByPlaceholder("Recovery code: XXXX-XXXX-…").fill(recoveryCode.toLowerCase());
  await mine.getByRole("button", { name: "Restore" }).click();
  await mine.getByRole("button", { name: "Health record" }).click();
  await expect(mine.getByText("Penicillin allergy")).toBeVisible();
});
