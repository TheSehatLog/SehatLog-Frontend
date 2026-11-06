"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLive } from "./LiveSession";
import { getDeviceKey } from "@/lib/live/keystore";
import { useFacilityKeys } from "./FacilityKeys";
import type { Unwrapper } from "@/lib/live/unwrap";
import { openSealed, type Purpose, type SealedText } from "@/lib/live/sealed";

/** Opens sealed text with this viewer's key: a citizen's device key, or the facility key. */
export function useSealedText(sealed: SealedText | null | undefined, purpose: Purpose, recordId: string): { text: string | null; status: "loading" | "ok" | "locked" } {
  const { me } = useLive();
  const facility = useFacilityKeys();
  const [state, setState] = useState<{ text: string | null; status: "loading" | "ok" | "locked" }>({ text: null, status: "loading" });

  useEffect(() => {
    // Citizens open it with this browser's device key; staff through the hospital key service.
    let reader: { id: string; key: Uint8Array<ArrayBuffer> | Unwrapper } | null = null;
    if (me?.actor_type === "citizen") {
      const k = getDeviceKey(me.id);
      if (k) reader = { id: `${me.id}:${k.keyId}`, key: k.priv };
    } else if (me?.actor_type === "staff" && facility.unwrap) {
      reader = { id: me.facility.facility_id, key: facility.unwrap };
    }
    const r = reader;
    const work = r ? openSealed(sealed, r.id, r.key, purpose, recordId).catch(() => null) : Promise.resolve(null);
    let live = true;
    work.then((text) => live && setState({ text, status: text == null ? "locked" : "ok" }));
    return () => {
      live = false;
    };
  }, [me, facility.unwrap, sealed, purpose, recordId]);
  return state;
}

/** Renders sealed text, or a note when this device can't open it. */
export function Sealed({ value, purpose, recordId, render }: { value: SealedText | null | undefined; purpose: Purpose; recordId: string; render?: (text: string) => ReactNode }) {
  const { text, status } = useSealedText(value, purpose, recordId);
  if (!value) return null;
  if (status === "loading") return <span className="text-slate-400">Decrypting…</span>;
  if (text == null)
    return (
      <span className="italic text-slate-400" title="Sealed text is encrypted only to the devices that were signed in when it was written.">
        Encrypted to your other signed-in devices (this one wasn&apos;t signed in yet when it was sent)
      </span>
    );
  return <>{render ? render(text) : text}</>;
}
