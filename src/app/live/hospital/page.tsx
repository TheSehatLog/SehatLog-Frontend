"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EntryView } from "@/components/live/EntryView";
import { useLive } from "@/components/live/LiveSession";
import { Sealed, useSealedText } from "@/components/live/Sealed";
import { Badge, Button, Card, Empty, Field, fmt, inputCls, Modal } from "@/components/ui";
import { ApiError, fromB64, type AccessRequest, type Connection, type Entry, type Me, type Proposal, type WrappedKey } from "@/lib/live/api";
import { CATEGORIES, CATEGORY_LABEL, getSigningSeed } from "@/lib/live/keystore";
import { useFacilityKeys } from "@/components/live/FacilityKeys";
import { FingerprintScanner } from "@/components/live/FingerprintScanner";
import { openRelease, type ReleaseBundle } from "@/lib/live/escrow";
import { verifySignedConsent, type SignedConsent } from "@/lib/live/consent";
import { MAX_FILE_BYTES, uploadEncrypted } from "@/lib/live/files";
import { parseRequestReason, sealToFacilityAndCircle } from "@/lib/live/sealed";
import { buildProposal, decryptEnvelope, latestKey, mergeSignature, unwrapFacilityKeys, wrapKeysForFacility, type KeyRing, type Payload } from "@/lib/live/records";

type StaffMe = Extract<Me, { actor_type: "staff" }>;
type Access =
  | { connected: false; pending_request?: AccessRequest }
  | { connected: true; connection: Connection; role_categories: string[]; keys: WrappedKey[]; consents: SignedConsent[] };

export default function HospitalPage() {
  const { me, call } = useLive();
  const [nin, setNin] = useState("");
  const [record, setRecord] = useState<{ record_id: string; is_minor: boolean } | null>(null);
  const [error, setError] = useState("");

  if (me?.actor_type !== "staff") return <Empty>Sign in as hospital staff to look up patients.</Empty>;

  async function find(body: { nin: string } | { fingerprint: string }) {
    setError("");
    setRecord(null);
    try {
      setRecord(await call("/v1/lookup", { method: "POST", body }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lookup failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{me.facility.name}</h1>
        <p className="text-sm text-slate-600">
          {me.full_name} · {me.role}
          {me.specialty ? `, ${me.specialty}` : ""}
        </p>
      </div>
      <KeyWarnings me={me} />
      <Card title="Find a patient">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            find({ nin });
          }}
          className="flex max-w-md gap-2"
        >
          <input className={`${inputCls} font-mono`} value={nin} onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="11-digit NIN" />
          <Button type="submit" disabled={nin.length !== 11}>
            Look up
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>No ID, or unconscious? Identify by fingerprint:</span>
          <FingerprintScanner label="Scan and identify" onScan={(fingerprint) => find({ fingerprint })} />
        </div>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </Card>
      {record && <PatientPanel key={record.record_id} me={me} recordId={record.record_id} isMinor={record.is_minor} />}
    </div>
  );
}

function KeyWarnings({ me }: { me: StaffMe }) {
  const { source } = useFacilityKeys();
  const missing = [!source && "facility key", !me.signing_public_key && "signing key"].filter(Boolean);
  if (missing.length === 0) return null;
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      Missing on this device: {missing.join(" and ")}. Add {missing.length > 1 ? "them" : "it"} under{" "}
      <Link href="/live/settings" className="font-medium underline">
        Keys
      </Link>{" "}
      to read and write records.
    </p>
  );
}

function PatientPanel({ me, recordId, isMinor }: { me: StaffMe; recordId: string; isMinor: boolean }) {
  const { call } = useLive();
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    call<Access>(`/v1/records/${recordId}/access`)
      .then(setAccess)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load access"));
  }, [call, recordId, tick]);

  return (
    <div className="space-y-4">
      <Card
        title={
          <span className="flex flex-wrap items-center gap-2">
            Record {recordId}
            {isMinor && <Badge tone="amber">Child: guardians approve</Badge>}
            {access?.connected && <Badge tone={access.connection.level === "emergency" ? "rose" : access.connection.level === "full" ? "teal" : "sky"}>{access.connection.level} access</Badge>}
          </span>
        }
        action={
          <Button variant="ghost" onClick={reload}>
            Refresh
          </Button>
        }
      >
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {!access ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : access.connected ? (
          <p className="text-sm text-slate-700">
            Connected · {access.connection.categories.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}
            {access.connection.expires_at && <> · until {fmt(Date.parse(access.connection.expires_at))}</>} · your role opens {access.role_categories.join(", ")}
            <ConsentProof consents={access.consents} />
          </p>
        ) : access.pending_request ? (
          <PendingRequest me={me} request={access.pending_request} onChange={reload} />
        ) : (
          <RequestForm me={me} recordId={recordId} isMinor={isMinor} onSent={reload} />
        )}
      </Card>
      {access && !access.connected && CLINICAL.includes(me.role) && <EmergencyProfile recordId={recordId} />}
      {access && <EntriesPanel me={me} recordId={recordId} access={access} onChange={reload} />}
    </div>
  );
}

// The approver's device-signed consent, verified here rather than trusted from the API.
function ConsentProof({ consents }: { consents: SignedConsent[] }) {
  const approval = consents.find((c) => c.action === "approve");
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (approval) verifySignedConsent(approval).then(setOk);
  }, [approval]);
  if (!approval) return null;
  return (
    <span className={`mt-1 block text-xs ${ok === false ? "text-rose-700" : "text-emerald-700"}`}>
      {ok === null ? "Checking consent signature…" : ok ? `✓ Consent signed on ${approval.citizen_id}'s device (${approval.key_id})` : "✗ The consent signature does not verify"}
    </span>
  );
}

const CLINICAL = ["Doctor", "Consultant", "Medical Director", "Nurse", "Midwife", "Paramedic"];

// Releases the Basic Emergency Profile through the escrow after a fingerprint match.
function EmergencyProfile({ recordId }: { recordId: string }) {
  const { call } = useLive();
  const [items, setItems] = useState<{ entry: Entry; payload: Payload | null }[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { unwrap } = useFacilityKeys();

  // The patient's finger is scanned; the identity register must match it to this record.
  async function release(fingerprint: string) {
    setBusy(true);
    setError("");
    try {
      if (!unwrap) throw new Error("Your hospital key service is not configured (see Keys).");
      const bundle = await call<ReleaseBundle>(`/v1/records/${recordId}/emergency-profile`, { method: "POST", body: { fingerprint } });
      const ring = await openRelease(recordId, bundle, unwrap);
      const { entries } = await call<{ entries: Entry[] }>(`/v1/records/${recordId}/emergency-profile/entries`);
      setItems(await Promise.all(entries.map(async (entry) => ({ entry, payload: await decryptEnvelope(entry, ring) }))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Release failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border-2 border-rose-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50 px-5 py-3">
        <h2 className="text-sm font-semibold text-rose-900">Basic Emergency Profile</h2>
        <span className="text-xs text-rose-800">Released by SehatLog + a regulator + an independent body · logged · patient notified</span>
      </header>
      <div className="space-y-3 p-5 text-sm">
        {!items ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-700">Scan the patient&apos;s finger to release their allergies, blood group and conditions:</span>
            {busy ? (
              <span className="text-slate-500">Matching fingerprint and collecting escrow parts…</span>
            ) : (
              <FingerprintScanner label="Scan and release" onScan={release} />
            )}
          </div>
        ) : items.length === 0 ? (
          <Empty>No Basic Emergency Profile entries recorded.</Empty>
        ) : (
          items.map((it) => <EntryView key={it.entry.entry_id} env={it.entry} payload={it.payload} version={it.entry.version} status={it.entry.status} />)
        )}
        {error && <p className="text-rose-600">{error}</p>}
      </div>
    </section>
  );
}

function RequestForm({ me, recordId, isMinor, onSent }: { me: StaffMe; recordId: string; isMinor: boolean; onSent: () => void }) {
  const { call } = useLive();
  const [reason, setReason] = useState("Outpatient consultation");
  const [cats, setCats] = useState<string[]>(["clinical", "medications", "labs"]);
  const [canConsent, setCanConsent] = useState(true);
  const [incap, setIncap] = useState("Unconscious");
  const [error, setError] = useState("");

  async function send() {
    setError("");
    try {
      // Sealed in the browser to this facility and the patient's circle; SehatLog can't read it.
      const text = JSON.stringify(canConsent ? { reason } : { reason, incapacity: incap });
      const reason_sealed = await sealToFacilityAndCircle(call, text, "request-reason", recordId, me.facility.facility_id);
      await call(`/v1/records/${recordId}/access-requests`, {
        method: "POST",
        body: { categories: cats, patient_can_consent: canConsent, reason_sealed },
      });
      onSent();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Request failed");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Your facility is not connected to this record.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Reason (encrypted: only the approvers and your facility can read it)">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Scope requested">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.filter((c) => c !== "basic").map((c) => (
              <label key={c} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${cats.includes(c) ? "border-teal-600 bg-teal-50" : "border-slate-300"}`}>
                <input type="checkbox" className="accent-teal-700" checked={cats.includes(c)} onChange={() => setCats((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} />
                {CATEGORY_LABEL[c]}
              </label>
            ))}
          </div>
        </Field>
        <Field label={isMinor ? "Approval goes to the parents or guardians" : "Can the patient consent now?"}>
          <div className="flex gap-2">
            <Button variant={canConsent ? "primary" : "secondary"} onClick={() => setCanConsent(true)}>
              {isMinor ? "Guardians will approve" : "Yes"}
            </Button>
            <Button variant={!canConsent ? "danger" : "secondary"} onClick={() => setCanConsent(false)}>
              Unable to consent
            </Button>
          </div>
        </Field>
        {!canConsent && (
          <Field label="Patient status" hint="Goes to next of kin, then family after 30 minutes each.">
            <select className={inputCls} value={incap} onChange={(e) => setIncap(e.target.value)}>
              {["Unconscious", "Sedated", "Confused", "Critically ill"].map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <Button onClick={send} disabled={!reason.trim()}>
        Send request
      </Button>
    </div>
  );
}

const STAGE: Record<AccessRequest["stage"], string> = {
  patient: "Waiting for the patient (or guardians)",
  nok: "Waiting for next of kin",
  family: "Waiting for family members",
  break_glass: "Nobody reachable: break-glass available",
};

function PendingRequest({ me, request, onChange }: { me: StaffMe; request: AccessRequest; onChange: () => void }) {
  const { call } = useLive();
  const [fingerprint, setFingerprint] = useState(false);
  const [msg, setMsg] = useState("");
  const canSign = ["Doctor", "Consultant", "Medical Director"].includes(me.role);
  const opened = parseRequestReason(useSealedText(request.reason_sealed, "request-reason", request.record_id).text);
  // The break-glass reason is the one free text kept readable: the regulator audits it.
  const [bgReason, setBgReason] = useState<string | null>(null);
  const breakGlassReason = bgReason ?? (opened ? [opened.incapacity, opened.reason].filter(Boolean).join(": ") : "");

  async function sign() {
    setMsg("");
    try {
      const out = await call<{ granted: boolean }>(`/v1/access-requests/${request.request_id}/break-glass`, {
        method: "POST",
        body: { fingerprint_verified: fingerprint, reason: breakGlassReason },
      });
      setMsg(out.granted ? "Emergency access granted for 72 hours." : "Signed. A second signature is needed (treating doctor + Medical Director).");
      onChange();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Signing failed");
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <p>
        <Badge tone="amber">{STAGE[request.stage]}</Badge>
      </p>
      <p className="text-slate-700">
        Reason:{" "}
        <Sealed
          value={request.reason_sealed}
          purpose="request-reason"
          recordId={request.record_id}
          render={(t) => {
            const r = parseRequestReason(t);
            return (
              <>
                {r?.reason}
                {r?.incapacity && <> · {r.incapacity}</>}
              </>
            );
          }}
        />
        {request.stage_deadline && <> · moves on automatically at {fmt(Date.parse(request.stage_deadline))}</>}
      </p>
      {request.stage === "break_glass" && canSign && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <Field label="Break-glass reason (readable by the regulator's audit)">
            <input className={inputCls} value={breakGlassReason} onChange={(e) => setBgReason(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-rose-700" checked={fingerprint} onChange={(e) => setFingerprint(e.target.checked)} />
            My fingerprint was verified on the facility scanner
          </label>
          <Button variant="danger" onClick={sign} disabled={!fingerprint || !breakGlassReason.trim()}>
            Sign break-glass
          </Button>
        </div>
      )}
      {msg && <p className="text-slate-700">{msg}</p>}
    </div>
  );
}

function EntriesPanel({ me, recordId, access, onChange }: { me: StaffMe; recordId: string; access: Access; onChange: () => void }) {
  const { call } = useLive();
  const { unwrap: facilityUnwrap } = useFacilityKeys();
  const [unlocking, setUnlocking] = useState(false);

  // NOK, family and break-glass connections get their keys from the escrow: collect the
  // parts, open the keys, re-wrap them to this facility and store them.
  async function unlock() {
    if (!access.connected || !facilityUnwrap) return;
    setUnlocking(true);
    setError("");
    try {
      const con = access.connection;
      const bundle = await call<ReleaseBundle>(`/v1/connections/${con.connection_id}/escrow-release`);
      const escrowRing = await openRelease(recordId, bundle, facilityUnwrap);
      const keys = await wrapKeysForFacility(recordId, escrowRing, con.categories, fromB64(me.facility.public_key));
      await call(`/v1/connections/${con.connection_id}/keys`, { method: "POST", body: { keys } });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unlock failed");
      setUnlocking(false);
    }
  }
  const [ring, setRing] = useState<KeyRing | null>(null);
  const [items, setItems] = useState<{ entry: Entry; payload: Payload | null }[] | null>(null);
  const [proposing, setProposing] = useState<{ amends?: { entry: Entry; payload: Payload | null } } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = access.connected && facilityUnwrap && access.keys.length ? await unwrapFacilityKeys(recordId, access.keys, facilityUnwrap) : null;
    const { entries } = await call<{ entries: Entry[] }>(`/v1/records/${recordId}/entries`);
    const own = facilityUnwrap ? { facilityId: me.facility.facility_id, unwrap: facilityUnwrap } : undefined;
    return { ring: r, items: await Promise.all(entries.map(async (entry) => ({ entry, payload: await decryptEnvelope(entry, r, own) }))) };
  }, [access, facilityUnwrap, recordId, call, me.facility.facility_id]);

  useEffect(() => {
    let live = true;
    load()
      .then((v) => {
        if (!live) return;
        setRing(v.ring);
        setItems(v.items);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Could not open the record keys"));
    return () => {
      live = false;
    };
  }, [load]);

  const writable = access.connected ? access.role_categories.filter((c) => latestKey(ring, c)) : [];
  if (!access.connected && items?.length === 0) return null;

  return (
    <Card
      title={access.connected ? "Health record" : "Entries your facility wrote (read-only)"}
      action={
        access.connected && (
          <Button onClick={() => setProposing({})} disabled={writable.length === 0}>
            Propose entry
          </Button>
        )
      }
    >
      {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
      {access.connected && access.keys.length === 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="flex-1">
            Connected, but no keys are stored for your facility yet.{" "}
            {["nok", "family", "break_glass"].includes(access.connection.granted_by_type)
              ? `Approved by ${access.connection.granted_by_type.replace("_", "-")}: the keys come from the emergency escrow.`
              : "The approver's device held no keys for this record."}
          </span>
          {["nok", "family", "break_glass"].includes(access.connection.granted_by_type) && (
            <Button variant="secondary" onClick={unlock} disabled={unlocking || !facilityUnwrap}>
              {unlocking ? "Collecting escrow parts…" : "Unlock keys from emergency escrow"}
            </Button>
          )}
        </div>
      )}
      {!items ? (
        <p className="text-sm text-slate-500">Decrypting…</p>
      ) : items.length === 0 ? (
        <Empty>No entries yet.</Empty>
      ) : (
        <div className="space-y-3">
          {[...items].reverse().map((it) => (
            <EntryView
              key={it.entry.entry_id}
              env={it.entry}
              payload={it.payload}
              version={it.entry.version}
              status={it.entry.status}
              actions={
                it.payload && it.entry.status === "current" && writable.includes(it.entry.category) ? (
                  <button className="text-xs font-medium text-teal-700 hover:underline" onClick={() => setProposing({ amends: it })}>
                    Propose amendment
                  </button>
                ) : null
              }
            />
          ))}
        </div>
      )}
      {proposing && ring && (
        <ProposeDialog
          me={me}
          recordId={recordId}
          ring={ring}
          categories={writable}
          amends={proposing.amends}
          emergency={access.connected && access.connection.level === "emergency"}
          onClose={() => {
            setProposing(null);
            onChange();
          }}
        />
      )}
    </Card>
  );
}

function ProposeDialog({
  me,
  recordId,
  ring,
  categories,
  amends,
  emergency,
  onClose,
}: {
  me: StaffMe;
  recordId: string;
  ring: KeyRing;
  categories: string[];
  amends?: { entry: Entry; payload: Payload | null };
  emergency: boolean;
  onClose: () => void;
}) {
  const { call } = useLive();
  const base = amends?.payload;
  const [category, setCategory] = useState(amends?.entry.category ?? (categories.includes("clinical") ? "clinical" : categories[0]));
  const [kind, setKind] = useState(base?.kind ?? "Note");
  const [title, setTitle] = useState(base?.title ?? "");
  const [details, setDetails] = useState(base?.details ?? "");
  const [fields, setFields] = useState(base?.fields ? Object.entries(base.fields).map(([k, v]) => `${k}: ${v}`).join("\n") : "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const { raw } = useLive();
  const seed = getSigningSeed(me.id);
  // Emergency fast-track: doctors under emergency access, or in emergency medicine.
  const canFastTrack = ["Doctor", "Consultant", "Medical Director"].includes(me.role) && (emergency || /emergency/i.test(me.specialty));
  const [fast, setFast] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      if (!seed || !me.signing_public_key) throw new Error("Register your signing key under Keys first.");
      // Always the newest key version: the API rejects entries under a rotated-out key.
      const k = latestKey(ring, category);
      if (!k?.key) throw new Error("No key for this category on this device.");
      // Encrypt and upload attachments first; their keys go inside the encrypted entry.
      const attachments = [...(base?.attachments ?? [])];
      for (const f of files) {
        setMsg(`Encrypting and uploading ${f.name}…`);
        attachments.push(await uploadEncrypted(raw, recordId, category, { name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) }));
      }
      const body = await buildProposal({
        recordId,
        category,
        keyVersion: k.version,
        categoryKey: k.key,
        facilityPub: fromB64(me.facility.public_key),
        signingSeed: seed,
        amendsEntryId: amends?.entry.entry_id,
        payload: {
          kind,
          title,
          details,
          fields: Object.fromEntries(
            fields
              .split("\n")
              .map((l) => l.split(":"))
              .filter((p) => p.length >= 2 && p[0].trim())
              .map(([k2, ...v]) => [k2.trim(), v.join(":").trim()]),
          ),
          ...(attachments.length ? { attachments } : {}),
        },
      });
      const p = await call<Proposal>(`/v1/records/${recordId}/proposals`, { method: "POST", body: { ...body, fast_track: fast } });
      if (fast) {
        await call(`/v1/proposals/${p.proposal_id}/merge`, { method: "POST", body: { merge_signature: await mergeSignature(seed, p) } });
        setMsg("Merged as an emergency entry. A second clinician must review it within 24 hours.");
      } else {
        setMsg("Submitted. A reviewer at your facility must merge it.");
      }
      setTimeout(onClose, 1200);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Submit failed");
      setBusy(false);
    }
  }

  return (
    <Modal open title={amends ? "Propose an amendment" : "Propose a new entry"} onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} disabled={!!amends}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Entry type">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value)}>
              {["Note", "Diagnosis", "Allergy", "Prescription", "Lab result", "Vitals", "Immunisation"].map((k2) => (
                <option key={k2}>{k2}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Title">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Details">
          <textarea className={inputCls} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <Field label="Coded fields" hint="One per line, as Name: value">
          <textarea className={`${inputCls} font-mono text-xs`} rows={3} value={fields} onChange={(e) => setFields(e.target.value)} />
        </Field>
        <Field label="Attach files" hint="Scans, images or PDFs, up to 25 MB each. Encrypted in this browser before upload.">
          <input
            type="file"
            multiple
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).filter((f) => f.size <= MAX_FILE_BYTES))}
          />
        </Field>
        {base?.attachments?.length ? <p className="text-xs text-slate-500">Keeps {base.attachments.length} existing attachment(s).</p> : null}
        {canFastTrack && (
          <label className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <input type="checkbox" className="mt-0.5 accent-rose-700" checked={fast} onChange={(e) => setFast(e.target.checked)} />
            <span>
              Emergency fast-track: add it to the record now, without waiting for review. A colleague must sign it as reviewed within 24 hours, or the Medical
              Director is alerted.
            </span>
          </label>
        )}
        <p className="text-xs text-slate-500">Encrypted and signed in this browser. The server stores only ciphertext.</p>
        {msg && <p className="text-sm text-slate-700">{msg}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {busy ? "Encrypting…" : fast ? "Sign and merge now" : "Sign and submit"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
