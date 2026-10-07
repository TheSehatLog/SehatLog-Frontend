"use client";

import { useEffect, useState } from "react";
import { ApproveDialog } from "@/components/ApproveDialog";
import { categoryLabel, EntryCard } from "@/components/EntryCard";
import { ago, Badge, Button, Card, Empty, Field, fmt, inputCls, Modal } from "@/components/ui";
import { DEMO_PASSWORD } from "@/lib/seed";
import { ageOf, isActive, NOK_TIMEOUT_MS, useSehat, type Readable } from "@/lib/store";
import type { AccessRequest, Connection } from "@/lib/types";

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function CitizenPage() {
  const s = useSehat();
  const now = useNow();
  const meId = s.persona.kind === "citizen" ? s.persona.id : undefined;
  const me = s.citizen(meId);
  const [approving, setApproving] = useState<AccessRequest | null>(null);
  const managed = me ? [...(ageOf(me) >= 18 ? [me] : []), ...s.server!.citizens.filter((c) => c.guardianIds.includes(me.id))] : [];
  const [selected, setSelected] = useState(managed[0]?.id);
  const patient = managed.find((c) => c.id === selected) ?? managed[0];

  if (!me) return <Empty>Choose a citizen in “Viewing as” to open their dashboard.</Empty>;

  const pending = s.server!.requests.filter((r) => r.status === "pending" && s.approversFor(r).includes(me.id));

  function describe(r: AccessRequest) {
    const p = s.citizen(r.patientId)!;
    if (p.id === me!.id) return "Request to access your record";
    if (p.guardianIds.includes(me!.id)) return `Request for your child, ${p.name} (age ${ageOf(p)})`;
    if (r.stage === "nok") return `You are next of kin for ${p.name}, who cannot consent`;
    return `${p.name} and their next of kin could not be reached. You are listed as family.`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Welcome, {me.name.split(" ")[0]}</h1>
        <p className="text-sm text-slate-600">
          NIN {me.nin} · {me.phone}
        </p>
      </div>

      <Card title={`Pending requests (${pending.length})`}>
        {pending.length === 0 ? (
          <Empty>No hospital is waiting for your approval.</Empty>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => {
              const h = s.hospital(r.hospitalId)!;
              const left = r.stage === "patient" ? undefined : Math.max(0, NOK_TIMEOUT_MS - (now - r.stageStartedAt));
              return (
                <li key={r.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-amber-800">{describe(r)}</p>
                      <p className="mt-1 font-semibold text-slate-900">{h.name}</p>
                      <p className="text-sm text-slate-600">
                        {h.address} · HFR {h.hfrId} · {h.type}
                      </p>
                      <p className="mt-1 text-sm text-slate-800">
                        Reason: {r.reason}
                        {r.incapacityReason && <> · Patient status: {r.incapacityReason}</>}
                      </p>
                      <p className="text-sm text-slate-600">
                        Requested by {s.staffById(r.staffId)?.name}, {s.staffById(r.staffId)?.role} · asks for {r.categories.map(categoryLabel).join(", ")}
                      </p>
                      {left !== undefined && (
                        <p className="mt-1 text-sm font-medium text-amber-800">
                          Expires in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}, then passes to the next person automatically
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => s.declineRequest(r.id, me.id)}>
                        Decline
                      </Button>
                      <Button onClick={() => setApproving(r)}>Review and approve</Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {managed.length > 0 && patient && (
        <>
          {managed.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist">
              {managed.map((c) => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={c.id === patient.id}
                  onClick={() => setSelected(c.id)}
                  className={`rounded-full px-4 py-1.5 text-sm ${c.id === patient.id ? "bg-teal-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300"}`}
                >
                  {c.id === me.id ? "My record" : `${c.name} (child, ${ageOf(c)})`}
                </button>
              ))}
            </div>
          )}
          <PatientPanels patientId={patient.id} actorId={me.id} />
        </>
      )}

      {approving && <ApproveDialog request={approving} approverId={me.id} onClose={() => setApproving(null)} />}
    </div>
  );
}

function PatientPanels({ patientId, actorId }: { patientId: string; actorId: string }) {
  const s = useSehat();
  const [tab, setTab] = useState<"hospitals" | "record" | "log">("hospitals");
  const [records, setRecords] = useState<Readable[]>([]);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const entries = s.server!.entries;

  useEffect(() => {
    let live = true;
    s.readAsOwner(patientId).then((r) => live && setRecords(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, entries]);

  const cons = s.server!.connections.filter((c) => c.patientId === patientId);
  const active = cons.filter((c) => isActive(c));
  const previous = cons.filter((c) => !isActive(c));
  const log = s.server!.audit.filter((a) => a.patientId === patientId);

  const levelBadge = (c: Connection) =>
    c.level === "full" ? <Badge tone="teal">Full access</Badge> : c.level === "emergency" ? <Badge tone="rose">Emergency (break-glass)</Badge> : <Badge tone="sky">Scoped</Badge>;
  const grantedLabel = (c: Connection) =>
    c.grantedBy === "break-glass" ? "Break-glass (doctor + Medical Director)" : `${s.citizen(c.grantedById)?.name} (${c.grantedBy === "self" ? "you" : c.grantedBy === "nok" ? "next of kin" : c.grantedBy})`;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["hospitals", `Connected hospitals (${active.length})`],
            ["record", "Health record"],
            ["log", "Change and access log"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? "border-teal-700 font-medium text-teal-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "hospitals" && (
        <div className="space-y-4">
          <Card title="Connected hospitals">
            {active.length === 0 ? (
              <Empty>No hospital is connected.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="pb-2 font-medium">Hospital</th>
                      <th className="pb-2 font-medium">Access level</th>
                      <th className="pb-2 font-medium">Granted by</th>
                      <th className="pb-2 font-medium">Connected</th>
                      <th className="pb-2 font-medium">Expires</th>
                      <th className="pb-2 font-medium">Last opened</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {active.map((c) => {
                      const h = s.hospital(c.hospitalId)!;
                      return (
                        <tr key={c.id} className="align-top">
                          <td className="py-3 pr-3">
                            <p className="font-medium text-slate-900">{h.name}</p>
                            <p className="text-xs text-slate-500">
                              HFR {h.hfrId} · {h.type}
                            </p>
                          </td>
                          <td className="py-3 pr-3">
                            {levelBadge(c)}
                            <p className="mt-1 text-xs text-slate-500">{c.categories.map(categoryLabel).join(", ")}</p>
                          </td>
                          <td className="py-3 pr-3 text-slate-700">{grantedLabel(c)}</td>
                          <td className="py-3 pr-3 text-slate-700">{fmt(c.connectedAt)}</td>
                          <td className="py-3 pr-3 text-slate-700">{c.expiresAt ? fmt(c.expiresAt) : "Until removed"}</td>
                          <td className="py-3 pr-3 text-slate-700">
                            {ago(c.lastOpenedAt)}
                            {c.lastOpenedBy && <p className="text-xs text-slate-500">{s.staffById(c.lastOpenedBy)?.name}</p>}
                          </td>
                          <td className="py-3 text-right">
                            <Button variant="danger" className="px-2.5 py-1 text-xs" onClick={() => setRemoving(c)}>
                              Remove
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {previous.length > 0 && (
            <Card title="Previously connected">
              <ul className="space-y-2 text-sm">
                {previous.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-slate-800">{s.hospital(c.hospitalId)?.name}</span>
                    <span className="text-slate-500">
                      {c.removedAt ? `Removed ${fmt(c.removedAt)}` : `Expired ${fmt(c.expiresAt)}`} · keeps read-only access to its own entries
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === "record" && (
        <Card title="Health record" action={<span className="text-xs text-slate-500">Decrypted on this device with your keys</span>}>
          <div className="space-y-3">
            {records.length === 0 ? <Empty>No entries yet.</Empty> : [...records].reverse().map((r) => <EntryCard key={r.entry.id} item={r} />)}
          </div>
        </Card>
      )}

      {tab === "log" && (
        <Card title="Change and access log">
          <ul className="divide-y divide-slate-100 text-sm">
            {log.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 py-2">
                <span className="w-40 shrink-0 text-slate-500">{fmt(a.at)}</span>
                <span className="font-medium text-slate-900">{a.actor}</span>
                <span className="text-slate-700">{a.action}</span>
                <span className="text-slate-500">{a.detail}</span>
                {a.hospitalId && <span className="text-slate-400">· {s.hospital(a.hospitalId)?.name}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {removing && <RemoveDialog connection={removing} actorId={actorId} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function RemoveDialog({ connection, actorId, onClose }: { connection: Connection; actorId: string; onClose: () => void }) {
  const s = useSehat();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const h = s.hospital(connection.hospitalId)!;

  async function confirm() {
    if (pw !== DEMO_PASSWORD) return setErr("Wrong password.");
    setBusy(true);
    await s.removeConnection(connection.id, actorId);
    onClose();
  }

  return (
    <Modal open title={`Remove ${h.name}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>The hospital&apos;s keys are deleted and your record keys are rotated, so it cannot read anything written from now on.</li>
          <li>It keeps read-only access to the entries it wrote itself, for its legal records.</li>
          <li>The hospital is notified. If you are admitted there, removal takes effect at discharge.</li>
        </ul>
        <Field label="Confirm with your password" hint={`Demo password: ${DEMO_PASSWORD}. 2FA is skipped in this step of the demo.`}>
          <input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </Field>
        {err && <p className="text-rose-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={busy}>
            {busy ? "Rotating keys…" : "Remove hospital"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
