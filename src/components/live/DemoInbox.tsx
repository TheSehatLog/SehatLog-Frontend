"use client";

import { useEffect, useState } from "react";

// Hosted demo only (NEXT_PUBLIC_DEMO_INBOX=1): visitors have no authenticator app for the
// fictional accounts, so this shows the demo accounts and the latest one-time codes "sent"
// by SMS or email (the API's dev outbox). Never enabled for real users.
export const demoInboxEnabled = process.env.NEXT_PUBLIC_DEMO_INBOX === "1";

type Msg = { id: number; channel: string; recipient: string; body: string; created_at: string };

const ACCOUNTS: [string, string][] = [
  ["amaka.obi", "Doctor, Ikeja General (staff)"],
  ["tunde.adeyemi", "Consultant, Ikeja General (staff)"],
  ["ifeoma.okafor", "Pharmacist, Opebi Pharmacy (staff)"],
  ["34567890123", "Musa Bello, the patient (citizen NIN)"],
  ["23456789012", "Aisha Bello, his next of kin (citizen NIN)"],
];

export function DemoInbox() {
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const tick = () =>
      fetch("/api/v1/dev/outbox")
        .then((r) => r.json())
        .then((d: { messages: Msg[] }) => live && setMsgs(d.messages.filter((m) => /\d{6}/.test(m.body)).slice(0, 4)))
        .catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open]);

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-50 border-2 border-ink bg-ink px-3 py-2 text-sm font-bold text-white shadow-[3px_3px_0_0_#616161]">
        Demo inbox
      </button>
    );

  return (
    <aside className="fixed bottom-4 left-4 z-50 w-[min(92vw,330px)] border-2 border-ink bg-white text-sm shadow-[6px_6px_0_0_#0a0a0a]" aria-label="Demo inbox">
      <header className="flex items-center justify-between bg-ink px-3 py-2 text-white">
        <span className="font-display text-xs font-extrabold uppercase tracking-wider">Demo inbox</span>
        <button onClick={() => setOpen(false)} className="px-1 font-bold hover:bg-white hover:text-ink" aria-label="Hide demo inbox">
          –
        </button>
      </header>
      <div className="space-y-2 p-3">
        <p className="text-xs text-slate-600">
          Fictional accounts. Password <code className="font-bold text-ink">sehatlog-dev-pass</code>. For the code, choose <b>SMS</b> or <b>Email</b>, click send, and it appears here.
        </p>
        <ul className="space-y-0.5 text-xs">
          {ACCOUNTS.map(([id, who]) => (
            <li key={id}>
              <code className="font-bold text-ink">{id}</code> <span className="text-slate-600">· {who}</span>
            </li>
          ))}
        </ul>
        <div className="border-t-2 border-ink pt-2">
          {msgs.length === 0 ? (
            <p className="text-xs text-slate-500">No codes sent yet.</p>
          ) : (
            <ul className="space-y-1">
              {msgs.map((m) => (
                <li key={m.id} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-slate-600">{m.recipient}</span>
                  <span className="font-mono text-base font-bold tracking-widest text-ink">{m.body.match(/\d{6}/)?.[0]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
