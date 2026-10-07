"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLive } from "@/components/live/LiveSession";
import { Button, Card, Field, inputCls } from "@/components/ui";
import { ApiError, login } from "@/lib/live/api";

export default function LiveLogin() {
  const { me, signIn } = useLive();
  const router = useRouter();
  const [kind, setKind] = useState<"staff" | "citizen">("staff");
  const [ident, setIdent] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) router.replace(me.actor_type === "staff" ? "/live/hospital" : "/live/citizen");
  }, [me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body: Record<string, string> =
        kind === "staff" ? { username: ident.trim(), password, totp_code: code } : { nin: ident.trim(), password, totp_code: code };
      await signIn(await login(kind, body));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the SehatLog API.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card title="Sign in">
        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {(["staff", "citizen"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-md py-1.5 text-sm ${kind === k ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              {k === "staff" ? "Hospital staff" : "Citizen"}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Field label={kind === "staff" ? "Username" : "NIN"}>
            <input className={inputCls} value={ident} onChange={(e) => setIdent(e.target.value)} autoComplete="username" placeholder={kind === "staff" ? "amaka.obi" : "11-digit NIN"} />
          </Field>
          <Field label="Password">
            <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Authenticator code">
            <input inputMode="numeric" maxLength={6} className={`${inputCls} font-mono tracking-widest`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          </Field>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !ident || !password || code.length !== 6}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="text-xs text-slate-500">
        Development: run the API and <code>go run ./cmd/devseed codes</code> in SehatLog-Backend for demo accounts and current codes. Password: <code>sehatlog-dev-pass</code>.
        The clickable prototype (no backend) is at{" "}
        <Link className="text-teal-700 underline" href="/">
          /
        </Link>
        .
      </p>
    </div>
  );
}
