import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

export const BACKEND = path.resolve(__dirname, "../../../SehatLog-Backend") + path.sep;
export const PASS = "sehatlog-dev-pass";

const ENV = {
  ...process.env,
  DATABASE_URL: "postgres://sehatlog:sehatlog-dev@localhost:55432/sehatlog?sslmode=disable",
  NIN_PEPPER: "ab".repeat(32),
  TOKEN_SIGNING_KEY: "cd".repeat(32),
  SECRETS_KEY: "ef".repeat(32),
  ESCROW_SIGNING_KEY: "12".repeat(32),
};

// Authenticator codes can't be replayed, so each account waits for a new 30 s step.
const used = new Map<string, number>();
const step = () => Math.floor(Date.now() / 30_000);

export async function totp(label: string): Promise<string> {
  for (;;) {
    while ((used.get(label) ?? -1) >= step()) await new Promise((r) => setTimeout(r, 500));
    const now = step();
    const out = execFileSync(`${BACKEND}bin\\devseed.exe`, ["codes"], { env: ENV, cwd: BACKEND }).toString();
    if (step() !== now) continue;
    used.set(label, now);
    return out.split("\n").find((l) => l.includes(label))!.trim().split("code ").pop()!.trim();
  }
}

export const NIN = { aisha: "23456789012", musa: "34567890123", fatima: "45678901234" };

/** Signs in through the login page. */
export async function signIn(page: Page, kind: "staff" | "citizen", ident: string) {
  await page.goto("/live");
  await page.getByRole("button", { name: kind === "staff" ? "Hospital staff" : "Citizen", exact: true }).click();
  await page.getByLabel(kind === "staff" ? "Username" : "NIN").fill(ident);
  await page.getByLabel("Password").fill(PASS);
  await page.getByLabel("Authenticator code").fill(await totp(ident));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(kind === "staff" ? /\/live\/hospital/ : /\/live\/citizen/);
}

/** Fills password + authenticator code inside a dialog or card. */
export async function stepUp(scope: Locator, ident: string) {
  await scope.getByLabel("Password").fill(PASS);
  await scope.getByLabel("Authenticator code").fill(await totp(ident));
}

/** Staff: register a signing key under Keys (needed to propose or merge). */
export async function registerSigningKey(page: Page, username: string) {
  await page.getByRole("navigation").getByRole("link", { name: "Keys" }).click();
  await expect(page.getByText("Hospital key service")).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const card = page.locator("section").filter({ hasText: "Your signing key" });
  await stepUp(card, username);
  await card.getByRole("button", { name: /^(Generate and register|Replace key)$/ }).click();
  await expect(card.getByText("This device holds the matching private key.")).toBeVisible();
  await expect(card.getByText("Registered", { exact: true })).toBeVisible();
}

/** Picks whose finger is on the simulated scanner and scans. */
export async function scanFinger(scope: Locator | Page, person: string, button: string) {
  await scope.getByLabel("Simulated finger on the scanner").selectOption({ label: person });
  await scope.getByRole("button", { name: button }).click();
}
