"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLive } from "@/components/live/LiveSession";
import { Button, Card, Field, inputCls } from "@/components/ui";
import { SecondFactor, factorBody, type Factor } from "@/components/live/SecondFactor";
import { api, ApiError, login } from "@/lib/live/api";

export default function LiveLogin() {
  const { me, signIn } = useLive();
  const router = useRouter();
  const [kind, setKind] = useState<"staff" | "citizen">("staff");
  const [ident, setIdent] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState<Factor>("totp");
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
      const who: Record<string, string> = kind === "staff" ? { username: ident.trim() } : { nin: ident.trim() };
      const body: Record<string, string> = { ...who, password, ...factorBody(factor, code) };
      await signIn(await login(kind, body));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the SehatLog API.");
      setBusy(false);
    }
  }

  const band = "PATIENT-OWNED • END-TO-END ENCRYPTED • KEYED TO NIN • NEXT OF KIN CONSENT • NDPA 2023 • ";
  return (
    <div className="space-y-8">
      {/* Poster hero: sunburst rays rising from the horizon, heavy capitals. */}
      <section
        className="relative -mx-4 -mt-6 overflow-hidden border-b-4 border-ink bg-ink px-4 pb-24 pt-16 text-center text-white"
        style={{ backgroundImage: "repeating-conic-gradient(from -90deg at 50% 110%, rgba(255,255,255,0.14) 0deg 0.8deg, transparent 0.8deg 7deg)" }}
      >
        <div aria-hidden className="sl-sun absolute bottom-[-72%] left-1/2 h-[90%] w-[min(900px,140%)] -translate-x-1/2 border-4 border-white bg-ink" />
        <div className="relative">
          <h1 className="font-display text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[0.95] tracking-tight">
            Your record.
            <br />
            Your consent.
          </h1>
          <p className="mt-5 text-lg font-semibold sm:text-2xl">One health record for every Nigerian, keyed to NIN and fingerprint.</p>
        </div>
      </section>
      <div aria-hidden className="-mx-4 -mt-8 overflow-hidden border-b-4 border-ink bg-white py-2">
        <div className="sl-marquee flex w-max whitespace-nowrap font-display text-2xl font-black text-ink">
          <span>{band.repeat(3)}</span>
          <span>{band.repeat(3)}</span>
        </div>
      </div>
      <div className="mx-auto max-w-md space-y-4">
      <Card title="Sign in" className="shadow-[8px_8px_0_0_#0a0a0a]">
        <div className="mb-4 grid grid-cols-2 border-2 border-ink">
          {(["staff", "citizen"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`py-2 text-sm font-bold ${kind === k ? "bg-ink text-white" : "bg-white text-ink hover:bg-slate-100"}`}
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
          <SecondFactor
            factor={factor}
            setFactor={setFactor}
            code={code}
            setCode={setCode}
            send={async (channel) => {
              if (!ident.trim()) throw new ApiError(400, kind === "staff" ? "Enter your username first." : "Enter your NIN first.");
              await api("/v1/auth/otp", {
                method: "POST",
                body: { account_type: kind, channel, ...(kind === "staff" ? { username: ident.trim() } : { nin: ident.trim() }) },
              });
            }}
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !ident || !password || code.length !== 6}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="text-xs text-slate-500">
        Development: run the API and <code>go run ./cmd/devseed codes</code> in SehatLog-Backend for demo accounts and current codes. Password: <code>sehatlog-dev-pass</code>. SMS/email codes appear at <code>/api/v1/dev/outbox</code> when the API runs with <code>DEV_OUTBOX=1</code>.
        The clickable prototype (no backend) is at{" "}
        <Link className="font-bold text-ink underline" href="/">
          /
        </Link>
        .
      </p>
      </div>
    </div>
  );
}
