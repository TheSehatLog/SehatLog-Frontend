/* eslint-disable @typescript-eslint/no-explicit-any -- test scripts read untyped API JSON */
// Helpers for the live end-to-end checks. They drive the real stack (start it with
// SehatLog-Backend\scripts\dev-stack.ps1 -Reset, plus `npx next dev -p 3210`) through the
// Next.js proxy, using the web app's own crypto modules. Development data only.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as sc from "../../src/lib/sehatcrypto/index.ts";
import { fromHex, toB64 } from "../../src/lib/live/api.ts";

export const BACKEND = fileURLToPath(new URL("../../../SehatLog-Backend/", import.meta.url));
export const WEB = process.env.SEHATLOG_WEB ?? "http://localhost:3210";
export const PASS = "sehatlog-dev-pass";
export const KEY_SERVICE: Record<string, string> = { fac_igh: "http://localhost:8201", fac_lcth: "http://localhost:8202", fac_ade: "http://localhost:8203" };
const ENV = {
  ...process.env,
  DATABASE_URL: "postgres://sehatlog:sehatlog-dev@localhost:55432/sehatlog?sslmode=disable",
  NIN_PEPPER: "ab".repeat(32),
  TOKEN_SIGNING_KEY: "cd".repeat(32),
  SECRETS_KEY: "ef".repeat(32),
  ESCROW_SIGNING_KEY: "12".repeat(32),
};

export const ok = (m: string) => console.log("ok  -", m);

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function call<T = any>(path: string, token?: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(`${WEB}/api${path}`, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, `${method ?? (body !== undefined ? "POST" : "GET")} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

/** Asserts a call fails with the given status. */
export async function refused(p: Promise<unknown>, status: number, what: string) {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError && e.status === status) return;
    throw e;
  }
  throw new Error(`${what}: expected ${status}, but it succeeded`);
}

export const caller = (token: string) => (path: string, opts: { method?: string; body?: unknown } = {}) => call(path, token, opts.body, opts.method);

// ---- Second factors: a fresh authenticator code when one is free, else an emailed code ----

const usedStep = new Map<string, number>();
const step = () => Math.floor(Date.now() / 30000);

function totpFor(label: string): string | null {
  const now = step();
  if ((usedStep.get(label) ?? -1) >= now) return null;
  const out = execFileSync(`${BACKEND}bin/devseed.exe`, ["codes"], { env: ENV, cwd: BACKEND }).toString();
  if (step() !== now) return null; // the code may already be stale
  usedStep.set(label, now);
  return out.split("\n").find((l) => l.includes(label))!.trim().split("code ").pop()!.trim();
}

async function outboxCode(to: string): Promise<string> {
  const { messages } = await call<{ messages: { body: string }[] }>(`/v1/dev/outbox?to=${encodeURIComponent(to)}`);
  for (const m of messages) {
    const c = m.body.match(/code: (\d{6})/);
    if (c) return c[1];
  }
  throw new Error("no code sent to " + to);
}

export type Who = { label: string; email: string; login: Record<string, string>; kind: "staff" | "citizen" };

export const staffWho = (username: string): Who => ({ label: username, email: `${username}@example.com`, login: { username }, kind: "staff" });
export const citizenWho = (key: string, nin: string): Who => ({ label: nin, email: `${key}@example.com`, login: { nin }, kind: "citizen" });

export const AISHA = citizenWho("aisha", "23456789012");
export const MUSA = citizenWho("musa", "34567890123");
export const FATIMA = citizenWho("fatima", "45678901234");

export async function signIn(w: Who): Promise<string> {
  const code = totpFor(w.label);
  let factor: Record<string, string>;
  if (code) factor = { totp_code: code };
  else {
    await call("/v1/auth/otp", undefined, { account_type: w.kind, channel: "email", ...w.login });
    factor = { otp_code: await outboxCode(w.email) };
  }
  return (await call<{ access_token: string }>(`/v1/auth/${w.kind}/login`, undefined, { ...w.login, password: PASS, ...factor })).access_token;
}

/** Password + second factor for a step-up, as a body fragment. */
export async function stepUp(w: Who, token: string): Promise<Record<string, string>> {
  const code = totpFor(w.label);
  if (code) return { password: PASS, totp_code: code };
  await call("/v1/me/otp", token, { channel: "email" });
  return { password: PASS, otp_code: await outboxCode(w.email) };
}

// ---- Device-signed consents (crypto spec section 9): one fixed device per citizen ----

const seeds = new Map<string, Uint8Array<ArrayBuffer>>();
export async function deviceSig(c: sc.Consent) {
  if (!seeds.has(c.signerId)) seeds.set(c.signerId, sc.randomBytes(32));
  const seed = seeds.get(c.signerId)!;
  return { key_id: "e2e-device", public_key: toB64(await sc.ed25519PublicKey(seed)), signature: toB64(await sc.signConsent(seed, c)) };
}

/** The dev facility private key printed by devseed (only to check the key service holds the same one). */
export function devFacilityKey(facilityId: string) {
  const seed = readFileSync(`${BACKEND}bin/seed.txt`, "utf8");
  return fromHex(seed.match(new RegExp(`${facilityId}\\s+private key \\(dev only\\): ([0-9a-f]{64})`))![1]);
}
