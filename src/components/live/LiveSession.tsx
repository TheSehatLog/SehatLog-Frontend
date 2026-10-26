"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { NotificationBell } from "./NotificationBell";
import { api, ApiError, loadSession, saveSession, toB64, type Me, type Session } from "@/lib/live/api";
import { ensureDeviceKey } from "@/lib/live/keystore";
import { x25519PublicKey } from "@/lib/sehatcrypto";

/** Registers this browser's device key, so text about the citizen's records can be sealed to it. */
async function registerDeviceKey(s: Session, me: Me) {
  if (me.actor_type !== "citizen") return;
  const k = ensureDeviceKey(me.id);
  await api("/v1/me/device-key", { method: "PUT", token: s.token, body: { key_id: k.keyId, public_key: toB64(await x25519PublicKey(k.priv)) } }).catch(() => {
    // Not fatal: sealed text just won't include this browser until the next sign-in.
  });
}

type Live = {
  session: Session | null;
  me: Me | null;
  call: <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;
  /** Raw authenticated fetch (file bytes). */
  raw: (path: string, init?: RequestInit) => Promise<Response>;
  signIn: (s: Session) => Promise<void>;
  signOut: () => void;
  refreshMe: () => Promise<void>;
};

const Ctx = createContext<Live | null>(null);

export function useLive() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLive outside LiveSession");
  return v;
}

export function LiveSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(() => {
    saveSession(null);
    setSession(null);
    setMe(null);
    router.push("/live");
  }, [router]);

  const fetchMe = useCallback(
    async (s: Session) => {
      try {
        const m = await api<Me>("/v1/me", { token: s.token });
        await registerDeviceKey(s, m);
        setMe(m);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) signOut();
        else throw e;
      }
    },
    [signOut],
  );

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      queueMicrotask(() => setReady(true));
      return;
    }
    api<Me>("/v1/me", { token: s.token })
      .then(async (m) => {
        await registerDeviceKey(s, m);
        setMe(m);
        setSession(s);
      })
      .catch(() => saveSession(null))
      .finally(() => setReady(true));
  }, []);

  // Sign out when the 15-minute token expires.
  useEffect(() => {
    if (!session) return;
    const t = setTimeout(signOut, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [session, signOut]);

  const call = useCallback(
    async <T,>(path: string, opts: { method?: string; body?: unknown } = {}) => {
      try {
        return await api<T>(path, { ...opts, token: session?.token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401 && !path.includes("/approve") && !path.includes("/remove") && !path.includes("signing-key")) signOut();
        throw e;
      }
    },
    [session, signOut],
  );

  const raw = useCallback(
    (path: string, init: RequestInit = {}) =>
      fetch(`/api${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(session ? { Authorization: `Bearer ${session.token}` } : {}) } }),
    [session],
  );

  const signIn = useCallback(
    async (s: Session) => {
      await fetchMe(s);
      setSession(s);
    },
    [fetchMe],
  );

  const refreshMe = useCallback(async () => {
    if (session) await fetchMe(session);
  }, [session, fetchMe]);

  if (!ready) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;

  return (
    <Ctx.Provider value={{ session, me, call, raw, signIn, signOut, refreshMe }}>
      <LiveShell>{children}</LiveShell>
    </Ctx.Provider>
  );
}

function LiveShell({ children }: { children: ReactNode }) {
  const { me, signOut } = useLive();
  const path = usePathname();
  const nav =
    me?.actor_type === "staff"
      ? me.role === "Records Officer"
        ? [
            { href: "/live/hospital/desk", label: "Records desk" },
            { href: "/live/hospital", label: "Patients" },
          ]
        : [
            { href: "/live/hospital", label: "Patients" },
            { href: "/live/hospital/review", label: "Review queue" },
            { href: "/live/settings", label: "Keys" },
          ]
      : me
        ? [{ href: "/live/citizen", label: "My SehatLog" }]
        : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/live" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-700 text-xs font-bold text-white">SL</span>
            SehatLog
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Live API</span>
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
          {me && (
            <div className="ml-auto flex items-center gap-3 text-sm">
              <NotificationBell />
              <span className="text-slate-600">
                {me.actor_type === "staff" ? `${me.full_name} · ${me.role} · ${me.facility.name}` : `Citizen · record ${me.record_id}`}
              </span>
              <button onClick={signOut} className="rounded-md px-2 py-1.5 text-slate-500 hover:bg-slate-100">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
