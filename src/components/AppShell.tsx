"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useSehat } from "@/lib/store";
import type { Persona } from "@/lib/types";
import { cx } from "./ui";

function personaKey(p: Persona) {
  return p.kind === "admin" ? "admin" : `${p.kind}:${p.id}`;
}

export function homeFor(p: Persona) {
  return p.kind === "citizen" ? "/citizen" : p.kind === "staff" ? "/hospital" : "/admin";
}

export function AppShell({ children }: { children: ReactNode }) {
  const s = useSehat();
  const router = useRouter();
  const path = usePathname();

  if (!s.ready || !s.server) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Generating encryption keys for the demo…
      </div>
    );
  }

  const nav =
    s.persona.kind === "citizen"
      ? [{ href: "/citizen", label: "My SehatLog" }]
      : s.persona.kind === "staff"
        ? [
            { href: "/hospital", label: "Patient lookup" },
            { href: "/hospital/review", label: "Review queue" },
          ]
        : [{ href: "/admin", label: "Admin (server view)" }];

  function choose(value: string) {
    const [kind, id] = value.split(":");
    const p: Persona = kind === "admin" ? { kind: "admin" } : { kind: kind as "citizen" | "staff", id };
    s.setPersona(p);
    router.push(homeFor(p));
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-700 text-xs font-bold text-white">SL</span>
            SehatLog
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">Prototype</span>
          </Link>
          <nav className="flex gap-1">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cx("rounded-md px-3 py-1.5 text-sm", path === n.href ? "bg-teal-50 font-medium text-teal-800" : "text-slate-600 hover:bg-slate-100")}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="persona" className="text-xs text-slate-500">
              Viewing as
            </label>
            <select
              id="persona"
              value={personaKey(s.persona)}
              onChange={(e) => choose(e.target.value)}
              className="max-w-[16rem] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              <optgroup label="Citizens">
                {s.server.citizens
                  .filter((c) => c.guardianIds.length === 0)
                  .map((c) => (
                    <option key={c.id} value={`citizen:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Hospital staff">
                {s.server.staff.map((st) => (
                  <option key={st.id} value={`staff:${st.id}`}>
                    {st.name}: {st.role}, {s.hospital(st.hospitalId)!.name.split(" ").slice(0, 2).join(" ")}
                  </option>
                ))}
              </optgroup>
              <optgroup label="SehatLog">
                <option value="admin">Platform Admin</option>
              </optgroup>
            </select>
            <button onClick={() => s.reset()} className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100" title="Reset all demo data">
              Reset
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
