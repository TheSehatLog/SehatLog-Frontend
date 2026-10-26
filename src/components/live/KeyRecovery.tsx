"use client";

import { useState } from "react";
import { useLive } from "./LiveSession";
import { StepUpFields, useSendCode, useStepUp } from "./SecondFactor";
import { Button, Field, inputCls, Modal } from "@/components/ui";
import { ApiError } from "@/lib/live/api";
import { finishDeskRecovery, newRecoveryCode, recoveryStatus, restoreWithCode, startDeskRecovery, uploadBackup, type RecoveryRequest } from "@/lib/live/backup";
import { ensureDeviceKey, getRecoveryCode, setRecordKeys, setRecoveryCode } from "@/lib/live/keystore";
import type { KeyRing } from "@/lib/live/records";
import * as sc from "@/lib/sehatcrypto";

type Call = ReturnType<typeof useLive>["call"];

/** Re-seals the backup after the keys changed (rotation, keys received), if a code is set. */
export async function refreshBackup(call: Call, recordId: string, ring: KeyRing | null) {
  const code = getRecoveryCode(recordId);
  if (code && ring) await uploadBackup(call, recordId, ring, code);
}

/** With keys on this device: the recovery code. Without: ways to get them back. */
export function KeyRecovery({ recordId, ring, onRing }: { recordId: string; ring: KeyRing | null; onRing: () => void }) {
  return ring ? <RecoveryCodeStatus recordId={recordId} ring={ring} /> : <RecoverKeys recordId={recordId} onRing={onRing} />;
}

function RecoveryCodeStatus({ recordId, ring }: { recordId: string; ring: KeyRing }) {
  const { call } = useLive();
  const [code, setCode] = useState(() => getRecoveryCode(recordId));
  const [show, setShow] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function create() {
    setError("");
    try {
      const c = newRecoveryCode();
      await uploadBackup(call, recordId, ring, c);
      setRecoveryCode(recordId, c);
      setCode(c);
      setShow(sc.encodeRecoveryCode(c));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the backup");
    }
  }

  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${code ? "border-slate-200" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <span className="flex-1">
        {code
          ? "Recovery code set: if you lose this device, your code restores the keys."
          : "No recovery code yet. If you lose this device, you'd need to visit a records desk to recover your keys."}
        {error && <span className="block text-rose-700">{error}</span>}
      </span>
      {code ? (
        <Button variant="ghost" onClick={() => setShow(sc.encodeRecoveryCode(code))}>
          Show code
        </Button>
      ) : (
        <Button variant="secondary" onClick={create}>
          Create recovery code
        </Button>
      )}
      {show && (
        <Modal open title="Your recovery code" onClose={() => setShow(null)}>
          <div className="space-y-3 text-sm">
            <p className="rounded-lg bg-slate-900 px-4 py-3 text-center font-mono text-lg tracking-wider text-white">{show}</p>
            <p className="text-slate-700">
              Write it down and keep it somewhere safe, away from this device. It opens an encrypted backup of this record&apos;s keys. SehatLog doesn&apos;t have it and
              can&apos;t reset it.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setShow(null)}>I&apos;ve written it down</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RecoverKeys({ recordId, onRing }: { recordId: string; onRing: () => void }) {
  const { call, me } = useLive();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [desk, setDesk] = useState(false);

  async function restore() {
    setError("");
    try {
      const { ring, code } = await restoreWithCode(call, recordId, typed);
      setRecordKeys(recordId, ring);
      setRecoveryCode(recordId, code);
      onRing();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "No backup was ever saved for this record." : e instanceof Error ? e.message : "Restore failed");
    }
  }

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="font-medium">Get this record&apos;s keys on this device</p>
      <div className="flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-md font-mono`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Recovery code: XXXX-XXXX-…" />
        <Button onClick={restore} disabled={typed.replace(/[-\s]/g, "").length !== 32}>
          Restore
        </Button>
      </div>
      <p>
        Lost the code too?{" "}
        <button className="font-medium underline" onClick={() => setDesk(true)} disabled={me?.actor_type !== "citizen"}>
          Recover at a hospital records desk
        </button>{" "}
        with your NIN and fingerprint.
      </p>
      {error && <p className="text-rose-700">{error}</p>}
      {desk && me?.actor_type === "citizen" && <DeskRecovery recordId={recordId} citizenId={me.id} onClose={() => setDesk(false)} onRing={onRing} />}
    </div>
  );
}

function DeskRecovery({ recordId, citizenId, onClose, onRing }: { recordId: string; citizenId: string; onClose: () => void; onRing: () => void }) {
  const { call } = useLive();
  const step = useStepUp();
  const sendCode = useSendCode();
  const [req, setReq] = useState<RecoveryRequest | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setMsg("");
    try {
      setReq(await startDeskRecovery(call, recordId, ensureDeviceKey(citizenId).keyId, step.body));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not start recovery");
    }
  }

  async function check() {
    if (!req) return;
    setBusy(true);
    setMsg("");
    try {
      const st = await recoveryStatus(call, req.request_id);
      if (st.status !== "verified") {
        setMsg(st.status === "pending" ? "Not verified at a desk yet." : `This request is ${st.status}. Start again.`);
        return;
      }
      const ring = await finishDeskRecovery(call, recordId, req.request_id, ensureDeviceKey(citizenId).priv);
      setRecordKeys(recordId, ring);
      onRing();
      onClose();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Recovery failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="Recover at a records desk" onClose={onClose}>
      <div className="space-y-4 text-sm">
        {!req ? (
          <>
            <p className="text-slate-700">
              Your keys come back through the emergency escrow, released to this device only, after a Records Officer checks your NIN and fingerprint. Everyone who manages
              this record is alerted.
            </p>
            <StepUpFields {...step.props} send={sendCode} />
            <div className="flex justify-end">
              <Button onClick={start} disabled={!step.ready}>
                Get a desk code
              </Button>
            </div>
          </>
        ) : (
          <>
            <Field label="Show this code at the records desk, with your NIN card">
              <p className="rounded-lg bg-slate-900 px-4 py-3 text-center font-mono text-2xl tracking-widest text-white">{req.desk_code}</p>
            </Field>
            <p className="text-slate-600">Valid for 24 hours. After the officer confirms it, come back here.</p>
            <div className="flex justify-end">
              <Button onClick={check} disabled={busy}>
                {busy ? "Collecting keys from the custodians…" : "I've been verified: get my keys"}
              </Button>
            </div>
          </>
        )}
        {msg && <p className="text-rose-700">{msg}</p>}
      </div>
    </Modal>
  );
}
