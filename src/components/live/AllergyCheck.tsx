"use client";

import type { AllergyAlert } from "@/lib/live/allergy";

// The result of checking a medicine against the patient's recorded allergies (decrypted
// on this device). `allergyCount` is null when this device can't open the Basic profile.
export function AllergyCheck({ medicine, alerts, allergyCount }: { medicine: string; alerts: AllergyAlert[]; allergyCount: number | null }) {
  if (!medicine.trim()) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {allergyCount === null ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Allergies not checked: this device can&apos;t open the patient&apos;s Basic Emergency Profile.</p>
      ) : alerts.length === 0 ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          ✓ Allergy check passed:{" "}
          {allergyCount === 0 ? "no allergies recorded." : `no conflict with ${allergyCount} recorded ${allergyCount === 1 ? "allergy" : "allergies"}.`}
        </p>
      ) : (
        alerts.map((a, i) => (
          <p key={i} className={`rounded-md border px-3 py-2 text-sm ${a.level === "stop" ? "border-rose-300 bg-rose-50 text-rose-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            <b>{a.level === "stop" ? "Stop: allergy conflict." : "Caution."}</b> {a.message} Recorded: “{a.allergy}”.
          </p>
        ))
      )}
      <p className="text-xs text-slate-500">Checks recorded allergies against common drug classes, in this browser. Use your clinical judgement.</p>
    </div>
  );
}
