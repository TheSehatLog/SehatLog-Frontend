"use client";

import { useCallback, useEffect, useState } from "react";
import { EntryView } from "@/components/live/EntryView";
import { useLive } from "@/components/live/LiveSession";
import { KeyRecovery, refreshBackup } from "@/components/live/KeyRecovery";
import { Sealed } from "@/components/live/Sealed";
import { StepUpFields, useSendCode, useStepUp } from "@/components/live/SecondFactor";
import { Badge, Button, Card, Empty, Field, fmt, inputCls, Modal } from "@/components/ui";
import { ApiError, fromB64, type AuditEvent, type Dispute, type ConnectionView, type Entry, type Proposal, type RequestView } from "@/lib/live/api";
import { addRecordKey, CATEGORIES, CATEGORY_LABEL, createRecordKeys, ensureDeviceKey, getRecordKeys } from "@/lib/live/keystore";
import { deviceSignature, verifySignedConsent, type SignedConsent } from "@/lib/live/consent";
import { receiveSharedKeys, shareRecordKeys } from "@/lib/live/sharing";
import { rotateKeys } from "@/lib/live/rotation";
import { setupEscrow } from "@/lib/live/escrow";
import { parseRequestReason, sealToFacilityAndCircle } from "@/lib/live/sealed";
import { decryptEnvelope, wrapKeysForFacility, type Payload } from "@/lib/live/records";

type MyRecord = { record_id: string; relation: "self" | "guardian" | "nok" | "family"; is_minor: boolean };

const ACTING: Record<RequestView["acting_as"], string> = {
  self: "Request to access your record",
  guardian: "Request for a child in your care",
  nok: "You are next of kin, and the patient cannot consent",
  family: "The patient and next of kin could not be reached; you are listed as family",
};

export default function CitizenDashboard() {
  const { me, call } = useLive();
  const [requests, setRequests] = useState<RequestView[] | null>(null);
  const [approving, setApproving] = useState<RequestView | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  const [mine, setMine] = useState<MyRecord[] | null>(null);
  useEffect(() => {
    if (me?.actor_type !== "citizen") return;
    call<{ records: MyRecord[] }>("/v1/me/records")
      .then((r) => setMine(r.records))
      .catch(() => setMine([]));
  }, [me, call]);

  useEffect(() => {
    if (me?.actor_type !== "citizen") return;
    call<{ requests: RequestView[] }>("/v1/me/access-requests")
      .then((r) => setRequests(r.requests))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load requests"));
  }, [me, call, tick]);

  if (me?.actor_type !== "citizen") return <Empty>Sign in as a citizen to see your dashboard.</Empty>;
  // Records you manage (yours, children in your care) get the full view; records where you
  // are next of kin or family only reach you as requests while the patient can't consent.
  const managed = (mine ?? []).filter((r) => r.relation === "self" || r.relation === "guardian");
  const listed = (mine ?? []).filter((r) => r.relation === "nok" || r.relation === "family");

  async function decline(r: RequestView) {
    if (me?.actor_type !== "citizen") return;
    try {
      // Signed on this device when it has a registered key; otherwise a plain decline.
      const device_signature = await deviceSignature({ action: "decline", subjectId: r.request_id, recordId: r.record_id, signerId: me.id });
      await call(`/v1/access-requests/${r.request_id}/decline`, { method: "POST", body: { device_signature } }).catch((e) => {
        if (e instanceof ApiError && e.status === 412) return call(`/v1/access-requests/${r.request_id}/decline`, { method: "POST" });
        throw e;
      });
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Decline failed");
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">My SehatLog</h1>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <Card title={`Pending requests (${requests?.length ?? "…"})`} action={<Button variant="ghost" onClick={reload}>Refresh</Button>}>
        {!requests ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : requests.length === 0 ? (
          <Empty>No hospital is waiting for your approval.</Empty>
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.request_id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-amber-800">{ACTING[r.acting_as]}</p>
                    <p className="mt-1 font-semibold text-slate-900">{r.facility.name}</p>
                    <p className="text-sm text-slate-600">
                      {r.facility.address} · HFR {r.facility.hfr_id} · {r.facility.type}
                    </p>
                    <p className="mt-1 text-sm text-slate-800">
                      Reason:{" "}
                      <Sealed
                        value={r.reason_sealed}
                        purpose="request-reason"
                        recordId={r.record_id}
                        render={(t) => {
                          const v = parseRequestReason(t);
                          return (
                            <>
                              {v?.reason}
                              {v?.incapacity && <> · Patient status: {v.incapacity}</>}
                            </>
                          );
                        }}
                      />
                    </p>
                    <p className="text-sm text-slate-600">
                      Record {r.record_id} · asks for {r.categories.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")}
                      {r.stage_deadline && <> · moves on {fmt(Date.parse(r.stage_deadline))}</>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => decline(r)}>
                      Decline
                    </Button>
                    <Button onClick={() => setApproving(r)}>Review and approve</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {mine === null && <p className="text-sm text-slate-500">Loading your records…</p>}
      {managed.map((r) => (
        <ManagedRecord key={r.record_id + tick} recordId={r.record_id} own={r.relation === "self"} isMinor={r.is_minor} />
      ))}
      {listed.length > 0 && (
        <Card title="People who list you">
          <ul className="space-y-2 text-sm">
            {listed.map((r) => (
              <li key={r.record_id} className="flex flex-wrap items-center gap-2">
                <Badge tone={r.relation === "nok" ? "violet" : "slate"}>{r.relation === "nok" ? "Next of kin" : "Family"}</Badge>
                <span className="font-mono text-xs text-slate-600">{r.record_id}</span>
                <span className="text-slate-600">
                  You are asked to approve hospital access only if this person can&apos;t consent
                  {r.relation === "family" ? " and their next of kin can't be reached" : ""}.
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {approving && (
        <ApproveDialog
          request={approving}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ApproveDialog({ request, onClose, onDone }: { request: RequestView; onClose: () => void; onDone: () => void }) {
  const { call, me } = useLive();
  const usesOwnKeys = request.acting_as === "self" || request.acting_as === "guardian";
  const ring = usesOwnKeys ? getRecordKeys(request.record_id) : null;
  const [level, setLevel] = useState<"full" | "scoped">(request.categories.length > 3 ? "full" : "scoped");
  const [cats, setCats] = useState<string[]>(request.categories.filter((c) => c !== "basic" && c !== "sensitive"));
  const [duration, setDuration] = useState(0);
  const step = useStepUp();
  const sendCode = useSendCode();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const granted = level === "full" ? CATEGORIES.filter((c) => c !== "sensitive" || cats.includes("sensitive")) : ["basic", ...cats];
      const wrapped =
        ring && request.facility.public_key ? await wrapKeysForFacility(request.record_id, ring, granted, fromB64(request.facility.public_key)) : [];
      if (me?.actor_type !== "citizen") return;
      const categories = granted.filter((c) => c !== "basic");
      // This device signs exactly what is granted (crypto spec section 9).
      const device_signature = await deviceSignature({
        action: "approve",
        subjectId: request.request_id,
        recordId: request.record_id,
        signerId: me.id,
        level,
        categories,
        durationHours: duration,
      });
      await call(`/v1/access-requests/${request.request_id}/approve`, {
        method: "POST",
        body: { ...step.body, level, categories, duration_hours: duration, wrapped_keys: wrapped, device_signature },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Approval failed");
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Approve ${request.facility.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(["full", "scoped"] as const).map((l) => (
            <button key={l} onClick={() => setLevel(l)} className={`rounded-lg border px-3 py-2 text-left text-sm ${level === l ? "border-teal-600 bg-teal-50" : "border-slate-300"}`}>
              <span className="block font-medium">{l === "full" ? "Full access" : "Scoped grant"}</span>
              <span className="text-xs text-slate-600">{l === "full" ? "Read history and merge entries" : "Only the categories you pick"}</span>
            </button>
          ))}
        </div>
        <Field label={level === "full" ? "Also include" : "Categories"} hint="The Basic Emergency Profile is always included.">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.filter((c) => c !== "basic" && (level === "scoped" || c === "sensitive")).map((c) => (
              <label key={c} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${cats.includes(c) ? "border-teal-600 bg-teal-50" : "border-slate-300"}`}>
                <input type="checkbox" className="accent-teal-700" checked={cats.includes(c)} onChange={() => setCats((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]))} />
                {CATEGORY_LABEL[c]}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Duration">
          <select className={inputCls} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            <option value={0}>Until I remove it</option>
            <option value={24}>24 hours</option>
            <option value={168}>7 days</option>
            <option value={720}>30 days</option>
          </select>
        </Field>
        <p className={`rounded-md px-3 py-2 text-xs ${usesOwnKeys && !ring ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`}>
          {!usesOwnKeys
            ? "You don't hold the patient's keys. The hospital will obtain them from the emergency escrow, which needs SehatLog + a regulator + an independent body."
            : ring
              ? "The granted keys will be encrypted to this hospital's public key in your browser."
              : "This device has no keys for the record, so the hospital will be connected but unable to read anything until keys are shared."}
        </p>
        <StepUpFields {...step.props} send={sendCode} />
        <p className="text-xs text-slate-500">Your approval is signed with this device&apos;s key, so the hospital and you can prove what you agreed to.</p>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={approve} disabled={busy || !step.ready || (level === "scoped" && cats.length === 0)}>
            {busy ? "Approving…" : "Approve"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type Tab = "hospitals" | "record" | "proposals" | "disputes" | "consents" | "activity";

function ManagedRecord({ recordId, own, isMinor }: { recordId: string; own: boolean; isMinor: boolean }) {
  const { call, me } = useLive();
  const [ring, setRing] = useState(() => getRecordKeys(recordId));
  const citizenId = me?.actor_type === "citizen" ? me.id : "";
  const [shareNote, setShareNote] = useState("");

  // Keys a co-guardian (or this citizen's other device) shared with this browser.
  useEffect(() => {
    if (!citizenId) return;
    receiveSharedKeys(call, recordId, citizenId, ensureDeviceKey(citizenId), getRecordKeys(recordId))
      .then((n) => {
        if (n > 0) {
          setRing(getRecordKeys(recordId));
          setShareNote(`${n} key${n > 1 ? "s" : ""} received from ${isMinor ? "a co-guardian" : "your other device"}.`);
          refreshBackup(call, recordId, getRecordKeys(recordId)).catch(() => {});
        }
      })
      .catch(() => {});
  }, [call, recordId, citizenId, isMinor]);

  async function share(r = getRecordKeys(recordId)) {
    if (!r || !citizenId) return;
    try {
      const n = await shareRecordKeys(call, recordId, r, `${citizenId}:${ensureDeviceKey(citizenId).keyId}`);
      setShareNote(
        n === 0
          ? `No other ${isMinor ? "guardian" : ""} device has signed in yet. They need to sign in once, then share again.`
          : `Keys shared with ${n} other device${n > 1 ? "s" : ""}${isMinor ? " of this child's guardians" : ""}.`,
      );
    } catch (e) {
      setShareNote(`Sharing failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }
  const [connections, setConnections] = useState<ConnectionView[] | null | "forbidden">(null);
  const [rotationNote, setRotationNote] = useState("");

  // After removing a hospital: new keys for the categories it held, so it can't read
  // anything written from now on, even with keys it kept.
  async function afterRemoval(removed: ConnectionView) {
    const current = getRecordKeys(recordId);
    if (!current) {
      setRotationNote(`${removed.facility.name} was removed. Keys were not rotated: this device holds no keys for the record.`);
      return;
    }
    try {
      const rotated = await rotateKeys(call, recordId, removed.categories.filter((c) => current.has(c)));
      for (const r of rotated) addRecordKey(recordId, r.category, r.version, r.key);
      setRing(getRecordKeys(recordId));
      await share(getRecordKeys(recordId)); // co-guardians and other devices need the new versions too
      await refreshBackup(call, recordId, getRecordKeys(recordId)); // and the recovery backup
      setRotationNote(`${removed.facility.name} was removed and ${rotated.length} keys were rotated. New entries use keys it doesn't have.`);
    } catch (e) {
      setRotationNote(`${removed.facility.name} was removed, but key rotation failed: ${e instanceof Error ? e.message : "unknown error"}. Remove and retry later.`);
    }
  }
  const [tab, setTab] = useState<Tab>("hospitals");
  const [removing, setRemoving] = useState<ConnectionView | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    call<{ connections: ConnectionView[] }>(`/v1/records/${recordId}/connections`)
      .then((r) => setConnections(r.connections))
      .catch((e) => setConnections(e instanceof ApiError && e.status === 403 ? "forbidden" : []));
  }, [call, recordId, tick]);

  if (connections === "forbidden") return null; // next of kin / family: can answer requests, not manage the record
  const active = Array.isArray(connections) ? connections.filter((c) => c.active) : [];
  const previous = Array.isArray(connections) ? connections.filter((c) => !c.active) : [];

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {own ? `My record (${recordId})` : `Record ${recordId}`}
          {!own && <Badge tone="amber">{isMinor ? "Child in your care · guardian" : "Guardian"}</Badge>}
        </span>
      }
      action={
        ring && (
          <Button variant="ghost" onClick={() => share()}>
            {isMinor ? "Share keys with co-guardians" : "Share keys with my devices"}
          </Button>
        )
      }
    >
      {shareNote && <p className="mb-3 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">{shareNote}</p>}
      {!ring && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex-1">
            New record with no keys anywhere yet? Create them here. If {isMinor ? "another guardian" : "another of your devices"} has them, choose &ldquo;Share
            keys&rdquo; there instead; they&apos;ll arrive here.
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              createRecordKeys(recordId);
              setRing(getRecordKeys(recordId));
            }}
          >
            Create keys on this device
          </Button>
        </div>
      )}
      <KeyRecovery recordId={recordId} ring={ring} onRing={() => setRing(getRecordKeys(recordId))} />
      <EmergencyAccess recordId={recordId} ring={ring} />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ["hospitals", `Connected hospitals (${active.length})`],
            ["record", "Health record"],
            ["proposals", "Proposals"],
            ["disputes", "Disputes"],
            ["consents", "Signed consents"],
            ["activity", "Activity log"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? "border-teal-700 font-medium text-teal-800" : "border-transparent text-slate-600"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "hospitals" &&
        (connections === null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="space-y-4">
            {active.length === 0 ? (
              <Empty>No hospital is connected.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="pb-2 font-medium">Hospital</th>
                      <th className="pb-2 font-medium">Access</th>
                      <th className="pb-2 font-medium">Granted by</th>
                      <th className="pb-2 font-medium">Expires</th>
                      <th className="pb-2 font-medium">Last opened</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {active.map((c) => (
                      <tr key={c.connection_id} className="align-top">
                        <td className="py-3 pr-3">
                          <p className="font-medium text-slate-900">{c.facility.name}</p>
                          <p className="text-xs text-slate-500">HFR {c.facility.hfr_id}</p>
                        </td>
                        <td className="py-3 pr-3">
                          <Badge tone={c.level === "full" ? "teal" : c.level === "emergency" ? "rose" : "sky"}>{c.level}</Badge>
                          <p className="mt-1 text-xs text-slate-500">{c.categories.map((x) => CATEGORY_LABEL[x] ?? x).join(", ")}</p>
                        </td>
                        <td className="py-3 pr-3 text-slate-700">{c.granted_by_type.replace("_", "-")}</td>
                        <td className="py-3 pr-3 text-slate-700">{c.expires_at ? fmt(Date.parse(c.expires_at)) : "Until removed"}</td>
                        <td className="py-3 pr-3 text-slate-700">{c.last_opened_at ? `${fmt(Date.parse(c.last_opened_at))} by ${c.last_opened_by}` : "never"}</td>
                        <td className="py-3 text-right">
                          <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => setRemoving(c)}>
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {previous.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Previously connected</p>
                <ul className="space-y-1 text-sm text-slate-600">
                  {previous.map((c) => (
                    <li key={c.connection_id}>
                      {c.facility.name} · {c.removed_at ? `removed ${fmt(Date.parse(c.removed_at))}` : `expired ${fmt(Date.parse(c.expires_at!))}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}

      {tab === "record" && <RecordEntries recordId={recordId} ring={ring} />}
      {tab === "proposals" && <RecordProposals recordId={recordId} ring={ring} />}
      {tab === "disputes" && <RecordDisputes recordId={recordId} />}
      {tab === "consents" && <Consents recordId={recordId} />}
      {tab === "activity" && <Activity recordId={recordId} />}

      {rotationNote && <p className="mt-3 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{rotationNote}</p>}

      {removing && (
        <RemoveDialog
          connection={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            const removed = removing;
            setRemoving(null);
            afterRemoval(removed).finally(() => setTick((t) => t + 1));
          }}
        />
      )}
    </Card>
  );
}

// Emergency escrow: lets next of kin, family or break-glass unlock keys when the patient can't.
function EmergencyAccess({ recordId, ring }: { recordId: string; ring: ReturnType<typeof getRecordKeys> }) {
  const { call } = useLive();
  const [state, setState] = useState<"loading" | "on" | "off">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    call(`/v1/records/${recordId}/escrow`)
      .then(() => setState("on"))
      .catch(() => setState("off"));
  }, [call, recordId, tick]);

  async function setup() {
    if (!ring) return;
    setBusy(true);
    setError("");
    try {
      await setupEscrow(call, recordId, ring);
      setTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${state === "on" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}>
      <span className="flex-1">
        {state === "on"
          ? "Emergency access is set up. If you can't consent, your keys can be released only with SehatLog + a regulator + an independent body."
          : "Emergency access is not set up. Without it, next of kin, family and break-glass approvals can't unlock your records."}
        {error && <span className="mt-1 block text-rose-700">{error}</span>}
      </span>
      {state === "off" && (
        <Button variant="secondary" onClick={setup} disabled={!ring || busy}>
          {busy ? "Splitting key across custodians…" : "Set up emergency access"}
        </Button>
      )}
    </div>
  );
}

function useDecrypted<T extends Entry | Proposal>(path: string, key: "entries" | "proposals", ring: ReturnType<typeof getRecordKeys>) {
  const { call } = useLive();
  const [items, setItems] = useState<{ item: T; payload: Payload | null }[] | null>(null);
  const load = useCallback(async () => {
    const r = await call<Record<string, T[]>>(path);
    return Promise.all(r[key].map(async (item) => ({ item, payload: await decryptEnvelope(item, ring) })));
  }, [call, path, key, ring]);
  useEffect(() => {
    let live = true;
    load()
      .then((v) => live && setItems(v))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [load]);
  return items;
}

function RecordEntries({ recordId, ring }: { recordId: string; ring: ReturnType<typeof getRecordKeys> }) {
  const items = useDecrypted<Entry>(`/v1/records/${recordId}/entries`, "entries", ring);
  const [disputing, setDisputing] = useState<Entry | null>(null);
  if (!items) return <p className="text-sm text-slate-500">Loading…</p>;
  if (items.length === 0) return <Empty>No entries yet.</Empty>;
  return (
    <div className="space-y-3">
      {[...items].reverse().map(({ item, payload }) => (
        <EntryView
          key={item.entry_id}
          env={item}
          payload={payload}
          version={item.version}
          status={item.status}
          actions={
            item.status === "current" ? (
              <button className="text-xs font-medium text-rose-700 hover:underline" onClick={() => setDisputing(item)}>
                Dispute
              </button>
            ) : null
          }
        />
      ))}
      {disputing && <DisputeDialog entry={disputing} onClose={() => setDisputing(null)} />}
    </div>
  );
}

// Challenge an entry; the Medical Director of the hospital that wrote it reviews.
function DisputeDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { call } = useLive();
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  async function send() {
    setMsg("");
    try {
      // Sealed to the hospital that wrote the entry and the record's circle.
      const reason_sealed = await sealToFacilityAndCircle(call, reason, "dispute-reason", entry.record_id, entry.facility_id);
      await call(`/v1/entries/${entry.entry_id}/disputes`, { method: "POST", body: { reason_sealed } });
      setDone(true);
      setMsg("Dispute sent. The Medical Director of the hospital that wrote this entry will review it, and you'll be notified of the outcome.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not send the dispute");
    }
  }
  return (
    <Modal open title="Dispute this entry" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <Field label="What is wrong?" hint="Up to 500 characters. Encrypted: only the hospital's reviewers and your family circle can read it.">
          <textarea className={inputCls} rows={4} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={done} />
        </Field>
        {msg && <p className="text-slate-700">{msg}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done && (
            <Button onClick={send} disabled={!reason.trim()}>
              Send dispute
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function RecordDisputes({ recordId }: { recordId: string }) {
  const { call } = useLive();
  const [list, setList] = useState<Dispute[] | null>(null);
  useEffect(() => {
    call<{ disputes: Dispute[] }>(`/v1/records/${recordId}/disputes`)
      .then((r) => setList(r.disputes))
      .catch(() => setList([]));
  }, [call, recordId]);
  if (!list) return <p className="text-sm text-slate-500">Loading…</p>;
  if (list.length === 0) return <Empty>No disputes. Use “Dispute” on any entry you believe is wrong.</Empty>;
  return (
    <ul className="space-y-2 text-sm">
      {list.map((d) => (
        <li key={d.dispute_id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={d.status === "open" ? "amber" : d.status === "amended" ? "teal" : "slate"}>
              {d.status === "open" ? "Under review" : d.status === "amended" ? "Corrected" : "Entry upheld"}
            </Badge>
            <span className="font-mono text-xs text-slate-500">{d.entry_id}</span>
            <span className="text-xs text-slate-500">{fmt(Date.parse(d.created_at))}</span>
          </div>
          <p className="mt-1 text-slate-800">
            <Sealed value={d.reason_sealed} purpose="dispute-reason" recordId={d.record_id} render={(t) => <>“{t}”</>} />
          </p>
          {d.resolution_sealed && (
            <p className="mt-1 text-slate-600">
              Medical Director: <Sealed value={d.resolution_sealed} purpose="dispute-resolution" recordId={d.record_id} />
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function RecordProposals({ recordId, ring }: { recordId: string; ring: ReturnType<typeof getRecordKeys> }) {
  const items = useDecrypted<Proposal>(`/v1/records/${recordId}/proposals`, "proposals", ring);
  if (!items) return <p className="text-sm text-slate-500">Loading…</p>;
  if (items.length === 0) return <Empty>No proposals yet.</Empty>;
  return (
    <div className="space-y-3">
      {[...items].reverse().map(({ item, payload }) => (
        <EntryView
          key={item.proposal_id}
          env={item}
          payload={payload}
          badge={<Badge tone={item.status === "open" ? "amber" : item.status === "merged" ? "teal" : "rose"}>{item.status.replace("_", " ")}</Badge>}
          footer={
            item.review_comment_sealed && (
              <p className="mt-1 text-xs text-slate-600">
                Reviewer: <Sealed value={item.review_comment_sealed} purpose="review-comment" recordId={item.record_id} render={(t) => <>“{t}”</>} />
              </p>
            )
          }
        />
      ))}
    </div>
  );
}

// Every approval, decline and removal, with the device signature checked here in the browser.
function Consents({ recordId }: { recordId: string }) {
  const { call } = useLive();
  const [list, setList] = useState<(SignedConsent & { ok: boolean })[] | null>(null);
  useEffect(() => {
    let live = true;
    call<{ consents: SignedConsent[] }>(`/v1/records/${recordId}/consents`)
      .then(async (r) => Promise.all(r.consents.map(async (c) => ({ ...c, ok: await verifySignedConsent(c) }))))
      .then((v) => live && setList(v))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [call, recordId]);
  if (!list) return <p className="text-sm text-slate-500">Loading…</p>;
  if (list.length === 0) return <Empty>No signed consents yet.</Empty>;
  return (
    <ul className="space-y-2 text-sm">
      {[...list].reverse().map((c) => {
        const f = Object.fromEntries(c.statement.split("\n").slice(1).map((l) => l.split("=") as [string, string]));
        return (
          <li key={c.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={c.action === "approve" ? "teal" : c.action === "remove" ? "rose" : "slate"}>{c.action}</Badge>
              <span className="text-slate-700">
                {c.action === "remove" ? `connection ${f.subject}` : `request ${f.subject}`}
                {f.level && ` · ${f.level}`}
                {f.categories && ` · ${f.categories.split(",").map((x) => CATEGORY_LABEL[x] ?? x).join(", ")}`}
                {c.action === "approve" && ` · ${f.duration_hours === "0" ? "until removed" : `${f.duration_hours} h`}`}
              </span>
              <span className="text-xs text-slate-500">{fmt(Date.parse(c.created_at))}</span>
              <span className={`ml-auto text-xs font-medium ${c.ok ? "text-emerald-700" : "text-rose-700"}`}>
                {c.ok ? `✓ signed by ${c.citizen_id} on device ${c.key_id}` : "✗ signature does not verify"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Activity({ recordId }: { recordId: string }) {
  const { call } = useLive();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  useEffect(() => {
    call<{ events: AuditEvent[] }>(`/v1/records/${recordId}/audit`)
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
  }, [call, recordId]);
  if (!events) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {[...events].reverse().map((a) => (
        <li key={a.seq} className="flex flex-wrap gap-x-3 py-2">
          <span className="w-40 shrink-0 text-slate-500">{fmt(Date.parse(a.at))}</span>
          <span className="font-mono text-xs text-slate-700">{a.actor_id}</span>
          <span className="text-slate-800">{a.action}</span>
          {a.facility_id && <span className="text-slate-400">· {a.facility_id}</span>}
        </li>
      ))}
    </ul>
  );
}

function RemoveDialog({ connection, onClose, onDone }: { connection: ConnectionView; onClose: () => void; onDone: () => void }) {
  const { call, me } = useLive();
  const step = useStepUp();
  const sendCode = useSendCode();
  const [error, setError] = useState("");
  async function remove() {
    try {
      if (me?.actor_type !== "citizen") return;
      const device_signature = await deviceSignature({ action: "remove", subjectId: connection.connection_id, recordId: connection.record_id, signerId: me.id });
      await call(`/v1/connections/${connection.connection_id}/remove`, { method: "POST", body: { ...step.body, device_signature } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Removal failed");
    }
  }
  return (
    <Modal open title={`Remove ${connection.facility.name}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-700">The hospital&apos;s keys are deleted and it can no longer open your record. It keeps read-only access to entries it wrote itself.</p>
        <StepUpFields {...step.props} send={sendCode} />
        {error && <p className="text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} disabled={!step.ready}>
            Remove hospital
          </Button>
        </div>
      </div>
    </Modal>
  );
}
