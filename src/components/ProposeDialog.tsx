"use client";

import { useState } from "react";
import { useSehat, type Readable } from "@/lib/store";
import type { Category, EntryPayload, InputMethod } from "@/lib/types";
import { categoryLabel } from "./EntryCard";
import { Button, Field, inputCls, Modal } from "./ui";

const KINDS: EntryPayload["kind"][] = ["Note", "Diagnosis", "Allergy", "Prescription", "Lab result", "Vitals", "Immunisation"];

const toText = (f: Record<string, string>) =>
  Object.entries(f)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

const fromText = (t: string) =>
  Object.fromEntries(
    t
      .split("\n")
      .map((l) => l.split(":"))
      .filter((p) => p.length >= 2 && p[0].trim())
      .map(([k, ...v]) => [k.trim(), v.join(":").trim()]),
  );

// Simulated detection sources: a bedside monitor feed and OCR of a scanned lab report.
const DETECTED: Record<Exclude<InputMethod, "Typed">, { category: Category; payload: EntryPayload }> = {
  "Detected (device)": {
    category: "clinical",
    payload: {
      kind: "Vitals",
      title: "Vital signs from bedside monitor",
      details: "Captured automatically from monitor BM-07, A&E bay 3. Confirmed by the author.",
      fields: { BP: "138/86 mmHg", Pulse: "104 bpm", SpO2: "95%", Temp: "37.9 °C", "Resp. rate": "22 /min" },
    },
  },
  "Detected (OCR)": {
    category: "labs",
    payload: {
      kind: "Lab result",
      title: "Malaria parasite test (scanned report)",
      details: "Extracted by OCR from a paper report. Low-confidence fields highlighted for checking.",
      fields: { Result: "Positive, P. falciparum", Density: "2+ (check)", Method: "Microscopy" },
    },
  },
};

export function ProposeDialog({
  patientId,
  staffId,
  categories,
  amends,
  onClose,
}: {
  patientId: string;
  staffId: string;
  categories: Category[];
  amends?: Readable;
  onClose: () => void;
}) {
  const s = useSehat();
  const base = amends?.state === "open" ? amends.payload : undefined;
  const [method, setMethod] = useState<InputMethod>("Typed");
  const [category, setCategory] = useState<Category>(amends?.entry.category ?? (categories.includes("clinical") ? "clinical" : categories[0]));
  const [kind, setKind] = useState<EntryPayload["kind"]>(base?.kind ?? "Note");
  const [title, setTitle] = useState(base?.title ?? "");
  const [details, setDetails] = useState(base?.details ?? "");
  const [fields, setFields] = useState(base ? toText(base.fields) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function detect(m: InputMethod) {
    setMethod(m);
    if (m === "Typed") return;
    const d = DETECTED[m];
    if (!categories.includes(d.category)) return setErr(`Your access does not include ${categoryLabel(d.category)}.`);
    setErr("");
    setCategory(d.category);
    setKind(d.payload.kind);
    setTitle(d.payload.title);
    setDetails(d.payload.details);
    setFields(toText(d.payload.fields));
  }

  async function submit() {
    setBusy(true);
    try {
      await s.propose({
        staffId,
        patientId,
        category,
        inputMethod: method,
        amendsEntryId: amends?.entry.id,
        payload: { kind, title, details, fields: fromText(fields) },
      });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open title={amends ? "Propose an amendment" : "Propose a new entry"} onClose={onClose}>
      <div className="space-y-3">
        {!amends && (
          <Field group label="Input method">
            <div className="flex flex-wrap gap-2">
              {(["Typed", "Detected (device)", "Detected (OCR)"] as InputMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => detect(m)}
                  className={`rounded-full border px-3 py-1 text-sm ${method === m ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-300"}`}
                >
                  {m === "Typed" ? "Type it" : m === "Detected (device)" ? "Read from monitor" : "Scan paper report"}
                </button>
              ))}
            </div>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as Category)} disabled={!!amends}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Entry type">
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as EntryPayload["kind"])}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Title">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Suspected appendicitis" />
        </Field>
        <Field label="Details">
          <textarea className={inputCls} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <Field label="Coded fields" hint="One per line, as Name: value">
          <textarea className={`${inputCls} font-mono text-xs`} rows={4} value={fields} onChange={(e) => setFields(e.target.value)} placeholder={"ICD-11: DB10.0\nSeverity: Moderate"} />
        </Field>
        {method !== "Typed" && <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">Detected data must be checked and confirmed by you before it is proposed.</p>}
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <p className="text-xs text-slate-500">
          The entry is encrypted in this browser before it is sent. A reviewer at your hospital must merge it before it joins the record.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title}>
            {busy ? "Encrypting…" : method === "Typed" ? "Submit proposal" : "Confirm and submit"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
