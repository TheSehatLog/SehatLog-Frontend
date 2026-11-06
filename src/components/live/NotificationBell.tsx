"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { fmt } from "@/components/ui";
import type { Notification } from "@/lib/live/api";
import { notificationHref } from "@/lib/live/routes";
import { useLive } from "./LiveSession";

// In-app notifications, refreshed every 30 seconds.
export function NotificationBell() {
  const { call, me } = useLive();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => call<{ notifications: Notification[]; unread: number }>("/v1/me/notifications"), [call]);

  useEffect(() => {
    let live = true;
    const tick = () =>
      load()
        .then((r) => {
          if (!live) return;
          setItems(r.notifications);
          setUnread(r.unread);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function markRead(n: Notification) {
    if (n.read_at) return;
    await call(`/v1/notifications/${n.notification_id}/read`, { method: "POST" }).catch(() => {});
    setItems((list) => list.map((x) => (x.notification_id === n.notification_id ? { ...x, read_at: new Date().toISOString() } : x)));
    setUnread((u) => Math.max(0, u - 1));
  }

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md px-2 py-1.5 text-slate-600 hover:bg-slate-100" aria-label={`Notifications (${unread} unread)`}>
        🔔
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[min(92vw,380px)] overflow-y-auto border-2 border-ink bg-white shadow-lg">
          <p className="bg-ink px-4 py-2 font-display text-sm font-extrabold uppercase text-white">Notifications</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((n) => (
                <li key={n.notification_id}>
                  <button
                    onClick={() => {
                      markRead(n);
                      setOpen(false);
                      if (me) router.push(notificationHref(n.kind, me.actor_type));
                    }}
                    className={`w-full px-4 py-3 text-left ${n.read_at ? "" : "bg-teal-50/60"}`}>
                    <p className="text-sm font-medium text-slate-900">
                      {n.urgent && <span className="mr-1 text-rose-600">●</span>}
                      {n.title}
                    </p>
                    <p className="text-xs text-slate-600">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{fmt(Date.parse(n.created_at))}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
