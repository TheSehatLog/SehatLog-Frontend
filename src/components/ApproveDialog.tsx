"use client";

import { useState } from "react";
import { DEMO_PASSWORD } from "@/lib/seed";
import { useSehat, type AccessChoice } from "@/lib/store";
import { CATEGORIES, type AccessRequest, type Category } from "@/lib/types";
import { Button, Field, inputCls, Modal } from "./ui";

const DURATIONS = [
  { label: "Until I remove it", hours: 0 },
  { label: "24 hours", hours: 24 },
  { label: "7 days", hours: 168 },
  { label: "30 days", hours: 720 },
];

// Password + 2FA confirmation, with the approver choosing the access level (PRD section 8).
export function ApproveDialog({ request, approverId, onClose }: { request: AccessRequest; approverId: string; onClose: () => void }) {
  const s = useSehat();
  const hospital = s.hospital(request.hospitalId)!;
  const [level, setLevel] = useState<"full" | "scoped">(request.categories.length >= 4 ? "full" : "scoped");
  const [cats, setCats] = useState<Category[]>(request.categories.filter((c) => c !== "sensitive"));
  const [duration, setDuration] = useState(request.categories.length >= 4 ? 0 : 168);
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"app" | "sms" | "email">("app");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"choose" | "verify">("choose");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [otp] = useState(() => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)));
  const approver = s.citizen(approverId)!;

  function toggle(c: Category) {
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function confirm() {
    if (password !== DEMO_PASSWORD) return setError("Wrong password.");
    if (code !== otp) return setError("Wrong verification code.");
    setBusy(true);
    setError("");
    const choice: AccessChoice =
      level === "full"
        ? { level: "full", categories: cats.includes("sensitive") ? CATEGORIES.map((c) => c.id) : CATEGORIES.map((c) => c.id).filter((c) => c !== "sensitive"), durationHours: duration || undefined }
        : { level: "scoped", categories: cats, durationHours: duration || undefined };
    try {
      await s.approveRequest(request.id, approverId, choice);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Approve ${hospital.name}`} onClose={onClose}>
      {step === "choose" ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-900">{hospital.name}</p>
            <p className="text-slate-600">
              {hospital.address} · HFR {hospital.hfrId}
            </p>
            <p className="mt-1 text-slate-700">
              Reason: <span className="font-medium">{request.reason}</span>
            </p>
            <p className="text-slate-600">Requested by {s.staffById(request.staffId)?.name}</p>
          </div>

          <Field label="Access type">
            <div className="grid grid-cols-2 gap-2">
              {(["full", "scoped"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${level === l ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-300"}`}
                >
                  <span className="block font-medium">{l === "full" ? "Full access" : "Scoped grant"}</span>
                  <span className="text-xs text-slate-600">{l === "full" ? "Read history and merge entries" : "Only the categories you pick"}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field group label="Categories" hint="The Basic Emergency Profile is always included. Sensitive stays off unless you switch it on.">
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.filter((c) => c.id !== "basic").map((c) => (
                <label key={c.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${cats.includes(c.id) ? "border-teal-600 bg-teal-50" : "border-slate-300"}`}>
                  <input type="checkbox" className="accent-teal-700" checked={cats.includes(c.id)} onChange={() => toggle(c.id)} />
                  {c.label}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Duration">
            <select className={inputCls} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d.hours} value={d.hours}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setStep("verify")} disabled={level === "scoped" && cats.length === 0}>
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Confirm as <span className="font-medium">{approver.name}</span> with your password and second factor.
          </p>
          <Field label="Password" hint={`Demo password: ${DEMO_PASSWORD}`}>
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <Field label="Second factor">
            <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="app">Authenticator app</option>
              <option value="sms">SMS to {approver.phone.slice(0, 8)}••••</option>
              <option value="email">Email to {approver.email.replace(/^(.).*@/, "$1•••@")}</option>
            </select>
          </Field>
          <div className="rounded-lg border border-dashed border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
            <span className="text-xs uppercase tracking-wide text-sky-700">Simulated {method === "app" ? "authenticator" : method.toUpperCase()}</span>
            <p>
              Your SehatLog code is <span className="font-mono text-base font-semibold tracking-widest">{otp}</span>
            </p>
          </div>
          <Field label="6-digit code">
            <input inputMode="numeric" maxLength={6} className={`${inputCls} font-mono tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep("choose")}>
              Back
            </Button>
            <Button onClick={confirm} disabled={busy}>
              {busy ? "Encrypting keys for hospital…" : "Approve"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
