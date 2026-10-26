"use client";

import { useEffect, useState } from "react";
import { Button, inputCls } from "@/components/ui";
import { api } from "@/lib/live/api";

type SimPerson = { nin: string; full_name: string; template: string };

/**
 * The facility fingerprint scanner. Calls onScan with a template (base64) that the API
 * hands to the national identity register; SehatLog never stores it.
 *
 * Development: the API's simulated register (DEV_SIMULATORS=1) plays the scanner, and
 * you pick whose finger is on it. Production: a vendor SDK bridge (USB scanner) replaces
 * this component behind the same onScan.
 */
export function FingerprintScanner({ onScan, label = "Scan fingerprint", disabled }: { onScan: (template: string) => void; label?: string; disabled?: boolean }) {
  const [people, setPeople] = useState<SimPerson[] | null>(null);
  const [who, setWho] = useState("");

  useEffect(() => {
    api<{ people: SimPerson[] }>("/v1/dev/fingerprints")
      .then((r) => setPeople(r.people))
      .catch(() => setPeople([]));
  }, []);

  if (people === null) return <span className="text-sm text-slate-500">Connecting to scanner…</span>;
  if (people.length === 0) return <span className="text-sm text-amber-800">No fingerprint scanner connected to this workstation.</span>;

  async function scan() {
    // A fresh capture each time, like a real scanner.
    const r = await api<{ people: SimPerson[] }>("/v1/dev/fingerprints");
    const p = r.people.find((x) => x.nin === who);
    if (p) onScan(p.template);
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select className={`${inputCls} w-auto`} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Simulated finger on the scanner">
        <option value="">Finger on scanner (simulated)…</option>
        {people.map((p) => (
          <option key={p.nin} value={p.nin}>
            {p.full_name}
          </option>
        ))}
      </select>
      <Button variant="secondary" onClick={scan} disabled={!who || disabled}>
        {label}
      </Button>
    </span>
  );
}
