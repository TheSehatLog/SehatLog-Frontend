"use client";

import { useCallback, useEffect, useState } from "react";
import { EntryView } from "@/components/live/EntryView";
import { useLive } from "@/components/live/LiveSession";
import { Badge, Button, Card, Empty, Field, fmt, inputCls, Modal } from "@/components/ui";
import { ApiError, fromB64, type AuditEvent, type ConnectionView, type Entry, type Proposal, type RequestView } from "@/lib/live/api";
import { addRecordKey, CATEGORIES, CATEGORY_LABEL, createRecordKeys, getRecordKeys } from "@/lib/live/keystore";
import { rotateKeys } from "@/lib/live/rotation";
import { setupEscrow } from "@/lib/live/escrow";
import { decryptEnvelope, wrapKeysForFacility, type Payload } from "@/lib/live/records";

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

  useEffect(() => {
    if (me?.actor_type !== "citizen") return;
    call<{ requests: RequestView[] }>("/v1/me/access-requests")
      .then((r) => setRequests(r.requests))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load requests"));
  }, [me, call, tick]);

  if (me?.actor_type !== "citizen") return <Empty>Sign in as a citizen to see your dashboard.</Empty>;
  const records = Array.from(new Set([me.record_id, ...me.acts_for_records]));

  async function decline(r: RequestView) {
    try {
      await call(`/v1/access-requests/${r.request_id}/decline`, { method: "POST" });
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
                      Reason: {r.reason}
                      {r.incapacity_reason && <> · Patient status: {r.incapacity_reason}</>}
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

      {records.map((id) => (
        <ManagedRecord key={id + tick} recordId={id} own={id === me.record_id} />
      ))}

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
  const { call } = useLive();
  const usesOwnKeys = request.acting_as === "self" || request.acting_as === "guardian";
  const ring = usesOwnKeys ? getRecordKeys(request.record_id) : null;
  const [level, setLevel] = useState<"full" | "scoped">(request.categories.length > 3 ? "full" : "scoped");
  const [cats, setCats] = useState<string[]>(request.categories.filter((c) => c !== "basic" && c !== "sensitive"));
  const [duration, setDuration] = useState(0);
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const granted = level === "full" ? CATEGORIES.filter((c) => c !== "sensitive" || cats.includes("sensitive")) : ["basic", ...cats];
      const wrapped =
        ring && request.facility.public_key ? await wrapKeysForFacility(request.record_id, ring, granted, fromB64(request.facility.public_key)) : [];
      await call(`/v1/access-requests/${request.request_id}/approve`, {
        method: "POST",
        body: { password: pw, totp_code: code, level, categories: granted.filter((c) => c !== "basic"), duration_hours: duration, wrapped_keys: wrapped },
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password">
            <input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Authenticator code">
            <input inputMode="numeric" maxLength={6} className={`${inputCls} font-mono`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={approve} disabled={busy || !pw || code.length !== 6 || (level === "scoped" && cats.length === 0)}>
            {busy ? "Approving…" : "Approve"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type Tab = "hospitals" | "record" | "proposals" | "activity";

function ManagedRecord({ recordId, own }: { recordId: string; own: boolean }) {
  const { call } = useLive();
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
      setRotationNote(`${removed.facility.name} was removed and ${rotated.length} keys were rotated. New entries use keys it doesn't have.`);
    } catch (e) {
      setRotationNote(`${removed.facility.name} was removed, but key rotation failed: ${e instanceof Error ? e.message : "unknown error"}. Remove and retry later.`);
    }
  }
  const [tab, setTab] = useState<Tab>("hospitals");
  const [ring, setRing] = useState(() => getRecordKeys(recordId));
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
    <Card title={own ? `My record (${recordId})` : `Record ${recordId} (in your care)`}>
      {!ring && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex-1">This device holds no keys for this record. Create them here to approve hospitals with keys and read entries.</span>
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
      <EmergencyAccess recordId={recordId} ring={ring} />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ["hospitals", `Connected hospitals (${active.length})`],
            ["record", "Health record"],
            ["proposals", "Proposals"],
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
  if (!items) return <p className="text-sm text-slate-500">Loading…</p>;
  if (items.length === 0) return <Empty>No entries yet.</Empty>;
  return (
    <div className="space-y-3">
      {[...items].reverse().map(({ item, payload }) => (
        <EntryView key={item.entry_id} env={item} payload={payload} version={item.version} status={item.status} />
      ))}
    </div>
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
          footer={item.review_comment && <p className="mt-1 text-xs text-slate-600">Reviewer: “{item.review_comment}”</p>}
        />
      ))}
    </div>
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
  const { call } = useLive();
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  async function remove() {
    try {
      await call(`/v1/connections/${connection.connection_id}/remove`, { method: "POST", body: { password: pw, totp_code: code } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Removal failed");
    }
  }
  return (
    <Modal open title={`Remove ${connection.facility.name}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-slate-700">The hospital&apos;s keys are deleted and it can no longer open your record. It keeps read-only access to entries it wrote itself.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password">
            <input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Authenticator code">
            <input inputMode="numeric" maxLength={6} className={`${inputCls} font-mono`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
        {error && <p className="text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={remove} disabled={!pw || code.length !== 6}>
            Remove hospital
          </Button>
        </div>
      </div>
    </Modal>
  );
}
