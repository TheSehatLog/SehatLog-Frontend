// Client for the SehatLog Go API (proxied at /api by next.config.ts).
// Binary fields travel as standard base64, matching Go's []byte JSON encoding.

export type Bytes = Uint8Array<ArrayBuffer>;

/** Free text sealed to its readers (crypto spec section 8). */
export type SealedText = { ciphertext: string; keys: { to: string; wrapped: string }[] };

export function fromB64(s: string | null | undefined): Bytes {
  if (!s) return new Uint8Array(0);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Bytes;
}

export function toB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (s: string): Bytes => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16)) as Bytes;

export type Facility = { facility_id: string; hfr_id: string; name: string; address: string; type: string; public_key?: string; key_service_url?: string };

export type Me =
  | {
      actor_type: "staff";
      id: string;
      full_name: string;
      role: string;
      specialty: string;
      can_merge: boolean;
      facility: Facility;
      signing_public_key: string | null;
    }
  | { actor_type: "citizen"; id: string; record_id: string; acts_for_records: string[] };

export type WrappedKey = { category: string; key_version: number; wrapped: string };

export type AccessRequest = {
  request_id: string;
  record_id: string;
  facility_id: string;
  staff_id: string;
  categories: string[];
  reason_sealed: SealedText | null; // {"reason", "incapacity"} JSON, sealed (spec section 8)
  stage: "patient" | "nok" | "family" | "break_glass";
  status: string;
  stage_deadline?: string;
  created_at: string;
};

export type RequestView = AccessRequest & { facility: Facility; acting_as: "self" | "guardian" | "nok" | "family" };

export type Connection = {
  connection_id: string;
  record_id: string;
  facility_id: string;
  level: "full" | "scoped" | "emergency";
  categories: string[];
  granted_by_type: string;
  connected_at: string;
  expires_at?: string;
  last_opened_at?: string;
  last_opened_by?: string;
  removed_at?: string;
};

export type ConnectionView = Connection & { facility: Facility; active: boolean };

export type Envelope = {
  entry_id: string;
  record_id: string;
  category: string;
  key_version: number;
  nonce: string;
  ciphertext: string;
  wrapped_dek: string;
  author_wrapped_dek: string;
  author_signature: string;
  amends_entry_id: string;
  input_method: string;
  author_staff_id: string;
  facility_id: string;
  created_at: string;
};

export type Proposal = Envelope & {
  proposal_id: string;
  status: string;
  reviewer_staff_id?: string;
  review_comment_sealed?: SealedText;
  fast_track?: boolean;
  decided_at?: string;
};
export type Entry = Envelope & {
  version: number;
  status: "current" | "superseded";
  proposal_id: string;
  reviewer_staff_id: string;
  merged_at: string;
  /** Emergency fast-track: merged by its author, then confirmed by a second clinician. */
  fast_tracked: boolean;
  review_status: "reviewed" | "pending_review";
  reviewed_by?: string;
  reviewed_at?: string;
  merge_signature: string;
  /** Set once a pharmacy has dispensed this prescription. */
  dispensed?: Dispensation;
};
export type Dispensation = {
  dispensation_id: string;
  entry_id: string;
  facility_id: string;
  facility_name: string;
  staff_name: string;
  dispensed_at: string;
};
export type AuditEvent = { seq: number; at: string; actor_type: string; actor_id: string; facility_id?: string; action: string; categories?: string[] };

export type Notification = {
  notification_id: string;
  kind: string;
  title: string;
  body: string;
  record_id?: string;
  link_id?: string;
  urgent: boolean;
  created_at: string;
  read_at?: string;
};

export type Dispute = {
  dispute_id: string;
  record_id: string;
  entry_id: string;
  facility_id: string;
  raised_by: string;
  reason_sealed: SealedText | null;
  status: "open" | "upheld" | "amended";
  created_at: string;
  resolution_sealed?: SealedText;
  amendment_id?: string;
  resolved_at?: string;
};

export type Attachment = { file_id: string; name: string; mime: string; size: number; key: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---- Session (sessionStorage: cleared when the tab closes) ----

const SESSION_KEY = "sehatlog.live.session";
export type Session = { token: string; actorType: "staff" | "citizen"; expiresAt: number };

export function loadSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Session | null;
    return s && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable: the session lasts until reload.
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON (e.g. the proxy couldn't reach the API).
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? (res.status >= 500 ? "The SehatLog API is not reachable. Is it running on :8080?" : res.statusText);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export async function login(kind: "staff" | "citizen", body: Record<string, string>): Promise<Session> {
  const out = await api<{ access_token: string; expires_in: number }>(`/v1/auth/${kind}/login`, { method: "POST", body });
  const s: Session = { token: out.access_token, actorType: kind, expiresAt: Date.now() + out.expires_in * 1000 - 5000 };
  saveSession(s);
  return s;
}
