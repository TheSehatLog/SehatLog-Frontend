"use client";

import { useCallback, useEffect, useState } from "react";
import { useLive } from "@/components/live/LiveSession";
import { Badge, Button, Card, Empty, Field, fmt, inputCls } from "@/components/ui";
import { ApiError, type Entry, type Me, type Proposal } from "@/lib/live/api";
import { CATEGORY_LABEL, getFacilityKey, getSigningSeed } from "@/lib/live/keystore";
import { decryptEnvelope, mergeSignature, type Payload } from "@/lib/live/records";

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
    </div>
  );
}

function Detail({ me, p, onDone }: { me: StaffMe; p: Proposal; onDone: () => void }) {
  const { call } = useLive();
  const [after, setAfter] = useState<Payload | null | undefined>(undefined);
  const [before, setBefore] = useState<{ entry: Entry; payload: Payload | null } | null>(null);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState("");
  const priv = getFacilityKey(me.facility.facility_id);

  const load = useCallback(async () => {
    // Reviewers are at the authoring facility, so the author-wrapped entry key opens it.
    const own = priv ? { facilityId: me.facility.facility_id, priv } : undefined;
    const proposed = await decryptEnvelope(p, null, own);
    let prior: { entry: Entry; payload: Payload | null } | null = null;
    if (p.amends_entry_id) {
      const { entries } = await call<{ entries: Entry[] }>(`/v1/records/${p.record_id}/entries`);
      const prev = entries.find((e) => e.entry_id === p.amends_entry_id);
      if (prev) prior = { entry: prev, payload: await decryptEnvelope(prev, null, own) };
    }
    return { proposed, prior };
  }, [p, priv, me.facility.facility_id, call]);

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
      await call(`/v1/proposals/${p.proposal_id}/${action}`, { method: "POST", body: { comment } });
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
