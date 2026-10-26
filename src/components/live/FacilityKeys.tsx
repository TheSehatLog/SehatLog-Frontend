"use client";

import { useMemo } from "react";
import { useLive } from "./LiveSession";
import { getFacilityKey } from "@/lib/live/keystore";
import { keyServiceUnwrapper, localUnwrapper, type Unwrapper } from "@/lib/live/unwrap";

export type FacilityKeys = { unwrap: Unwrapper | null; source: "service" | "local" | null };

/**
 * How this staff member's browser opens keys wrapped to their hospital: through the
 * hospital key service when the facility has one (the private key never reaches the
 * browser), or a locally loaded dev key otherwise.
 */
export function useFacilityKeys(): FacilityKeys {
  const { me, session } = useLive();
  const facility = me?.actor_type === "staff" ? me.facility : null;
  const url = facility?.key_service_url ?? "";
  const facilityId = facility?.facility_id ?? "";
  const token = session?.token;

  return useMemo<FacilityKeys>(() => {
    if (url) return { unwrap: keyServiceUnwrapper(url, () => token), source: "service" };
    const local = facilityId ? getFacilityKey(facilityId) : null;
    if (local) return { unwrap: localUnwrapper(local), source: "local" };
    return { unwrap: null, source: null };
  }, [url, facilityId, token]);
}
