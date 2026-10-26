"use client";

import { useState } from "react";
import { FingerprintScanner } from "@/components/live/FingerprintScanner";
import { useLive } from "@/components/live/LiveSession";
import { Badge, Button, Card, Empty, Field, inputCls } from "@/components/ui";
import { ApiError } from "@/lib/live/api";

// The records desk: enrol new patients (NIN checked with the national identity register,
// adults' fingerprints matched) and confirm people recovering their keys in person.
export default function RecordsDesk() {
  const { me } = useLive();
  if (me?.actor_type !== "staff") return <Empty>Sign in as hospital staff.</Empty>;
  if (me.role !== "Records Officer") return <Empty>The records desk is for Records Officers.</Empty>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Records desk · {me.facility.name}</h1>
        <p className="text-sm text-slate-600">Identity checks only. Records Officers never see clinical content.</p>
      </div>
      <Enrol />
      <VerifyRecovery />
    </div>
  );
}

const digits = (s: string) => s.replace(/\D/g, "").slice(0, 11);

function Enrol() {
  const { call } = useLive();
  const [nin, setNin] = useState("");
  const [minor, setMinor] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function enrol(fingerprint?: string) {
    setMsg(null);
    try {
      const r = await call<{ record_id: string }>("/v1/records", { method: "POST", body: { nin, is_minor: minor, ...(fingerprint ? { fingerprint } : {}) } });
      setMsg({ ok: true, text: `Enrolled: record ${r.record_id}. ${minor ? "Add the guardians next." : "The patient can now sign up in the SehatLog app."}` });
      setNin("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Enrolment failed" });
    }
  }

  return (
    <Card title="Enrol a patient">
      <div className="grid max-w-xl gap-3">
        <Field label="NIN (checked with the national identity register)">
          <input className={`${inputCls} font-mono`} value={nin} onChange={(e) => setNin(digits(e.target.value))} placeholder="11 digits" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-teal-700" checked={minor} onChange={(e) => setMinor(e.target.checked)} />
          Child (guardians approve; no fingerprint needed)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {minor ? (
            <Button onClick={() => enrol()} disabled={nin.length !== 11}>
              Enrol child
            </Button>
          ) : (
            <FingerprintScanner label="Scan and enrol" disabled={nin.length !== 11} onScan={(t) => enrol(t)} />
          )}
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</p>}
      </div>
    </Card>
  );
}

function VerifyRecovery() {
  const { call } = useLive();
  const [nin, setNin] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function verify(fingerprint: string) {
    setMsg(null);
    try {
      await call("/v1/recovery-requests/verify", { method: "POST", body: { nin, desk_code: code, fingerprint } });
      setMsg({ ok: true, text: "Identity confirmed. The person can now finish recovery on their new device." });
      setNin("");
      setCode("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Verification failed" });
    }
  }

  return (
    <Card title={<span className="flex items-center gap-2">Key recovery check <Badge tone="amber">In person</Badge></span>}>
      <p className="mb-3 text-sm text-slate-600">
        For someone who lost their device and their recovery code. Check their NIN card, enter the code shown on their new device, and scan their finger. Their keys are then
        released from the emergency escrow to that device only; you never see them.
      </p>
      <div className="grid max-w-xl gap-3">
        <Field label="NIN">
          <input className={`${inputCls} font-mono`} value={nin} onChange={(e) => setNin(digits(e.target.value))} placeholder="11 digits" />
        </Field>
        <Field label="Desk code (from their new device)">
          <input className={`${inputCls} font-mono uppercase tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.slice(0, 9))} placeholder="XXXX-XXXX" />
        </Field>
        <div>
          <FingerprintScanner label="Scan and confirm" disabled={nin.length !== 11 || code.replace("-", "").length !== 8} onScan={verify} />
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</p>}
      </div>
    </Card>
  );
}
