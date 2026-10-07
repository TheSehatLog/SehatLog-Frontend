"use client";

import type { ReactNode } from "react";
import { useSehat, type Readable } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/types";
import { Badge, fmt } from "./ui";

export const categoryTone: Record<Category, "rose" | "teal" | "sky" | "violet" | "amber"> = {
  basic: "rose",
  clinical: "teal",
  medications: "sky",
  labs: "violet",
  sensitive: "amber",
};

export function categoryLabel(c: Category) {
  return CATEGORIES.find((x) => x.id === c)!.label;
}

export function EntryCard({ item, actions }: { item: Readable; actions?: ReactNode }) {
  const s = useSehat();
  const e = item.entry;
  const author = s.staffById(e.authorStaffId);
  const reviewer = s.staffById(e.reviewerStaffId);
  const hosp = s.hospital(e.hospitalId);

  return (
    <article className={`rounded-lg border p-4 ${e.status === "superseded" ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={categoryTone[e.category]}>{categoryLabel(e.category)}</Badge>
        {item.state === "open" && <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{item.payload.kind}</span>}
        <span className="text-xs text-slate-400">v{e.version}</span>
        {e.status === "superseded" && <Badge>Superseded</Badge>}
        {item.state === "open" && item.via === "own entry" && <Badge tone="amber">Your hospital&apos;s entry</Badge>}
        <div className="ml-auto">{actions}</div>
      </div>

      {item.state === "open" ? (
        <>
          <h3 className={`mt-2 font-semibold text-slate-900 ${e.status === "superseded" ? "line-through" : ""}`}>{item.payload.title}</h3>
          {item.payload.details && <p className="mt-1 text-sm text-slate-700">{item.payload.details}</p>}
          {Object.keys(item.payload.fields).length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              {Object.entries(item.payload.fields).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : item.state === "restricted" ? (
        <p className="mt-2 text-sm text-slate-600">🔒 Restricted entry exists. Your role cannot open this category.</p>
      ) : (
        <p className="mt-2 text-sm text-slate-600">🔒 Not shared with your hospital. You hold no key for this entry.</p>
      )}

      <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
        {author?.name} ({author?.role}, {author?.licence}) · {hosp?.name} · HFR {hosp?.hfrId} · {e.inputMethod} · written {fmt(e.createdAt)} · merged by{" "}
        {reviewer?.name} {fmt(e.mergedAt)}
      </p>
    </article>
  );
}
