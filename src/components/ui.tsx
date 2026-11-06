"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  // Poster-style: hard outline and a hard offset shadow that the button "presses" into.
  const press = "shadow-[3px_3px_0_0_#0a0a0a] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0";
  const styles = {
    primary: cx("border-2 border-ink bg-ink text-white hover:bg-white hover:text-ink disabled:border-slate-300 disabled:bg-slate-300 disabled:text-white", press),
    secondary: cx("border-2 border-ink bg-white text-ink hover:bg-ink hover:text-white disabled:opacity-40", press),
    danger: cx("border-2 border-ink bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40", press),
    ghost: "border-2 border-transparent text-ink underline-offset-4 hover:underline disabled:opacity-40",
  }[variant];
  return (
    <button
      className={cx("inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-bold transition-[background-color,color,transform,box-shadow] duration-100 disabled:cursor-not-allowed", styles, className)}
      {...props}
    />
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("border-2 border-ink bg-white", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b-2 border-ink px-5 py-3.5">
          <h2 className="font-display text-base font-extrabold leading-tight text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

// Monochrome tags: solid, outlined or dashed tell them apart; rose (red) stays for danger.
const badgeTones = {
  slate: "border-slate-300 bg-slate-100 text-slate-700",
  teal: "border-ink bg-ink text-white",
  amber: "border-ink border-dashed bg-white text-ink",
  rose: "border-rose-700 bg-rose-50 text-rose-700",
  violet: "border-ink bg-white text-ink",
  sky: "border-ink bg-slate-100 text-ink",
};

export function Badge({ tone = "slate", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={cx("inline-flex items-center border px-2 py-0.5 text-xs font-bold tracking-wide", badgeTones[tone])}>{children}</span>;
}

// `group` for a set of buttons or checkboxes: a <label> around them would name (and click) the first one.
export function Field({ label, hint, group, children }: { label: string; hint?: string; group?: boolean; children: ReactNode }) {
  if (group)
    return (
      <fieldset className="block">
        <legend className="mb-1 block text-xs font-bold text-ink">{label}</legend>
        {children}
        {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      </fieldset>
    );
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full border-2 border-ink bg-white px-3 py-2 text-sm font-medium text-ink placeholder:text-slate-400 focus:outline-none focus:shadow-[3px_3px_0_0_#0a0a0a] disabled:border-slate-300 disabled:bg-slate-50";

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-lg border-2 border-ink bg-white shadow-[8px_8px_0_0_#0a0a0a]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <header className="flex items-center justify-between bg-ink px-5 py-3.5">
          <h2 className="font-display text-base font-extrabold leading-tight text-white">{title}</h2>
          <button onClick={onClose} className="px-1.5 text-lg font-bold text-white hover:bg-white hover:text-ink" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border-2 border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function fmt(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-NG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ago(ts?: number) {
  if (!ts) return "never";
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
