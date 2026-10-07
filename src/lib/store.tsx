"use client";

// Simulated SehatLog backend plus the key vaults of each party.
//
// `server` is everything the SehatLog servers would hold: metadata and ciphertext.
// `vaults` stands in for keys that never leave their owners:
//   - patientKeys: on the patient's (or guardian's) phone
//   - hospitalPrivate: in each hospital's HSM
//   - custodianParts: escrow parts held by the 5 custodians (S: SehatLog,
//     R: both regulators, I: both independent bodies)

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  generateCategoryKey,
  generateKeyPair,
  importPublicKey,
  openAsAuthor,
  openEscrowPrivateKey,
  openWithCategoryKey,
  seal,
  sealEscrowPrivateKey,
  unwrapCategoryKey,
  wrapForPublicKey,
  type EscrowParts,
} from "./crypto";
import { citizens, DAY, hospitals, seedConnections, seedEntries, staff } from "./seed";
import type {
  AccessRequest,
  Category,
  Citizen,
  Connection,
  Custodian,
  CustodianGroup,
  Entry,
  EntryPayload,
  InputMethod,
  Persona,
  Proposal,
  ServerState,
  Staff,
} from "./types";
import { CATEGORIES } from "./types";

export const NOK_TIMEOUT_MS = 30 * 60_000;
export const EMERGENCY_GRANT_MS = 72 * 3_600_000;

type Vaults = {
  patientKeys: Record<string, Partial<Record<Category, Record<number, CryptoKey>>>>;
  hospitalPrivate: Record<string, CryptoKey>;
  hospitalPublic: Record<string, CryptoKey>;
  escrowPublic: Record<string, CryptoKey>; // per patient
  // custodianId -> patientId -> the part that custodian holds for that record
  custodianParts: Record<string, Record<string, Uint8Array<ArrayBuffer>>>;
};

// Working candidates from the technical design; seats are agreed with government before go-live.
const CUSTODIANS: Custodian[] = [
  { id: "cu-sehatlog", name: "SehatLog", group: "sehatlog", available: true },
  { id: "cu-nimc", name: "NIMC", group: "regulator", available: true },
  { id: "cu-ndpc", name: "NDPC", group: "regulator", available: true },
  { id: "cu-ethics", name: "University Hospital Ethics Board", group: "independent", available: true },
  { id: "cu-nma", name: "Nigerian Medical Association", group: "independent", available: true },
];

export const PART_FOR: Record<CustodianGroup, keyof EscrowParts> = { sehatlog: "S", regulator: "R", independent: "I" };

export type Readable =
  | { entry: Entry; state: "open"; payload: EntryPayload; via: "grant" | "own entry" }
  | { entry: Entry; state: "restricted" | "not-shared" };

export type AccessChoice = { level: "full" | "scoped"; categories: Category[]; durationHours?: number };

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const ALL: Category[] = CATEGORIES.map((c) => c.id);

// Role policy layered on top of the cryptographic grant (PRD section 4).
export function roleAllows(s: Staff, c: Category): boolean {
  if (c === "basic") return true;
  if (s.role === "Lab Scientist") return c === "labs";
  if (c === "sensitive") return !!s.specialty?.includes("Psychiatry");
  return true;
}

export function isActive(c: Connection, now = Date.now()) {
  return !c.removedAt && (!c.expiresAt || c.expiresAt > now);
}

export function ageOf(c: Citizen) {
  const d = new Date(c.dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

async function bootstrap(): Promise<{ server: ServerState; vaults: Vaults }> {
  const now = Date.now();
  const hospitalPrivate: Record<string, CryptoKey> = {};
  const hospitalPublic: Record<string, CryptoKey> = {};
  const hospitalPublicKeys: Record<string, string> = {};
  for (const h of hospitals) {
    const kp = await generateKeyPair();
    hospitalPrivate[h.id] = kp.privateKey;
    hospitalPublic[h.id] = await importPublicKey(kp.spki);
    hospitalPublicKeys[h.id] = kp.spki;
  }

  const patientKeys: Vaults["patientKeys"] = {};
  const escrowWrapped: ServerState["escrowWrapped"] = {};
  const currentKeyVersion: ServerState["currentKeyVersion"] = {};
  const escrowPublic: Vaults["escrowPublic"] = {};
  const escrowSealed: ServerState["escrowSealed"] = {};
  const custodianParts: Vaults["custodianParts"] = Object.fromEntries(CUSTODIANS.map((cu) => [cu.id, {}]));
  for (const c of citizens) {
    patientKeys[c.id] = {};
    escrowWrapped[c.id] = {};
    currentKeyVersion[c.id] = {};
    // Per-patient escrow key pair; only S + R + I together can rebuild the private half.
    const escrow = await generateKeyPair(true);
    escrowPublic[c.id] = escrow.publicKey;
    const sealedEscrow = await sealEscrowPrivateKey(escrow.privateKey, c.id);
    escrowSealed[c.id] = { ciphertext: sealedEscrow.ciphertext, iv: sealedEscrow.iv };
    for (const cu of CUSTODIANS) custodianParts[cu.id][c.id] = sealedEscrow.parts[PART_FOR[cu.group]];
    for (const cat of ALL) {
      const k = await generateCategoryKey();
      patientKeys[c.id][cat] = { 1: k };
      escrowWrapped[c.id][cat] = { 1: await wrapForPublicKey(k, escrow.publicKey) };
      currentKeyVersion[c.id][cat] = 1;
    }
  }

  const connections: Connection[] = [];
  for (const sc of seedConnections) {
    const wrappedKeys: Connection["wrappedKeys"] = {};
    for (const cat of ALL) {
      wrappedKeys[cat] = { 1: await wrapForPublicKey(patientKeys[sc.patientId][cat]![1], hospitalPublic[sc.hospitalId]) };
    }
    connections.push({
      id: uid("con"),
      patientId: sc.patientId,
      hospitalId: sc.hospitalId,
      level: "full",
      categories: ALL,
      grantedById: sc.grantedById,
      grantedBy: sc.grantedBy,
      reason: "Registered as primary hospital",
      connectedAt: now - sc.daysAgo * DAY,
      lastOpenedAt: now - 45 * DAY,
      lastOpenedBy: "s-femi",
      wrappedKeys,
    });
  }

  const entries: Entry[] = [];
  for (const se of seedEntries) {
    const at = now - se.daysAgo * DAY;
    entries.push({
      id: uid("ent"),
      patientId: se.patientId,
      category: se.category,
      version: 1,
      sealed: await seal(se.payload, patientKeys[se.patientId][se.category]![1], 1, hospitalPublic["h-lcth"]),
      authorStaffId: "s-femi",
      hospitalId: "h-lcth",
      createdAt: at,
      mergedAt: at + 3_600_000,
      reviewerStaffId: "s-femi",
      inputMethod: "Typed",
      status: "current",
    });
  }

  return {
    server: {
      citizens,
      hospitals,
      staff,
      connections,
      requests: [],
      entries,
      proposals: [],
      audit: [
        {
          id: uid("aud"),
          at: now - 45 * DAY,
          actor: "Dr. Femi Adebayo",
          hospitalId: "h-lcth",
          patientId: "c-aisha",
          action: "viewed",
          detail: "Opened full record",
        },
      ],
      hospitalPublicKeys,
      escrowWrapped,
      escrowSealed,
      custodians: CUSTODIANS,
      currentKeyVersion,
    },
    vaults: {
      patientKeys,
      hospitalPrivate,
      hospitalPublic,
      escrowPublic,
      custodianParts,
    },
  };
}

function useSehatStore() {
  const [server, setServer] = useState<ServerState | null>(null);
  const [persona, setPersona] = useState<Persona>({ kind: "citizen", id: "c-aisha" });
  const ref = useRef<ServerState | null>(null);
  const vaults = useRef<Vaults | null>(null);

  const load = useCallback(
    () =>
      bootstrap().then((b) => {
        vaults.current = b.vaults;
        ref.current = b.server;
        setServer(b.server);
      }),
    [],
  );

  const reset = useCallback(() => {
    setServer(null);
    return load();
  }, [load]);

  useEffect(() => {
    bootstrap().then((b) => {
      vaults.current = b.vaults;
      ref.current = b.server;
      setServer(b.server);
    });
  }, []);

  const commit = useCallback((fn: (s: ServerState) => ServerState) => {
    ref.current = fn(ref.current!);
    setServer(ref.current);
  }, []);

  const S = () => ref.current!;
  const V = () => vaults.current!;

  const log = useCallback(
    (patientId: string, actor: string, action: string, detail: string, hospitalId?: string) =>
      commit((s) => ({
        ...s,
        audit: [{ id: uid("aud"), at: Date.now(), actor, hospitalId, patientId, action, detail }, ...s.audit],
      })),
    [commit],
  );

  const citizen = (id?: string) => S().citizens.find((c) => c.id === id);
  const staffById = (id?: string) => S().staff.find((x) => x.id === id);
  const hospital = (id?: string) => S().hospitals.find((h) => h.id === id);

  // ---- Identification ----

  function lookup(query: { nin?: string; fingerprint?: string }, staffId: string) {
    const c = S().citizens.find((x) => (query.nin ? x.nin === query.nin.trim() : x.fingerprint === query.fingerprint));
    const st = staffById(staffId)!;
    if (c) log(c.id, st.name, "looked up", query.nin ? "NIN lookup" : "Fingerprint match", st.hospitalId);
    return c;
  }

  // ---- Emergency escrow ----

  // Each custodian checks the proof on its own and contributes its part. A release needs
  // SehatLog (S) + any available regulator (R) + any available independent body (I).
  async function releaseEscrow(patientId: string, purpose: string, hospitalId?: string): Promise<CryptoKey> {
    const pick = (g: CustodianGroup) => S().custodians.find((cu) => cu.group === g && cu.available);
    const chosen = { S: pick("sehatlog"), R: pick("regulator"), I: pick("independent") };
    const missing = (Object.keys(chosen) as (keyof typeof chosen)[]).filter((k) => !chosen[k]);
    if (missing.length) {
      const names = { S: "SehatLog", R: "a regulator", I: "an independent body" };
      log(patientId, "Escrow", "escrow release refused", `${purpose}: no response from ${missing.map((m) => names[m]).join(", ")}`, hospitalId);
      throw new Error(`Emergency release refused: it needs SehatLog + a regulator + an independent body, and ${missing.map((m) => names[m]).join(" and ")} did not respond.`);
    }
    const parts = V().custodianParts;
    const key = await openEscrowPrivateKey(
      S().escrowSealed[patientId],
      { S: parts[chosen.S!.id][patientId], R: parts[chosen.R!.id][patientId], I: parts[chosen.I!.id][patientId] },
      patientId,
    );
    log(patientId, "Escrow", "escrow release", `${purpose}: ${chosen.S!.name} + ${chosen.R!.name} + ${chosen.I!.name}`, hospitalId);
    return key;
  }

  function setCustodianAvailable(id: string, available: boolean) {
    commit((s) => ({ ...s, custodians: s.custodians.map((cu) => (cu.id === id ? { ...cu, available } : cu)) }));
  }

  // Basic Emergency Profile: released by the escrow to any verified clinician, always logged.
  async function basicProfile(patientId: string, hospitalId?: string): Promise<EntryPayload[]> {
    const escrowKey = await releaseEscrow(patientId, "Basic Emergency Profile", hospitalId);
    const out: EntryPayload[] = [];
    for (const e of S().entries.filter((x) => x.patientId === patientId && x.category === "basic" && x.status === "current")) {
      const wrapped = S().escrowWrapped[patientId].basic![e.sealed.keyVersion];
      const k = await unwrapCategoryKey(wrapped, escrowKey);
      out.push(await openWithCategoryKey(e.sealed, k));
    }
    return out;
  }

  function activeConnection(patientId: string, hospitalId: string) {
    return S().connections.find((c) => c.patientId === patientId && c.hospitalId === hospitalId && isActive(c));
  }

  // ---- Reading the record ----

  async function readAsStaff(patientId: string, staffId: string): Promise<Readable[]> {
    const st = staffById(staffId)!;
    const con = activeConnection(patientId, st.hospitalId);
    const priv = V().hospitalPrivate[st.hospitalId];
    const out: Readable[] = [];
    for (const e of S().entries.filter((x) => x.patientId === patientId)) {
      const granted = con?.categories.includes(e.category) && con.wrappedKeys[e.category]?.[e.sealed.keyVersion];
      if (granted && roleAllows(st, e.category)) {
        const k = await unwrapCategoryKey(con!.wrappedKeys[e.category]![e.sealed.keyVersion], priv);
        out.push({ entry: e, state: "open", payload: await openWithCategoryKey(e.sealed, k), via: "grant" });
      } else if (e.hospitalId === st.hospitalId && roleAllows(st, e.category)) {
        out.push({ entry: e, state: "open", payload: await openAsAuthor(e.sealed, priv), via: "own entry" });
      } else {
        out.push({ entry: e, state: granted ? "restricted" : "not-shared" });
      }
    }
    if (con) {
      commit((s) => ({
        ...s,
        connections: s.connections.map((c) => (c.id === con.id ? { ...c, lastOpenedAt: Date.now(), lastOpenedBy: staffId } : c)),
      }));
      log(patientId, st.name, "viewed", "Opened record", st.hospitalId);
    }
    return out;
  }

  // On the patient's or guardian's own device: their keyring opens everything.
  async function readAsOwner(patientId: string): Promise<Readable[]> {
    const ring = V().patientKeys[patientId];
    const out: Readable[] = [];
    for (const e of S().entries.filter((x) => x.patientId === patientId)) {
      const k = ring[e.category]![e.sealed.keyVersion];
      out.push({ entry: e, state: "open", payload: await openWithCategoryKey(e.sealed, k), via: "grant" });
    }
    return out;
  }

  // ---- Access requests and approvals ----

  function requestAccess(input: {
    patientId: string;
    staffId: string;
    reason: string;
    categories: Category[];
    patientCanConsent: boolean;
    incapacityReason?: string;
  }) {
    const st = staffById(input.staffId)!;
    const p = citizen(input.patientId)!;
    const firstStage = input.patientCanConsent ? "patient" : p.nokId ? "nok" : p.familyIds.length ? "family" : "break-glass";
    const req: AccessRequest = {
      id: uid("req"),
      patientId: input.patientId,
      hospitalId: st.hospitalId,
      staffId: st.id,
      reason: input.reason,
      categories: input.categories,
      incapacityReason: input.incapacityReason,
      stage: firstStage,
      status: "pending",
      createdAt: Date.now(),
      stageStartedAt: Date.now(),
      breakGlassSigners: [],
    };
    commit((s) => ({ ...s, requests: [req, ...s.requests] }));
    log(p.id, st.name, "requested access", `${input.reason} (${firstStage === "patient" ? "to patient" : `to ${firstStage}`})`, st.hospitalId);
    return req;
  }

  // Who may answer a request right now. Children: guardians always, never the child.
  function approversFor(r: AccessRequest): string[] {
    const p = citizen(r.patientId)!;
    const isChild = ageOf(p) < 18;
    if (r.stage === "patient") return isChild ? p.guardianIds : [p.id];
    if (r.stage === "nok") return isChild ? p.guardianIds : p.nokId ? [p.nokId] : [];
    if (r.stage === "family") return p.familyIds;
    return [];
  }

  // Wrap the chosen categories (all key versions, so history is readable) to the hospital.
  // escrowPurpose set = the keys come from the emergency escrow instead of the patient's device.
  async function wrapForHospital(patientId: string, hospitalId: string, cats: Category[], escrowPurpose?: string) {
    const v = V();
    const pub = v.hospitalPublic[hospitalId];
    const escrowKey = escrowPurpose ? await releaseEscrow(patientId, escrowPurpose, hospitalId) : undefined;
    const wrappedKeys: Connection["wrappedKeys"] = {};
    for (const cat of cats) {
      wrappedKeys[cat] = {};
      const versions = escrowKey ? S().escrowWrapped[patientId][cat]! : v.patientKeys[patientId][cat]!;
      for (const ver of Object.keys(versions).map(Number)) {
        const key = escrowKey
          ? await unwrapCategoryKey(S().escrowWrapped[patientId][cat]![ver], escrowKey)
          : v.patientKeys[patientId][cat]![ver];
        wrappedKeys[cat]![ver] = await wrapForPublicKey(key, pub);
      }
    }
    return wrappedKeys;
  }

  async function approveRequest(requestId: string, approverId: string, choice: AccessChoice) {
    const r = S().requests.find((x) => x.id === requestId)!;
    const p = citizen(r.patientId)!;
    const approver = citizen(approverId)!;
    const grantedBy =
      r.stage === "patient" ? (approverId === p.id ? "self" : "guardian") : r.stage === "nok" ? (p.guardianIds.includes(approverId) ? "guardian" : "nok") : "family";
    // Patient/guardian devices hold the keys; NOK and family approvals release them from escrow.
    const viaEscrow = grantedBy === "nok" || grantedBy === "family";
    const cats = Array.from(new Set<Category>(["basic", ...choice.categories]));
    const wrappedKeys = await wrapForHospital(p.id, r.hospitalId, cats, viaEscrow ? `${grantedBy === "nok" ? "Next of kin" : "Family"} approval by ${approver.name}` : undefined);
    const con: Connection = {
      id: uid("con"),
      patientId: p.id,
      hospitalId: r.hospitalId,
      level: choice.level,
      categories: cats,
      grantedById: approverId,
      grantedBy,
      reason: r.reason,
      connectedAt: Date.now(),
      expiresAt: choice.durationHours ? Date.now() + choice.durationHours * 3_600_000 : undefined,
      wrappedKeys,
    };
    commit((s) => ({
      ...s,
      connections: [...s.connections.filter((c) => !(c.patientId === p.id && c.hospitalId === r.hospitalId && isActive(c))), con],
      requests: s.requests.map((x) => (x.id === r.id ? { ...x, status: "approved", approvedById: approverId } : x)),
    }));
    log(
      p.id,
      approver.name,
      "approved access",
      `${hospital(r.hospitalId)!.name}: ${choice.level === "full" ? "full access" : cats.join(", ")}${viaEscrow ? " (released from emergency escrow)" : ""}`,
      r.hospitalId,
    );
  }

  function declineRequest(requestId: string, approverId: string) {
    const r = S().requests.find((x) => x.id === requestId)!;
    if (r.stage === "nok") {
      // A NOK decline moves the request on to family (PRD section 9).
      advanceStage(requestId, "declined by next of kin");
      return;
    }
    commit((s) => ({ ...s, requests: s.requests.map((x) => (x.id === requestId ? { ...x, status: "declined" } : x)) }));
    log(r.patientId, citizen(approverId)!.name, "declined access", hospital(r.hospitalId)!.name, r.hospitalId);
  }

  // Simulates the 30-minute timer running out.
  function advanceStage(requestId: string, why = "no response within 30 minutes") {
    const r = S().requests.find((x) => x.id === requestId)!;
    const p = citizen(r.patientId)!;
    const next = r.stage === "nok" && p.familyIds.length ? "family" : "break-glass";
    commit((s) => ({
      ...s,
      requests: s.requests.map((x) => (x.id === requestId ? { ...x, stage: next, stageStartedAt: Date.now() } : x)),
    }));
    log(p.id, "SehatLog", "escalated request", `${r.stage} → ${next}: ${why}`, r.hospitalId);
  }

  // Break-glass: treating doctor + Medical Director each sign; 72-hour grant, sensitive excluded.
  async function signBreakGlass(requestId: string, staffId: string) {
    const r = S().requests.find((x) => x.id === requestId)!;
    const signers = Array.from(new Set([...r.breakGlassSigners, staffId]));
    commit((s) => ({ ...s, requests: s.requests.map((x) => (x.id === requestId ? { ...x, breakGlassSigners: signers } : x)) }));
    log(r.patientId, staffById(staffId)!.name, "signed break-glass", "Fingerprint signature", r.hospitalId);
    const hasDirector = signers.some((id) => staffById(id)?.role === "Medical Director");
    const hasDoctor = signers.some((id) => ["Doctor", "Consultant"].includes(staffById(id)!.role));
    if (!hasDirector || !hasDoctor) return;
    const cats: Category[] = ["basic", "clinical", "medications", "labs"];
    const wrappedKeys = await wrapForHospital(r.patientId, r.hospitalId, cats, "Break-glass");
    const con: Connection = {
      id: uid("con"),
      patientId: r.patientId,
      hospitalId: r.hospitalId,
      level: "emergency",
      categories: cats,
      grantedBy: "break-glass",
      reason: r.reason,
      connectedAt: Date.now(),
      expiresAt: Date.now() + EMERGENCY_GRANT_MS,
      wrappedKeys,
    };
    commit((s) => ({
      ...s,
      connections: [...s.connections, con],
      requests: s.requests.map((x) => (x.id === requestId ? { ...x, status: "approved" } : x)),
    }));
    log(r.patientId, "SehatLog", "emergency access granted", "Break-glass, 72 hours. Patient and Medical Director notified.", r.hospitalId);
  }

  // ---- Connected hospitals ----

  // Removing a hospital deletes its wrapped keys and rotates the keys it held, so it
  // cannot read anything written afterwards. Its own entries stay readable via authorWrappedDek.
  async function removeConnection(connectionId: string, actorId: string) {
    const v = V();
    const con = S().connections.find((c) => c.id === connectionId)!;
    const pid = con.patientId;
    const others = S().connections.filter((c) => c.id !== con.id && c.patientId === pid && isActive(c));
    const newVersions: Partial<Record<Category, number>> = { ...S().currentKeyVersion[pid] };
    const escrowAdd: Partial<Record<Category, Record<number, string>>> = {};
    const otherAdd: Record<string, Partial<Record<Category, Record<number, string>>>> = {};
    for (const cat of con.categories) {
      const ver = (newVersions[cat] ?? 1) + 1;
      newVersions[cat] = ver;
      const k = await generateCategoryKey();
      v.patientKeys[pid][cat]![ver] = k;
      escrowAdd[cat] = { [ver]: await wrapForPublicKey(k, v.escrowPublic[pid]) };
      for (const o of others.filter((o) => o.categories.includes(cat))) {
        otherAdd[o.id] = otherAdd[o.id] ?? {};
        otherAdd[o.id][cat] = { [ver]: await wrapForPublicKey(k, v.hospitalPublic[o.hospitalId]) };
      }
    }
    const merge = (a: Connection["wrappedKeys"], b: Connection["wrappedKeys"] = {}) => {
      const out = { ...a };
      for (const cat of Object.keys(b) as Category[]) out[cat] = { ...(a[cat] ?? {}), ...b[cat] };
      return out;
    };
    commit((s) => ({
      ...s,
      currentKeyVersion: { ...s.currentKeyVersion, [pid]: newVersions },
      escrowWrapped: { ...s.escrowWrapped, [pid]: merge(s.escrowWrapped[pid], escrowAdd) },
      connections: s.connections.map((c) =>
        c.id === con.id ? { ...c, removedAt: Date.now(), wrappedKeys: {} } : otherAdd[c.id] ? { ...c, wrappedKeys: merge(c.wrappedKeys, otherAdd[c.id]) } : c,
      ),
    }));
    log(pid, citizen(actorId)!.name, "removed hospital", `${hospital(con.hospitalId)!.name}. Keys rotated.`, con.hospitalId);
  }

  // ---- Proposals (pull requests) ----

  async function propose(input: {
    staffId: string;
    patientId: string;
    category: Category;
    payload: EntryPayload;
    inputMethod: InputMethod;
    amendsEntryId?: string;
  }) {
    const v = V();
    const st = staffById(input.staffId)!;
    const con = activeConnection(input.patientId, st.hospitalId);
    const ver = S().currentKeyVersion[input.patientId][input.category]!;
    const wrapped = con?.wrappedKeys[input.category]?.[ver];
    if (!wrapped) throw new Error("This hospital has no key for that category.");
    const k = await unwrapCategoryKey(wrapped, v.hospitalPrivate[st.hospitalId]);
    const p: Proposal = {
      id: uid("pr"),
      patientId: input.patientId,
      category: input.category,
      sealed: await seal(input.payload, k, ver, v.hospitalPublic[st.hospitalId]),
      amendsEntryId: input.amendsEntryId,
      authorStaffId: st.id,
      hospitalId: st.hospitalId,
      createdAt: Date.now(),
      inputMethod: input.inputMethod,
      status: "open",
    };
    commit((s) => ({ ...s, proposals: [p, ...s.proposals] }));
    log(input.patientId, st.name, "proposed entry", `${input.payload.kind}: ${input.payload.title}`, st.hospitalId);
  }

  async function openProposal(p: Proposal, staffId: string): Promise<EntryPayload> {
    const st = staffById(staffId)!;
    const con = activeConnection(p.patientId, st.hospitalId);
    const wrapped = con?.wrappedKeys[p.category]?.[p.sealed.keyVersion];
    if (wrapped) return openWithCategoryKey(p.sealed, await unwrapCategoryKey(wrapped, V().hospitalPrivate[st.hospitalId]));
    return openAsAuthor(p.sealed, V().hospitalPrivate[st.hospitalId]);
  }

  async function openEntryAsStaff(e: Entry, staffId: string): Promise<EntryPayload | null> {
    const st = staffById(staffId)!;
    const con = activeConnection(e.patientId, st.hospitalId);
    const wrapped = con?.wrappedKeys[e.category]?.[e.sealed.keyVersion];
    if (wrapped) return openWithCategoryKey(e.sealed, await unwrapCategoryKey(wrapped, V().hospitalPrivate[st.hospitalId]));
    if (e.hospitalId === st.hospitalId) return openAsAuthor(e.sealed, V().hospitalPrivate[st.hospitalId]);
    return null;
  }

  function review(proposalId: string, reviewerId: string, action: "merge" | "decline" | "request-changes", comment?: string) {
    const p = S().proposals.find((x) => x.id === proposalId)!;
    const rv = staffById(reviewerId)!;
    const now = Date.now();
    const status = action === "merge" ? "merged" : action === "decline" ? "declined" : "changes-requested";
    commit((s) => {
      let entries = s.entries;
      if (action === "merge") {
        const prior = p.amendsEntryId ? s.entries.find((e) => e.id === p.amendsEntryId) : undefined;
        entries = entries.map((e) => (prior && e.id === prior.id ? { ...e, status: "superseded" } : e));
        entries = [
          ...entries,
          {
            id: uid("ent"),
            patientId: p.patientId,
            category: p.category,
            version: prior ? prior.version + 1 : 1,
            supersedesId: prior?.id,
            sealed: p.sealed,
            authorStaffId: p.authorStaffId,
            hospitalId: p.hospitalId,
            createdAt: p.createdAt,
            mergedAt: now,
            reviewerStaffId: reviewerId,
            inputMethod: p.inputMethod,
            status: "current",
          },
        ];
      }
      return {
        ...s,
        entries,
        proposals: s.proposals.map((x) => (x.id === proposalId ? { ...x, status, reviewerStaffId: reviewerId, reviewComment: comment, decidedAt: now } : x)),
      };
    });
    log(p.patientId, rv.name, action === "merge" ? "merged" : action === "decline" ? "declined" : "requested changes", comment || p.id, rv.hospitalId);
  }

  return {
    ready: !!server,
    server,
    persona,
    setPersona,
    reset,
    citizen,
    staffById,
    hospital,
    lookup,
    basicProfile,
    activeConnection,
    readAsStaff,
    readAsOwner,
    requestAccess,
    approversFor,
    approveRequest,
    declineRequest,
    advanceStage,
    signBreakGlass,
    removeConnection,
    propose,
    openProposal,
    openEntryAsStaff,
    review,
    releaseEscrow,
    setCustodianAvailable,
    custodianPart: (custodianId: string, patientId: string) => vaults.current!.custodianParts[custodianId][patientId],
  };
}

type Store = ReturnType<typeof useSehatStore>;
const Ctx = createContext<Store | null>(null);

export function SehatProvider({ children }: { children: React.ReactNode }) {
  const store = useSehatStore();
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useSehat() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSehat outside SehatProvider");
  return s;
}
