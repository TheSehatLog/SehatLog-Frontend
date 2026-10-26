"use client";

import { useState, type ReactNode } from "react";
import { Badge, fmt } from "@/components/ui";
import type { Attachment, Entry, Envelope, Proposal } from "@/lib/live/api";
import { saveAttachment } from "@/lib/live/files";
import { useLive } from "./LiveSession";
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
  env: Envelope | Entry | Proposal;
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
        {"review_status" in env && env.review_status === "pending_review" && <Badge tone="rose">Emergency · pending review</Badge>}
        {"fast_tracked" in env && env.fast_tracked && env.review_status === "reviewed" && <Badge tone="slate">Emergency · reviewed</Badge>}
        {"fast_track" in env && env.fast_track && <Badge tone="rose">Emergency fast-track</Badge>}
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
          {payload.attachments && payload.attachments.length > 0 && <Attachments env={env} list={payload.attachments} />}
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

// Encrypted attachments: downloaded as ciphertext, decrypted here with the key from the entry.
function Attachments({ env, list }: { env: Envelope; list: Attachment[] }) {
  const { raw } = useLive();
  const [error, setError] = useState("");
  return (
    <div className="mt-3 space-y-1">
      {list.map((a) => (
        <div key={a.file_id} className="flex items-center gap-2 text-sm">
          <span>📎</span>
          <span className="text-slate-800">{a.name}</span>
          <span className="text-xs text-slate-500">{(a.size / 1024).toFixed(0)} KB</span>
          <button
            className="text-xs font-medium text-teal-700 hover:underline"
            onClick={() => saveAttachment(raw, env.record_id, env.category, a).catch((e: Error) => setError(e.message))}
          >
            Download
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
