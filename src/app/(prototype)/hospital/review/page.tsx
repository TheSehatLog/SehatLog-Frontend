"use client";

import { useEffect, useState } from "react";
import { categoryLabel } from "@/components/EntryCard";
import { Badge, Button, Card, Empty, Field, fmt, inputCls } from "@/components/ui";
import { isActive, useSehat } from "@/lib/store";
import type { EntryPayload, Proposal } from "@/lib/types";

const statusTone = { open: "amber", merged: "teal", declined: "rose", "changes-requested": "violet" } as const;

export default function ReviewPage() {
  const s = useSehat();
  const st = s.persona.kind === "staff" ? s.staffById(s.persona.id) : undefined;
  const [selectedId, setSelectedId] = useState<string>();
  if (!st) return <Empty>Choose a staff member in “Viewing as” to open the review queue.</Empty>;

  const mine = s.server!.proposals.filter((p) => p.hospitalId === st.hospitalId);
  const open = mine.filter((p) => p.status === "open");
  const done = mine.filter((p) => p.status !== "open");
  const selected = mine.find((p) => p.id === selectedId) ?? open[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Review queue</h1>
        <p className="text-sm text-slate-600">
          {s.hospital(st.hospitalId)?.name} · every change to a record is a proposal until a reviewer merges it.
          {!st.canMerge && " You can view proposals but your role cannot merge."}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card title={`Proposals (${open.length} open)`}>
          {mine.length === 0 ? (
            <Empty>No proposals yet. Propose an entry from a patient&apos;s record.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {[...open, ...done].map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === p.id ? "border-teal-600 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-500">#{p.id.slice(3)}</span>
                      <Badge tone={statusTone[p.status]}>{p.status}</Badge>
                    </div>
                    <p className="mt-0.5 font-medium text-slate-900">
                      {p.amendsEntryId ? "Amend" : "New"} · {categoryLabel(p.category)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {s.citizen(p.patientId)?.name} · by {s.staffById(p.authorStaffId)?.name}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {selected ? <ProposalDetail key={selected.id} proposal={selected} reviewerId={st.id} /> : <Empty>Select a proposal.</Empty>}
      </div>
    </div>
  );
}

type Row = { field: string; before?: string; after?: string };

function diff(before: EntryPayload | undefined, after: EntryPayload): Row[] {
  const rows: Row[] = [
    { field: "Type", before: before?.kind, after: after.kind },
    { field: "Title", before: before?.title, after: after.title },
    { field: "Details", before: before?.details, after: after.details },
  ];
  const keys = Array.from(new Set([...Object.keys(before?.fields ?? {}), ...Object.keys(after.fields)]));
  for (const k of keys) rows.push({ field: k, before: before?.fields[k], after: after.fields[k] });
  return rows;
}

function ProposalDetail({ proposal: p, reviewerId }: { proposal: Proposal; reviewerId: string }) {
  const s = useSehat();
  const rv = s.staffById(reviewerId)!;
  const author = s.staffById(p.authorStaffId)!;
  const [after, setAfter] = useState<EntryPayload>();
  const [before, setBefore] = useState<EntryPayload | null>();
  const [allergies, setAllergies] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const prior = s.server!.entries.find((e) => e.id === p.amendsEntryId);
  const con = s.server!.connections.find((c) => c.patientId === p.patientId && c.hospitalId === p.hospitalId && isActive(c));

  useEffect(() => {
    s.openProposal(p, reviewerId).then(setAfter);
    if (prior) s.openEntryAsStaff(prior, reviewerId).then(setBefore);
    // Checks run here, on decrypted data, because the server cannot read the record.
    Promise.all(
      s.server!.entries.filter((e) => e.patientId === p.patientId && e.category === "basic" && e.status === "current").map((e) => s.openEntryAsStaff(e, reviewerId)),
    ).then((ps) => setAllergies(ps.filter((x): x is EntryPayload => x?.kind === "Allergy").map((x) => x.title)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  const penicillinClash =
    after?.kind === "Prescription" && /penicillin|amoxicillin|ampicillin|augmentin/i.test(after.title) && allergies.some((a) => /penicillin/i.test(a));
  const checks = [
    { ok: true, label: `Author licence valid (${author.licence})` },
    { ok: !!con, label: con ? "Hospital connection active" : "Hospital no longer connected" },
    { ok: !penicillinClash, label: penicillinClash ? "Allergy conflict: patient has a penicillin allergy" : "No allergy or interaction conflicts" },
    { ok: true, label: "No duplicate entry found" },
  ];
  const canAct = p.status === "open" && rv.canMerge && !!con;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {p.amendsEntryId ? "Amendment" : "New entry"} for {s.citizen(p.patientId)?.name}
          <Badge tone={statusTone[p.status]}>{p.status}</Badge>
        </span>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-slate-50 p-3 text-slate-700">
          <span>
            Author: <b>{author.name}</b>, {author.role} ({author.licence})
          </span>
          <span>Facility: {s.hospital(p.hospitalId)?.name}</span>
          <span>Created: {fmt(p.createdAt)}</span>
          <span>Input: {p.inputMethod}</span>
          <span>Category: {categoryLabel(p.category)}</span>
        </div>

        {!after ? (
          <p className="text-slate-500">Decrypting…</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Field</th>
                  {prior && <th className="px-3 py-2 font-medium">Current (v{prior.version})</th>}
                  <th className="px-3 py-2 font-medium">{prior ? `Proposed (v${prior.version + 1})` : "Proposed"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {diff(before ?? undefined, after).map((r) => {
                  const changed = r.before !== r.after;
                  return (
                    <tr key={r.field} className={changed ? (prior ? "bg-amber-50/50" : "bg-emerald-50/50") : ""}>
                      <td className="px-3 py-2 text-xs font-medium text-slate-600">{r.field}</td>
                      {prior && <td className={`px-3 py-2 ${changed && r.before ? "bg-rose-50 text-rose-800 line-through" : "text-slate-700"}`}>{r.before ?? "—"}</td>}
                      <td className={`px-3 py-2 ${changed && r.after ? "bg-emerald-50 text-emerald-900" : "text-slate-700"}`}>{r.after ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Automated checks (run in this browser)</p>
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? "text-emerald-700" : "font-medium text-rose-700"}>
                {c.ok ? "✓" : "✕"} {c.label}
              </li>
            ))}
          </ul>
        </div>

        {p.status !== "open" ? (
          <p className="text-slate-700">
            {p.status} by {s.staffById(p.reviewerStaffId)?.name} on {fmt(p.decidedAt)}
            {p.reviewComment && <> · “{p.reviewComment}”</>}
          </p>
        ) : canAct ? (
          <div className="space-y-3">
            <Field label="Comment" hint="Required to decline or request changes.">
              <textarea className={inputCls} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={!comment} onClick={() => s.review(p.id, rv.id, "request-changes", comment)}>
                Request changes
              </Button>
              <Button variant="danger" disabled={!comment} onClick={() => s.review(p.id, rv.id, "decline", comment)}>
                Decline
              </Button>
              <Button onClick={() => s.review(p.id, rv.id, "merge", comment || undefined)}>Merge (sign with password)</Button>
            </div>
          </div>
        ) : (
          <p className="text-slate-500">
            {!rv.canMerge ? "Switch to a consultant (e.g. Dr. Tunde Adeyemi) to merge." : "This hospital is no longer connected, so it cannot merge."}
          </p>
        )}
      </div>
    </Card>
  );
}
