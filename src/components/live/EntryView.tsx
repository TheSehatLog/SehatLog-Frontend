"use client";

import type { ReactNode } from "react";
import { Badge, fmt } from "@/components/ui";
import type { Envelope } from "@/lib/live/api";
import { CATEGORY_LABEL } from "@/lib/live/keystore";
import type { Payload } from "@/lib/live/records";

const tone: Record<string, "rose" | "teal" | "sky" | "violet" | "amber" | "slate"> = {
  basic: "rose",
  clinical: "teal",
  medications: "sky",
  labs: "violet",
  imaging: "slate",
  sensitive: "amber",
};

export function EntryView({
  env,
  payload,
  version,
  status,
  badge,
  actions,
  footer,
}: {
  env: Envelope;
  payload: Payload | null;
  version?: number;
  status?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const superseded = status === "superseded";
  return (
    <article className={`rounded-lg border p-4 ${superseded ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone[env.category] ?? "slate"}>{CATEGORY_LABEL[env.category] ?? env.category}</Badge>
        {payload && <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{payload.kind}</span>}
        {version !== undefined && <span className="text-xs text-slate-400">v{version}</span>}
        {superseded && <Badge>Superseded</Badge>}
        {env.amends_entry_id && <Badge tone="amber">Amends {env.amends_entry_id}</Badge>}
        {badge}
        <div className="ml-auto">{actions}</div>
      </div>
      {payload ? (
        <>
          <h3 className={`mt-2 font-semibold text-slate-900 ${superseded ? "line-through" : ""}`}>{payload.title}</h3>
          {payload.details && <p className="mt-1 text-sm text-slate-700">{payload.details}</p>}
          {payload.fields && Object.keys(payload.fields).length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              {Object.entries(payload.fields).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-600">🔒 Can&apos;t be decrypted on this device: no key for this category here.</p>
      )}
      <p className="mt-3 border-t border-slate-100 pt-2 font-mono text-[11px] text-slate-500">
        {env.entry_id} · by {env.author_staff_id} at {env.facility_id} · {env.input_method} · written {fmt(Date.parse(env.created_at))}
      </p>
      {footer}
    </article>
  );
}
