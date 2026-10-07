"use client";

import { useEffect, useState } from "react";
import { categoryLabel, EntryCard } from "@/components/EntryCard";
import { ProposeDialog } from "@/components/ProposeDialog";
import { Badge, Button, Card, Empty, Field, fmt, inputCls } from "@/components/ui";
import { ageOf, isActive, NOK_TIMEOUT_MS, roleAllows, useSehat, type Readable } from "@/lib/store";
import { CATEGORIES, type Category, type Citizen, type EntryPayload } from "@/lib/types";

const INCAPACITY = ["Unconscious", "Sedated", "Confused", "Critically ill", "Other"];

export default function HospitalPage() {
  const s = useSehat();
  const st = s.persona.kind === "staff" ? s.staffById(s.persona.id) : undefined;
  if (!st) return <Empty>Choose a staff member in “Viewing as” to use the hospital view.</Empty>;
  // Keyed by staff member, so switching staff clears the open patient.
  return <Lookup key={st.id} staffId={st.id} />;
}

function Lookup({ staffId }: { staffId: string }) {
  const s = useSehat();
  const st = s.staffById(staffId)!;
  const [nin, setNin] = useState("");
  const [patientId, setPatientId] = useState<string>();
  const [notFound, setNotFound] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanFinger, setScanFinger] = useState("FP-AISHA");
  const hospital = s.hospital(st.hospitalId)!;
  const patient = s.citizen(patientId);

  function byNin() {
    const c = s.lookup({ nin }, st!.id);
    setNotFound(!c);
    setPatientId(c?.id);
  }

  function scan() {
    setScanning(true);
    setTimeout(() => {
      const c = s.lookup({ fingerprint: scanFinger }, st!.id);
      setScanning(false);
      setNotFound(!c);
      setPatientId(c?.id);
    }, 900);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{hospital.name}</h1>
          <p className="text-sm text-slate-600">
            {st.name} · {st.role}
            {st.specialty ? `, ${st.specialty}` : ""} · {st.licence} <Badge tone="teal">Licence verified</Badge>
          </p>
        </div>
      </div>

      <Card title="Find a patient">
        <div className="grid gap-4 md:grid-cols-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              byNin();
            }}
            className="space-y-2"
          >
            <Field label="NIN" hint="Try 23456789012 (Aisha), 56789012345 (Zainab, child), 34567890123 (Musa)">
              <div className="flex gap-2">
                <input className={`${inputCls} font-mono`} value={nin} onChange={(e) => setNin(e.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="11-digit NIN" />
                <Button type="submit" disabled={nin.length !== 11}>
                  Look up
                </Button>
              </div>
            </Field>
          </form>
          <div className="space-y-2">
            <Field label="Fingerprint scanner (simulated)" hint="Pick whose finger is on the scanner. Search by fingerprint alone needs a direct NIMC agreement; without it, fingerprint is a 1:1 check after a NIN lookup.">
              <div className="flex gap-2">
                <select className={inputCls} value={scanFinger} onChange={(e) => setScanFinger(e.target.value)}>
                  {s.server!.citizens.map((c) => (
                    <option key={c.id} value={c.fingerprint}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={scan} disabled={scanning}>
                  {scanning ? "Matching…" : "Scan"}
                </Button>
              </div>
            </Field>
          </div>
        </div>
        {notFound && <p className="mt-3 text-sm text-rose-600">No match. In production, staff can open a temporary “Unidentified patient” record.</p>}
      </Card>

      {patient && <PatientView key={patient.id} patient={patient} staffId={st.id} />}
    </div>
  );
}

function PatientView({ patient, staffId }: { patient: Citizen; staffId: string }) {
  const s = useSehat();
  const st = s.staffById(staffId)!;
  const [basic, setBasic] = useState<EntryPayload[]>([]);
  const [escrowError, setEscrowError] = useState("");
  const con = s.activeConnection(patient.id, st.hospitalId);
  const pending = s.server!.requests.find((r) => r.patientId === patient.id && r.hospitalId === st.hospitalId && r.status === "pending");
  const lastDeclined = s.server!.requests.find((r) => r.patientId === patient.id && r.hospitalId === st.hospitalId && r.status === "declined");
  const entryCount = s.server!.entries.filter((e) => e.patientId === patient.id && e.category === "basic").length;

  useEffect(() => {
    s.basicProfile(patient.id, st.hospitalId)
      .then((b) => {
        setBasic(b);
        setEscrowError("");
      })
      .catch((e: Error) => setEscrowError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, entryCount]);

  const nok = s.citizen(patient.nokId);
  const allergies = basic.filter((b) => b.kind === "Allergy");
  const fields = Object.assign({}, ...basic.map((b) => b.fields)) as Record<string, string>;
  const connected = s.server!.connections.filter((c) => c.patientId === patient.id && isActive(c));
  const isChild = ageOf(patient) < 18;

  return (
    <div className="space-y-6">
      <section className="rounded-xl border-2 border-rose-200 bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50 px-5 py-3">
          <h2 className="text-sm font-semibold text-rose-900">Basic Emergency Profile</h2>
          <span className="text-xs text-rose-800">Released by SehatLog + a regulator + an independent body · logged · patient notified</span>
        </header>
        {escrowError && <p className="border-b border-rose-100 bg-rose-100/60 px-5 py-2 text-sm font-medium text-rose-800">{escrowError}</p>}
        <div className="grid gap-5 p-5 md:grid-cols-3">
          <div>
            <p className="text-lg font-semibold text-slate-900">{patient.name}</p>
            <p className="text-sm text-slate-600">
              {patient.sex === "F" ? "Female" : "Male"} · {ageOf(patient)} years · born {patient.dob}
            </p>
            <p className="text-sm text-slate-600">NIN {patient.nin}</p>
            {isChild && (
              <p className="mt-1">
                <Badge tone="amber">Child: parents or guardians approve access</Badge>
              </p>
            )}
            <div className="mt-3 flex gap-4">
              <div>
                <p className="text-xs text-slate-500">Blood group</p>
                <p className="text-lg font-semibold text-slate-900">{fields["Blood group"] ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Genotype</p>
                <p className="text-lg font-semibold text-slate-900">{fields["Genotype"] ?? "—"}</p>
              </div>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Critical allergies and alerts</p>
            {allergies.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">None recorded</p>
            ) : (
              allergies.map((a) => (
                <p key={a.title} className="mt-1 rounded-md bg-rose-100 px-2 py-1 text-sm font-semibold text-rose-900">
                  ⚠ {a.title}
                </p>
              ))
            )}
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{isChild ? "Parents / guardians" : "Next of kin"}</p>
            {(isChild ? patient.guardianIds.map((id) => s.citizen(id)!) : nok ? [nok] : []).map((c) => (
              <p key={c.id} className="text-slate-800">
                {c.name} · {c.phone}
              </p>
            ))}
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Family</p>
            {patient.familyIds.map((id) => (
              <p key={id} className="text-slate-800">
                {s.citizen(id)?.name} · {s.citizen(id)?.phone}
              </p>
            ))}
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Connected hospitals</p>
            <p className="text-slate-800">{connected.map((c) => s.hospital(c.hospitalId)?.name).join(", ") || "None"}</p>
          </div>
        </div>
      </section>

      {con ? (
        <RecordView patientId={patient.id} staffId={staffId} />
      ) : pending ? (
        <PendingView requestId={pending.id} staffId={staffId} />
      ) : (
        <RequestForm patient={patient} staffId={staffId} declined={!!lastDeclined} />
      )}
      {!con && <OwnEntries patientId={patient.id} staffId={staffId} />}
    </div>
  );
}

// Without a connection, a hospital can still open the entries it wrote itself.
function OwnEntries({ patientId, staffId }: { patientId: string; staffId: string }) {
  const s = useSehat();
  const st = s.staffById(staffId)!;
  const [items, setItems] = useState<Readable[]>([]);
  const entries = s.server!.entries;
  useEffect(() => {
    s.readAsStaff(patientId, staffId).then((r) => setItems(r.filter((x) => x.state === "open")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, staffId, entries]);
  if (items.length === 0) return null;
  return (
    <Card title={`Entries written by ${s.hospital(st.hospitalId)?.name} (read-only)`}>
      <div className="space-y-3">
        {items.map((it) => (
          <EntryCard key={it.entry.id} item={it} />
        ))}
      </div>
    </Card>
  );
}

function RequestForm({ patient, staffId, declined }: { patient: Citizen; staffId: string; declined: boolean }) {
  const s = useSehat();
  const st = s.staffById(staffId)!;
  const defaultCats: Category[] = st.role === "Lab Scientist" ? ["labs"] : ["clinical", "medications", "labs"];
  const [reason, setReason] = useState(st.role === "Paramedic" ? "Road traffic accident, pre-hospital care" : st.role === "Lab Scientist" ? "Laboratory tests ordered" : "Outpatient consultation");
  const [cats, setCats] = useState<Category[]>(defaultCats);
  const [canConsent, setCanConsent] = useState(st.role !== "Paramedic");
  const [incap, setIncap] = useState(INCAPACITY[0]);
  const isChild = ageOf(patient) < 18;

  return (
    <Card title="Request access to the full record">
      {declined && <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">A previous request was declined.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Reason (shown to the approver)">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Scope requested" hint="The approver can accept this scope or narrow it.">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.filter((c) => c.id !== "basic").map((c) => (
              <label key={c.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${cats.includes(c.id) ? "border-teal-600 bg-teal-50" : "border-slate-300"}`}>
                <input
                  type="checkbox"
                  className="accent-teal-700"
                  checked={cats.includes(c.id)}
                  onChange={() => setCats((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                />
                {c.short}
              </label>
            ))}
          </div>
        </Field>
        <Field label={isChild ? "Approval goes to the parents or guardians" : "Can the patient consent now?"}>
          {isChild ? (
            <p className="text-sm text-slate-600">Children cannot approve their own record. Both linked guardians are notified.</p>
          ) : (
            <div className="flex gap-2">
              <Button variant={canConsent ? "primary" : "secondary"} onClick={() => setCanConsent(true)}>
                Yes, patient will approve
              </Button>
              <Button variant={!canConsent ? "danger" : "secondary"} onClick={() => setCanConsent(false)}>
                Patient unable to consent
              </Button>
            </div>
          )}
        </Field>
        {!canConsent && !isChild && (
          <Field label="Patient status" hint="The request goes to the next of kin, then to family after 30 minutes.">
            <select className={inputCls} value={incap} onChange={(e) => setIncap(e.target.value)}>
              {INCAPACITY.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          disabled={!reason || cats.length === 0}
          onClick={() =>
            s.requestAccess({
              patientId: patient.id,
              staffId,
              reason,
              categories: ["basic", ...cats],
              patientCanConsent: isChild || canConsent,
              incapacityReason: !isChild && !canConsent ? incap : undefined,
            })
          }
        >
          Send request
        </Button>
      </div>
    </Card>
  );
}

function PendingView({ requestId, staffId }: { requestId: string; staffId: string }) {
  const s = useSehat();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const r = s.server!.requests.find((x) => x.id === requestId)!;
  const st = s.staffById(staffId)!;
  const approvers = s.approversFor(r).map((id) => s.citizen(id)!);
  const left = Math.max(0, NOK_TIMEOUT_MS - (now - r.stageStartedAt));
  const canSign = ["Doctor", "Consultant", "Medical Director"].includes(st.role) && !r.breakGlassSigners.includes(st.id);
  const stageLabel = { patient: "Waiting for the patient", nok: "Waiting for next of kin", family: "Waiting for family members", "break-glass": "Nobody reachable: break-glass" }[r.stage];
  const [releaseError, setReleaseError] = useState("");
  const sign = () =>
    s
      .signBreakGlass(r.id, st.id)
      .then(() => setReleaseError(""))
      .catch((e: Error) => setReleaseError(e.message));

  return (
    <Card title="Access request pending" action={<Badge tone="amber">{stageLabel}</Badge>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-700">
          Reason: {r.reason} · scope: {r.categories.map(categoryLabel).join(", ")}
          {r.incapacityReason && <> · patient status: {r.incapacityReason}</>}
        </p>
        {r.stage !== "break-glass" ? (
          <>
            <p className="text-slate-700">
              Notified by push, SMS and email{r.stage !== "patient" ? ", plus an automated voice call" : ""}:{" "}
              <span className="font-medium">{approvers.map((a) => `${a.name} (${a.phone})`).join(", ")}</span>
            </p>
            {r.stage !== "patient" && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-medium text-amber-800">
                  Moves on automatically in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}
                </p>
                <Button variant="secondary" onClick={() => s.advanceStage(r.id)}>
                  Simulate 30 minutes passing
                </Button>
              </div>
            )}
            <p className="text-xs text-slate-500">Switch “Viewing as” to an approver to answer the request.</p>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-slate-700">
              The treating doctor and the Medical Director must both sign with a fingerprint. The grant lasts 72 hours, excludes sensitive data, and the patient is notified at
              once.
            </p>
            <p className="text-slate-700">Signed so far: {r.breakGlassSigners.map((id) => s.staffById(id)?.name).join(", ") || "nobody"}</p>
            {releaseError && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-medium text-rose-700">{releaseError}</p>
                <Button variant="secondary" onClick={() => sign()}>
                  Retry emergency release
                </Button>
              </div>
            )}
            {canSign ? (
              <Button variant="danger" onClick={() => sign()}>
                Sign break-glass as {st.name} (fingerprint)
              </Button>
            ) : releaseError ? null : (
              <p className="text-xs text-slate-500">Switch to Dr. Amaka Obi or Dr. Tunde Adeyemi and to Dr. Ngozi Eze (Medical Director) to sign.</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function RecordView({ patientId, staffId }: { patientId: string; staffId: string }) {
  const s = useSehat();
  const st = s.staffById(staffId)!;
  const con = s.activeConnection(patientId, st.hospitalId)!;
  const [items, setItems] = useState<Readable[]>([]);
  const [proposing, setProposing] = useState<{ amends?: Readable } | null>(null);
  const entries = s.server!.entries;
  const writable = con.categories.filter((c) => roleAllows(st, c));

  useEffect(() => {
    let live = true;
    s.readAsStaff(patientId, staffId).then((r) => live && setItems(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, staffId, con.id, entries]);

  const myOpen = s.server!.proposals.filter((p) => p.patientId === patientId && p.hospitalId === st.hospitalId && p.status === "open").length;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          Health record
          <Badge tone={con.level === "emergency" ? "rose" : con.level === "full" ? "teal" : "sky"}>
            {con.level === "emergency" ? "Emergency access" : con.level === "full" ? "Full access" : "Scoped grant"}
          </Badge>
          {con.expiresAt && <span className="text-xs font-normal text-slate-500">until {fmt(con.expiresAt)}</span>}
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          {myOpen > 0 && <Badge tone="amber">{myOpen} proposal(s) awaiting review</Badge>}
          <Button onClick={() => setProposing({})}>Propose entry</Button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Decrypted in this browser with {s.hospital(st.hospitalId)?.name}&apos;s private key. Granted categories: {con.categories.map(categoryLabel).join(", ")}.
      </p>
      <div className="space-y-3">
        {items.length === 0 ? (
          <Empty>No entries yet.</Empty>
        ) : (
          [...items].reverse().map((it) => (
            <EntryCard
              key={it.entry.id}
              item={it}
              actions={
                it.state === "open" && it.entry.status === "current" && writable.includes(it.entry.category) ? (
                  <button className="text-xs font-medium text-teal-700 hover:underline" onClick={() => setProposing({ amends: it })}>
                    Propose amendment
                  </button>
                ) : null
              }
            />
          ))
        )}
      </div>
      {proposing && <ProposeDialog patientId={patientId} staffId={staffId} categories={writable} amends={proposing.amends} onClose={() => setProposing(null)} />}
    </Card>
  );
}
