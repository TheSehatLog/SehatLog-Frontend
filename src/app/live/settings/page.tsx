"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/components/live/LiveSession";
import {
  StepUpFields,
  useSendCode,
  useStepUp,
} from "@/components/live/SecondFactor";
import { Badge, Button, Card, Empty, inputCls } from "@/components/ui";
import * as sc from "@/lib/sehatcrypto";
import { ApiError, fromB64, fromHex, toB64, toHex } from "@/lib/live/api";
import {
  getFacilityKey,
  getSigningSeed,
  setFacilityKey,
  setSigningSeed,
} from "@/lib/live/keystore";

export default function KeySettings() {
  const { me, call, refreshMe } = useLive();
  const [facHex, setFacHex] = useState("");
  const [facMsg, setFacMsg] = useState("");
  const step = useStepUp();
  const sendCode = useSendCode();
  const [sigMsg, setSigMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  if (me?.actor_type !== "staff")
    return <Empty>Sign in as hospital staff to manage keys.</Empty>;
  const staff = me;
  const facilityKey = getFacilityKey(me.facility.facility_id);
  const seed = getSigningSeed(me.id);
  const registered = me.signing_public_key;

  async function saveFacility() {
    setFacMsg("");
    try {
      const priv = fromHex(facHex.trim());
      if (priv.length !== 32) throw new Error();
      const pub = await sc.x25519PublicKey(priv);
      if (toB64(pub) !== staff.facility.public_key)
        return setFacMsg(
          "That key does not match the public key registered for your facility.",
        );
      setFacilityKey(staff.facility.facility_id, priv);
      setFacHex("");
      force((n) => n + 1);
    } catch {
      setFacMsg("Paste the 64-character hex private key printed by devseed.");
    }
  }

  async function registerSigning() {
    setBusy(true);
    setSigMsg("");
    try {
      const newSeed = sc.randomBytes(32);
      const pub = await sc.ed25519PublicKey(newSeed);
      await call("/v1/me/signing-key", {
        method: "PUT",
        body: { public_key: toB64(pub), ...step.body },
      });
      setSigningSeed(staff.id, newSeed);

      await refreshMe();
    } catch (e) {
      setSigMsg(e instanceof ApiError ? e.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          Keys on this device
        </h1>
        <p className="text-sm text-slate-600">
          Your signing key lives on this device. Your hospital&apos;s private
          key never does: its key service opens keys for you.
        </p>
      </div>

      {me.facility.key_service_url ? (
        <KeyServiceStatus
          url={me.facility.key_service_url}
          facilityPublicKey={me.facility.public_key ?? ""}
          name={me.facility.name}
        />
      ) : (
        <Card
          title="Facility key (development fallback)"
          action={
            facilityKey ? (
              <Badge tone="teal">Loaded</Badge>
            ) : (
              <Badge tone="amber">Missing</Badge>
            )
          }
        >
          <p className="mb-3 text-sm text-slate-600">
            {me.facility.name} has no key service configured, so this browser
            needs the facility private key (devseed prints it as &quot;private
            key (dev only)&quot;). Never do this in production.
          </p>
          <div className="flex gap-2">
            <input
              className={`${inputCls} font-mono text-xs`}
              value={facHex}
              onChange={(e) => setFacHex(e.target.value)}
              placeholder="64 hex characters"
            />
            <Button
              onClick={saveFacility}
              disabled={facHex.trim().length !== 64}
            >
              Save
            </Button>
          </div>
          {facMsg && <p className="mt-2 text-sm text-rose-600">{facMsg}</p>}
          {facilityKey && (
            <p className="mt-2 font-mono text-xs text-slate-500">
              fingerprint {toHex(facilityKey).slice(0, 8)}…
            </p>
          )}
        </Card>
      )}

      <Card
        title="Your signing key"
        action={
          registered ? (
            <Badge tone="teal">Registered</Badge>
          ) : (
            <Badge tone="amber">Not registered</Badge>
          )
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Signs every proposal you submit
          {me.can_merge ? " and every merge you approve" : ""}. The API rejects
          anything not signed by your registered key.
        </p>
        {registered && <SeedStatus seed={seed} registered={registered} />}
        <div className="mt-3 grid max-w-md gap-3">
          <StepUpFields {...step.props} send={sendCode} />
          <div>
            <Button
              onClick={registerSigning}
              disabled={busy || !step.ready}
              className="w-full"
            >
              {registered ? "Replace key" : "Generate and register"}
            </Button>
          </div>
        </div>
        {sigMsg && <p className="mt-2 text-sm text-rose-600">{sigMsg}</p>}
        {registered && (
          <p className="mt-2 font-mono text-xs text-slate-500">
            registered key {toHex(fromB64(registered)).slice(0, 16)}…
          </p>
        )}
      </Card>
    </div>
  );
}

// The hospital key service: reachable, and holding the key the directory publishes.
function KeyServiceStatus({
  url,
  facilityPublicKey,
  name,
}: {
  url: string;
  facilityPublicKey: string;
  name: string;
}) {
  const [state, setState] = useState<"checking" | "ok" | "mismatch" | "down">(
    "checking",
  );
  useEffect(() => {
    let live = true;
    fetch(`${url.replace(/\/$/, "")}/v1/info`)
      .then((r) => r.json() as Promise<{ public_key: string }>)
      .then(
        (info) =>
          live &&
          setState(info.public_key === facilityPublicKey ? "ok" : "mismatch"),
      )
      .catch(() => live && setState("down"));
    return () => {
      live = false;
    };
  }, [url, facilityPublicKey]);
  const badge = {
    checking: <Badge>Checking…</Badge>,
    ok: <Badge tone="teal">Connected</Badge>,
    mismatch: <Badge tone="rose">Wrong key</Badge>,
    down: <Badge tone="amber">Unreachable</Badge>,
  }[state];
  return (
    <Card title="Hospital key service" action={badge}>
      <p className="text-sm text-slate-600">
        {name}&apos;s private key stays in its key service ({url}). When you
        open a record, the service checks with SehatLog that your role and the
        patient&apos;s consent allow it, then re-wraps each key to a key that
        exists only in this tab. Every use is logged at the hospital and in the
        patient&apos;s activity log.
      </p>
      {state === "mismatch" && (
        <p className="mt-2 text-sm text-rose-700">
          The service holds a different key than the one SehatLog publishes for{" "}
          {name}. Contact your IT team.
        </p>
      )}
      {state === "down" && (
        <p className="mt-2 text-sm text-amber-800">
          The key service can&apos;t be reached from this device, so records
          can&apos;t be opened right now.
        </p>
      )}
    </Card>
  );
}

function SeedStatus({
  seed,
  registered,
}: {
  seed: Uint8Array<ArrayBuffer> | null;
  registered: string;
}) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (!seed) queueMicrotask(() => live && setOk(false));
    else
      sc.ed25519PublicKey(seed).then(
        (p) => live && setOk(toB64(p) === registered),
      );
    return () => {
      live = false;
    };
  }, [seed, registered]);
  if (ok === null) return null;
  return ok ? (
    <p className="text-sm text-emerald-700">
      This device holds the matching private key.
    </p>
  ) : (
    <p className="text-sm text-amber-700">
      This device does not hold the registered key. Replace it to sign from
      here.
    </p>
  );
}
