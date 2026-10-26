"use client";

import { useCallback, useEffect, useState } from "react";
import { EntryView } from "@/components/live/EntryView";
import { useLive } from "@/components/live/LiveSession";
import { Sealed } from "@/components/live/Sealed";
import { Badge, Button, Card, Empty, Field, fmt, inputCls } from "@/components/ui";
import { ApiError, type Dispute, type Entry, type Me, type Proposal } from "@/lib/live/api";
import { CATEGORY_LABEL, getSigningSeed } from "@/lib/live/keystore";
import { useFacilityKeys } from "@/components/live/FacilityKeys";
import { decryptEnvelope, mergeSignature, type Payload } from "@/lib/live/records";
import { sealToFacilityAndCircle } from "@/lib/live/sealed";

type StaffMe = Extract<Me, { actor_type: "staff" }>;

export default function ReviewQueue() {
  const { me, call } = useLive();
  const [list, setList] = useState<Proposal[] | null>(null);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (me?.actor_type !== "staff") return;
    call<{ proposals: Proposal[] }>("/v1/facility/proposals?status=open")
      .then((r) => setList(r.proposals))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [me, call, tick]);

  if (me?.actor_type !== "staff") return <Empty>Sign in as hospital staff to review proposals.</Empty>;
  const current = list?.find((p) => p.proposal_id === selected) ?? list?.[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Review queue</h1>
        <p className="text-sm text-slate-600">
          {me.facility.name} · open proposals. {me.can_merge ? "You can merge, decline or request changes." : "Your role can view but not merge."}
        </p>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card title={`Open (${list?.length ?? "…"})`} action={<Button variant="ghost" onClick={() => setTick((t) => t + 1)}>Refresh</Button>}>
          {!list ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : list.length === 0 ? (
            <Empty>Nothing to review.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {list.map((p) => (
                <li key={p.proposal_id}>
                  <button
                    onClick={() => setSelected(p.proposal_id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${current?.proposal_id === p.proposal_id ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <p className="font-medium text-slate-900">
                      {p.amends_entry_id ? "Amendment" : "New"} · {CATEGORY_LABEL[p.category] ?? p.category}
                    </p>
                    <p className="font-mono text-xs text-slate-500">
                      {p.record_id} · {p.author_staff_id}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {current ? <Detail key={current.proposal_id} me={me} p={current} onDone={() => setTick((t) => t + 1)} /> : <Empty>Select a proposal.</Empty>}
      </div>
      <FastTrackQueue me={me} />
      {(me.role === "Medical Director" || me.can_merge) && <DisputeQueue me={me} />}
    </div>
  );
}

// Emergency entries merged by their author without review. A second clinician signs to
// confirm them; after 24 hours the Medical Director is alerted.
function FastTrackQueue({ me }: { me: StaffMe }) {
  const { call } = useLive();
  const [items, setItems] = useState<{ entry: Entry; payload: Payload | null }[] | null>(null);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const { unwrap } = useFacilityKeys();

  const load = useCallback(async () => {
    const { entries } = await call<{ entries: Entry[] }>("/v1/facility/pending-reviews");
    const own = unwrap ? { facilityId: me.facility.facility_id, unwrap } : undefined;
    return Promise.all(entries.map(async (entry) => ({ entry, payload: await decryptEnvelope(entry, null, own) })));
  }, [call, unwrap, me.facility.facility_id]);

  useEffect(() => {
    let live = true;
    load()
      .then((v) => live && setItems(v))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [load, tick]);

  async function confirm(e: Entry) {
    setMsg("");
    try {
      const seed = getSigningSeed(me.id);
      if (!seed) throw new Error("Register your signing key under Keys first.");
      await call(`/v1/entries/${e.entry_id}/review`, { method: "POST", body: { review_signature: await mergeSignature(seed, e) } });
      setTick((t) => t + 1);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Review failed");
    }
  }

  if (!items || items.length === 0) return null;
  return (
    <Card title={`Emergency entries awaiting review (${items.length})`} action={<Button variant="ghost" onClick={() => setTick((t) => t + 1)}>Refresh</Button>}>
      <p className="mb-3 text-sm text-slate-600">Merged by the treating doctor during an emergency. Check each one and sign to confirm, or propose an amendment if it is wrong.</p>
      <div className="space-y-3">
        {items.map(({ entry, payload }) => (
          <EntryView
            key={entry.entry_id}
            env={entry}
            payload={payload}
            version={entry.version}
            status={entry.status}
            footer={<p className="mt-1 text-xs text-slate-500">By {entry.author_staff_id} · merged {fmt(Date.parse(entry.merged_at))}</p>}
            actions={
              me.can_merge && entry.author_staff_id !== me.id ? (
                <Button onClick={() => confirm(entry)} disabled={!payload}>
                  Sign as reviewed
                </Button>
              ) : null
            }
          />
        ))}
      </div>
      {msg && <p className="mt-2 text-sm text-rose-600">{msg}</p>}
    </Card>
  );
}

type DisputeItem = { d: Dispute; entry?: Entry; payload: Payload | null; amendments: { entry: Entry; payload: Payload | null }[] };

// Patient disputes of entries written here. The Medical Director upholds the entry or
// links the merged amendment that corrects it.
function DisputeQueue({ me }: { me: StaffMe }) {
  const { call } = useLive();
  const [items, setItems] = useState<DisputeItem[] | null>(null);
  const [tick, setTick] = useState(0);
  const { unwrap } = useFacilityKeys();

  const load = useCallback(async (): Promise<DisputeItem[]> => {
    const { disputes } = await call<{ disputes: Dispute[] }>("/v1/facility/disputes?status=open");
    const own = unwrap ? { facilityId: me.facility.facility_id, unwrap } : undefined;
    return Promise.all(
      disputes.map(async (d) => {
        const { entries } = await call<{ entries: Entry[] }>(`/v1/records/${d.record_id}/entries`);
        const entry = entries.find((e) => e.entry_id === d.entry_id);
        const amendments = await Promise.all(
          entries.filter((e) => e.amends_entry_id === d.entry_id).map(async (e) => ({ entry: e, payload: await decryptEnvelope(e, null, own) })),
        );
        return { d, entry, payload: entry ? await decryptEnvelope(entry, null, own) : null, amendments };
      }),
    );
  }, [call, unwrap, me.facility.facility_id]);

  useEffect(() => {
    let live = true;
    load()
      .then((v) => live && setItems(v))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [load, tick]);

  return (
    <Card title={`Patient disputes (${items?.length ?? "…"} open)`} action={<Button variant="ghost" onClick={() => setTick((t) => t + 1)}>Refresh</Button>}>
      {!items ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <Empty>No open disputes.</Empty>
      ) : (
        <div className="space-y-4">
          {items.map((it) => (
            <DisputeRow key={it.d.dispute_id} me={me} item={it} onDone={() => setTick((t) => t + 1)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function DisputeRow({ me, item, onDone }: { me: StaffMe; item: DisputeItem; onDone: () => void }) {
  const { call } = useLive();
  const [outcome, setOutcome] = useState<"upheld" | "amended">(item.amendments.length ? "amended" : "upheld");
  const [amendment, setAmendment] = useState(item.amendments[0]?.entry.entry_id ?? "");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const { d } = item;

  async function resolve() {
    setMsg("");
    try {
      const note_sealed = await sealToFacilityAndCircle(call, note, "dispute-resolution", d.record_id, me.facility.facility_id);
      await call(`/v1/disputes/${d.dispute_id}/resolve`, { method: "POST", body: { outcome, note_sealed, amendment_entry_id: outcome === "amended" ? amendment : "" } });
      onDone();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not resolve");
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4 text-sm">
      <p className="text-xs text-slate-500">
        {d.record_id} · {fmt(Date.parse(d.created_at))} · entry {d.entry_id}
      </p>
      <p className="mt-1 font-medium text-slate-900">Entry: {item.payload ? `${item.payload.kind}: ${item.payload.title}` : "can't be decrypted here (load the facility key)"}</p>
      <p className="mt-1 text-slate-800">
        Patient says: <Sealed value={d.reason_sealed} purpose="dispute-reason" recordId={d.record_id} render={(t) => <>“{t}”</>} />
      </p>
      {me.role === "Medical Director" ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            {(["upheld", "amended"] as const).map((o) => (
              <Button key={o} variant={outcome === o ? "primary" : "secondary"} onClick={() => setOutcome(o)} disabled={o === "amended" && item.amendments.length === 0}>
                {o === "upheld" ? "Entry is correct" : "Corrected by an amendment"}
              </Button>
            ))}
          </div>
          {outcome === "amended" && (
            <Field label="Merged amendment">
              <select className={inputCls} value={amendment} onChange={(e) => setAmendment(e.target.value)}>
                {item.amendments.map((a) => (
                  <option key={a.entry.entry_id} value={a.entry.entry_id}>
                    v{a.entry.version}: {a.payload?.title ?? a.entry.entry_id}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {item.amendments.length === 0 && <p className="text-xs text-slate-500">To correct it, propose and merge an amendment of this entry first.</p>}
          <Field label="Note to the patient (encrypted to the patient's circle and your facility)">
            <textarea className={inputCls} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button onClick={resolve} disabled={!note.trim() || (outcome === "amended" && !amendment)}>
            Resolve dispute
          </Button>
          {msg && <p className="text-rose-600">{msg}</p>}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">The Medical Director resolves disputes.</p>
      )}
    </div>
  );
}

function Detail({ me, p, onDone }: { me: StaffMe; p: Proposal; onDone: () => void }) {
  const { call } = useLive();
  const [after, setAfter] = useState<Payload | null | undefined>(undefined);
  const [before, setBefore] = useState<{ entry: Entry; payload: Payload | null } | null>(null);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");
  const { unwrap } = useFacilityKeys();

  const load = useCallback(async () => {
    // Reviewers are at the authoring facility, so the author-wrapped entry key opens it.
    const own = unwrap ? { facilityId: me.facility.facility_id, unwrap } : undefined;
    const proposed = await decryptEnvelope(p, null, own);
    let prior: { entry: Entry; payload: Payload | null } | null = null;
    if (p.amends_entry_id) {
      const { entries } = await call<{ entries: Entry[] }>(`/v1/records/${p.record_id}/entries`);
      const prev = entries.find((e) => e.entry_id === p.amends_entry_id);
      if (prev) prior = { entry: prev, payload: await decryptEnvelope(prev, null, own) };
    }
    return { proposed, prior };
  }, [p, unwrap, me.facility.facility_id, call]);

  useEffect(() => {
    let live = true;
    load()
      .then((v) => {
        if (!live) return;
        setAfter(v.proposed);
        setBefore(v.prior);
      })
      .catch(() => live && setAfter(null));
    return () => {
      live = false;
    };
  }, [load]);

  async function merge() {
    setMsg("");
    try {
      const seed = getSigningSeed(me.id);
      if (!seed) throw new Error("Register your signing key under Keys first.");
      await call(`/v1/proposals/${p.proposal_id}/merge`, { method: "POST", body: { merge_signature: await mergeSignature(seed, p) } });
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Merge failed");
    }
  }

  async function decide(action: "decline" | "request-changes") {
    setMsg("");
    try {
      // Sealed to this facility and the patient's circle (patients see review comments).
      const comment_sealed = await sealToFacilityAndCircle(call, comment, "review-comment", p.record_id, me.facility.facility_id);
      await call(`/v1/proposals/${p.proposal_id}/${action}`, { method: "POST", body: { comment_sealed } });
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    }
  }

  const rows = after ? diff(before?.payload ?? undefined, after) : [];

  return (
    <Card title={<span className="flex items-center gap-2">{p.amends_entry_id ? "Amendment" : "New entry"} for {p.record_id} <Badge tone="amber">open</Badge></span>}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
          <span>author {p.author_staff_id}</span>
          <span>{p.input_method}</span>
          <span>created {fmt(Date.parse(p.created_at))}</span>
          <span>signature ✓ verified by the API</span>
        </div>
        {after === undefined ? (
          <p className="text-slate-500">Decrypting…</p>
        ) : after === null ? (
          <p className="text-amber-800">Can&apos;t decrypt here: load your facility key under Keys.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Field</th>
                  {before && <th className="px-3 py-2 font-medium">Current (v{before.entry.version})</th>}
                  <th className="px-3 py-2 font-medium">Proposed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const changed = r.before !== r.after;
                  return (
                    <tr key={r.field}>
                      <td className="px-3 py-2 text-xs font-medium text-slate-600">{r.field}</td>
                      {before && <td className={`px-3 py-2 ${changed && r.before ? "bg-rose-50 text-rose-800 line-through" : ""}`}>{r.before ?? "—"}</td>}
                      <td className={`px-3 py-2 ${changed && r.after ? "bg-emerald-50 text-emerald-900" : ""}`}>{r.after ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {me.can_merge ? (
          <div className="space-y-3">
            <Field label="Comment" hint="Required to decline or request changes.">
              <textarea className={inputCls} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={!comment.trim()} onClick={() => decide("request-changes")}>
                Request changes
              </Button>
              <Button variant="danger" disabled={!comment.trim()} onClick={() => decide("decline")}>
                Decline
              </Button>
              <Button onClick={merge} disabled={!after}>
                Sign and merge
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-slate-500">A consultant at your facility must review this.</p>
        )}
        {msg && <p className="text-rose-600">{msg}</p>}
      </div>
    </Card>
  );
}

function diff(before: Payload | undefined, after: Payload) {
  const rows: { field: string; before?: string; after?: string }[] = [
    { field: "Type", before: before?.kind, after: after.kind },
    { field: "Title", before: before?.title, after: after.title },
    { field: "Details", before: before?.details, after: after.details },
  ];
  const keys = new Set([...Object.keys(before?.fields ?? {}), ...Object.keys(after.fields ?? {})]);
  for (const k of keys) rows.push({ field: k, before: before?.fields?.[k], after: after.fields?.[k] });
  return rows;
}
