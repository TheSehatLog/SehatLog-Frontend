"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, fmt } from "@/components/ui";
import { blindIndex, openEscrowPrivateKey, shortFingerprint } from "@/lib/crypto";
import { isActive, PART_FOR, useSehat } from "@/lib/store";

const GROUP_LABEL = { sehatlog: "SehatLog", regulator: "Government regulator", independent: "Independent body" };

const short = (b64: string, n = 48) => (b64.length > n ? `${b64.slice(0, n)}…` : b64);

export default function AdminPage() {
  const s = useSehat();
  const srv = s.server!;
  const [index, setIndex] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState<string>();
  const [partPrints, setPartPrints] = useState<Record<string, string>>({});
  const [aloneResult, setAloneResult] = useState<string>();
  const sample = srv.citizens[0].id;

  useEffect(() => {
    Promise.all(srv.citizens.map(async (c) => [c.id, await blindIndex(c.nin)] as const)).then((pairs) => setIndex(Object.fromEntries(pairs)));
  }, [srv.citizens]);

  useEffect(() => {
    Promise.all(srv.custodians.map(async (cu) => [cu.id, await shortFingerprint(s.custodianPart(cu.id, sample))] as const)).then((p) =>
      setPartPrints(Object.fromEntries(p)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srv.custodians.length, sample]);

  // Real check: SehatLog's part alone (R and I unknown) cannot open the escrow key.
  async function tryAlone() {
    const zero = new Uint8Array(32);
    try {
      await openEscrowPrivateKey(srv.escrowSealed[sample], { S: s.custodianPart("cu-sehatlog", sample), R: zero, I: zero }, sample);
      setAloneResult("Unexpected: the key opened.");
    } catch {
      setAloneResult(`Refused: SehatLog's part alone failed to decrypt the escrow key for ${ref(sample)} (AES-GCM authentication failed). R and I are also needed.`);
    }
  }

  // Admins see record ids, never names: map citizen id to an opaque record ref.
  const ref = (id: string) => `rec_${(index[id] ?? "").slice(0, 8)}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">SehatLog admin: what the server holds</h1>
        <p className="text-sm text-slate-600">
          This is the database as SehatLog staff, a cloud host or anyone tapping the API would see it. Clinical content is ciphertext and SehatLog holds no key that can
          open it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Patient records", srv.citizens.length],
          ["Active hospital connections", srv.connections.filter((c) => isActive(c)).length],
          ["Merged entries", srv.entries.length],
          ["Open proposals", srv.proposals.filter((p) => p.status === "open").length],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-2xl font-semibold text-slate-900">{n}</p>
            <p className="text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <Card
        title="Encrypted entries"
        action={
          <Button
            variant="secondary"
            onClick={() =>
              setAttempt(
                "Decryption failed: no key available. Each entry key is wrapped with the patient's category key, which is only ever stored wrapped to hospital and escrow public keys. SehatLog holds none of the matching private keys.",
              )
            }
          >
            Try to decrypt
          </Button>
        }
      >
        {attempt && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{attempt}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 font-medium">Entry</th>
                <th className="pb-2 font-medium">Record</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Facility</th>
                <th className="pb-2 font-medium">Merged</th>
                <th className="pb-2 font-medium">Ciphertext (AES-256-GCM)</th>
                <th className="pb-2 font-medium">Wrapped entry key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {srv.entries.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-3">{e.id}</td>
                  <td className="py-2 pr-3">{ref(e.patientId)}</td>
                  <td className="py-2 pr-3 font-sans">
                    {e.category} v{e.sealed.keyVersion}
                  </td>
                  <td className="py-2 pr-3">{e.hospitalId}</td>
                  <td className="py-2 pr-3 font-sans">{fmt(e.mergedAt)}</td>
                  <td className="py-2 pr-3 text-slate-500">{short(e.sealed.ciphertext)}</td>
                  <td className="py-2 text-slate-500">{short(e.sealed.wrappedDek, 24)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Emergency escrow custodians"
        action={
          <Button variant="secondary" onClick={tryAlone}>
            Test: SehatLog part alone
          </Button>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Each record&apos;s escrow key opens only with SehatLog&apos;s part (S) + a regulator&apos;s part (R) + an independent body&apos;s part (I). Switch custodians off to see
          emergency releases refused in the hospital view.
        </p>
        {aloneResult && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{aloneResult}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="pb-2 font-medium">Custodian</th>
                <th className="pb-2 font-medium">Group</th>
                <th className="pb-2 font-medium">Holds part</th>
                <th className="pb-2 font-medium">Part fingerprint ({ref(sample)})</th>
                <th className="pb-2 font-medium">Responding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {srv.custodians.map((cu) => (
                <tr key={cu.id}>
                  <td className="py-2 pr-3 font-medium text-slate-900">{cu.name}</td>
                  <td className="py-2 pr-3 text-slate-700">{GROUP_LABEL[cu.group]}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={cu.group === "sehatlog" ? "teal" : cu.group === "regulator" ? "sky" : "violet"}>{PART_FOR[cu.group]}</Badge>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-500">{partPrints[cu.id]}</td>
                  <td className="py-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                      <input type="checkbox" className="accent-teal-700" checked={cu.available} onChange={(e) => s.setCustodianAvailable(cu.id, e.target.checked)} />
                      {cu.available ? "Online" : "Offline"}
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Working candidates only; seats are agreed with government before go-live. Production uses threshold decryption, so the parts are never combined in one place.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Patient index (keyed hash of NIN)">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-2 font-medium">Record</th>
                <th className="pb-2 font-medium">HMAC(NIN)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {srv.citizens.map((c) => (
                <tr key={c.id}>
                  <td className="py-1.5">{ref(c.id)}</td>
                  <td className="py-1.5 text-slate-500">{index[c.id]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Names and NINs are not stored. Identity is checked live against NIMC.</p>
        </Card>

        <Card title="Hospital connections">
          <ul className="space-y-2 text-xs">
            {srv.connections.map((c) => (
              <li key={c.id} className="rounded-md bg-slate-50 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{ref(c.patientId)}</span>→<span className="font-mono">{c.hospitalId}</span>
                  <Badge tone={isActive(c) ? "teal" : "slate"}>{isActive(c) ? c.level : "removed"}</Badge>
                </div>
                <p className="mt-1 break-all font-mono text-slate-500">
                  {Object.entries(c.wrappedKeys)
                    .map(([cat, v]) => `${cat}: ${short(Object.values(v ?? {})[0] ?? "", 20)}`)
                    .join(" · ") || "keys deleted"}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Audit log (metadata only)">
        <ul className="divide-y divide-slate-100 text-xs">
          {srv.audit.slice(0, 30).map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-3 py-1.5">
              <span className="w-36 text-slate-500">{fmt(a.at)}</span>
              <span className="font-mono">{ref(a.patientId)}</span>
              <span className="font-mono text-slate-500">{a.hospitalId ?? "—"}</span>
              <span className="text-slate-800">{a.action}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
