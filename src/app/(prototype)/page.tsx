"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { homeFor } from "@/components/AppShell";
import { Card } from "@/components/ui";
import { useSehat } from "@/lib/store";
import type { Persona } from "@/lib/types";

const scenarios: { title: string; steps: string[] }[] = [
  {
    title: "1. Routine visit at a new hospital",
    steps: [
      "Viewing as Dr. Amaka Obi (Ikeja General): look up NIN 23456789012 and request access, patient able to consent.",
      "Switch to Aisha Bello: approve the request, pick the access level, confirm with password + 2FA.",
      "Back as Dr. Amaka: the full record now decrypts in your browser. Propose a new entry.",
      "Switch to Dr. Tunde Adeyemi: review the diff in the review queue and merge it.",
    ],
  },
  {
    title: "2. Road accident, unconscious patient",
    steps: [
      "As Ibrahim Musa (Paramedic): scan Aisha's fingerprint and see the Basic Emergency Profile.",
      "Request access with “Patient unable to consent”. The request goes to her next of kin, Musa Bello.",
      "Switch to Musa Bello and approve, or press “Simulate 30 minutes” to escalate to family (Fatima Bello).",
      "If nobody answers, Dr. Amaka and Dr. Ngozi Eze (Medical Director) sign break-glass together.",
    ],
  },
  {
    title: "3. A child patient",
    steps: [
      "As Dr. Amaka, look up Zainab Bello (NIN 56789012345, age 7).",
      "The request goes to her parents, never to the child. Approve as Aisha or Musa.",
    ],
  },
  {
    title: "4. Zero-knowledge storage",
    steps: [
      "Switch to Platform Admin: every record is ciphertext. SehatLog holds no key that can open it.",
      "Emergency keys need SehatLog + a regulator + an independent body. Switch both regulators offline, then try the paramedic flow: the release is refused.",
      "As Aisha, remove a hospital: its keys are rotated, and it keeps read access only to its own entries.",
    ],
  },
];

export default function Home() {
  const s = useSehat();
  const router = useRouter();
  const go = (p: Persona) => {
    s.setPersona(p);
    router.push(homeFor(p));
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-teal-800 to-teal-950 px-6 py-8 text-white">
        <h1 className="text-2xl font-semibold sm:text-3xl">One lifelong health record per citizen</h1>
        <p className="mt-2 max-w-2xl text-teal-100">
          Found by NIN or fingerprint, opened only with the patient&apos;s consent, and encrypted end to end. In this prototype the encryption is real: keys are generated in
          your browser and the “server” only ever stores ciphertext.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={() => go({ kind: "citizen", id: "c-aisha" })} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-teal-900 hover:bg-teal-50">
            Open as patient (Aisha)
          </button>
          <button onClick={() => go({ kind: "staff", id: "s-amaka" })} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium ring-1 ring-teal-500 hover:bg-teal-600">
            Open as doctor (Dr. Amaka)
          </button>
          <button onClick={() => go({ kind: "admin" })} className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-teal-500 hover:bg-teal-700">
            Open as SehatLog admin
          </button>
          <Link href="/live" className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-300">
            Live app (real API) →
          </Link>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {scenarios.map((sc) => (
          <Card key={sc.title} title={sc.title}>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              {sc.steps.map((st) => (
                <li key={st}>{st}</li>
              ))}
            </ol>
          </Card>
        ))}
      </div>
      <p className="text-xs text-slate-500">All people, hospitals and records are fictional. Demo password for every citizen: sehat123. Use “Viewing as” at the top to switch roles.</p>
    </div>
  );
}
