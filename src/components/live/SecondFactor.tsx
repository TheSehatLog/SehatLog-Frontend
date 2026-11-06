"use client";

import { useCallback, useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
import { ApiError } from "@/lib/live/api";
import { useLive } from "./LiveSession";

/** Sends a step-up code to the signed-in user (POST /v1/me/otp). */
export function useSendCode() {
  const { call } = useLive();
  return useCallback(async (channel: "sms" | "email") => {
    await call("/v1/me/otp", { method: "POST", body: { channel } });
  }, [call]);
}

export type Factor = "totp" | "sms" | "email";

/** Password + second factor for confirming a sensitive action while signed in. */
export function useStepUp() {
  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState<Factor>("totp");
  const [code, setCode] = useState("");
  return {
    ready: password.length > 0 && code.length === 6,
    body: { password, ...factorBody(factor, code) } as Record<string, string>,
    props: { password, setPassword, factor, setFactor, code, setCode },
  };
}

export function StepUpFields({
  password,
  setPassword,
  factor,
  setFactor,
  code,
  setCode,
  send,
}: ReturnType<typeof useStepUp>["props"] & { send: (channel: "sms" | "email") => Promise<void> }) {
  return (
    <div className="space-y-3">
      <Field label="Password">
        <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <SecondFactor factor={factor} setFactor={setFactor} code={code} setCode={setCode} send={send} />
    </div>
  );
}

/** The body fields a login or step-up sends for the chosen second factor. */
export function factorBody(factor: Factor, code: string): Record<string, string> {
  return factor === "totp" ? { totp_code: code } : { otp_code: code };
}

/**
 * Second-factor picker: authenticator code, or a one-time code sent by SMS or email.
 * `send` requests the code (POST /v1/auth/otp before login, /v1/me/otp when signed in).
 */
export function SecondFactor({
  factor,
  setFactor,
  code,
  setCode,
  send,
  labels,
}: {
  factor: Factor;
  setFactor: (f: Factor) => void;
  code: string;
  setCode: (c: string) => void;
  send: (channel: "sms" | "email") => Promise<void>;
  labels?: Partial<Record<Factor, string>>;
}) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    if (factor === "totp") return;
    setBusy(true);
    setMsg("");
    try {
      await send(factor);
      setMsg(`Code sent by ${factor === "sms" ? "SMS" : "email"}. It expires in 5 minutes.`);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not send a code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 border-2 border-ink text-xs">
        {(["totp", "sms", "email"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFactor(f);
              setMsg("");
            }}
            className={`py-1.5 font-bold ${factor === f ? "bg-ink text-white" : "bg-white text-ink hover:bg-slate-100"}`}
          >
            {labels?.[f] ?? { totp: "Authenticator", sms: "SMS", email: "Email" }[f]}
          </button>
        ))}
      </div>
      <Field label={factor === "totp" ? "Authenticator code" : `Code from ${factor === "sms" ? "SMS" : "email"}`}>
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            maxLength={6}
            className={`${inputCls} font-mono tracking-widest`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoComplete="one-time-code"
          />
          {factor !== "totp" && (
            <Button type="button" variant="secondary" onClick={sendCode} disabled={busy}>
              {busy ? "Sending…" : "Send code"}
            </Button>
          )}
        </div>
      </Field>
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}
