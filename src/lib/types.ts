// Data shapes for the SehatLog prototype.
// Everything in `ServerState` is what the SehatLog backend would store: clinical
// content only ever appears there as ciphertext.

export type Category = "basic" | "clinical" | "medications" | "labs" | "sensitive";

export const CATEGORIES: { id: Category; label: string; short: string }[] = [
  { id: "basic", label: "Basic Emergency Profile", short: "Basic" },
  { id: "clinical", label: "Clinical history", short: "Clinical" },
  { id: "medications", label: "Medications", short: "Meds" },
  { id: "labs", label: "Lab results", short: "Labs" },
  { id: "sensitive", label: "Sensitive (restricted)", short: "Sensitive" },
];

export type Citizen = {
  id: string;
  nin: string;
  name: string;
  dob: string; // ISO date
  sex: "F" | "M";
  phone: string;
  email: string;
  nokId?: string;
  familyIds: string[];
  guardianIds: string[]; // set for children (0-18)
  fingerprint: string; // demo stand-in for a biometric template id
};

export type Hospital = {
  id: string;
  name: string;
  hfrId: string;
  address: string;
  type: string;
};

export type StaffRole =
  | "Doctor"
  | "Consultant"
  | "Medical Director"
  | "Nurse"
  | "Lab Scientist"
  | "Paramedic";

export type Staff = {
  id: string;
  name: string;
  role: StaffRole;
  specialty?: string;
  licence: string;
  hospitalId: string;
  canMerge: boolean;
};

export type GrantSource = "self" | "guardian" | "nok" | "family" | "break-glass";

export type Connection = {
  id: string;
  patientId: string;
  hospitalId: string;
  level: "full" | "scoped" | "emergency";
  categories: Category[];
  grantedById?: string; // citizen id; undefined for break-glass
  grantedBy: GrantSource;
  reason: string;
  connectedAt: number;
  expiresAt?: number;
  lastOpenedAt?: number;
  lastOpenedBy?: string;
  removedAt?: number;
  // Category keys wrapped (RSA-OAEP) to this hospital's public key: category -> version -> b64.
  wrappedKeys: Partial<Record<Category, Record<number, string>>>;
};

export type RequestStage = "patient" | "nok" | "family" | "break-glass";

export type AccessRequest = {
  id: string;
  patientId: string;
  hospitalId: string;
  staffId: string;
  reason: string;
  categories: Category[];
  incapacityReason?: string;
  stage: RequestStage;
  status: "pending" | "approved" | "declined" | "expired";
  createdAt: number;
  stageStartedAt: number;
  approvedById?: string;
  breakGlassSigners: string[];
};

export type EntryPayload = {
  kind: "Allergy" | "Diagnosis" | "Prescription" | "Lab result" | "Note" | "Vitals" | "Immunisation";
  title: string;
  details: string;
  fields: Record<string, string>;
};

export type Sealed = {
  ciphertext: string; // b64
  iv: string; // b64
  keyVersion: number; // category key version wrapping the entry key
  wrappedDek: string; // entry key wrapped with the category key (AES-KW), b64
  authorWrappedDek: string; // entry key wrapped to the author hospital's public key, b64
};

export type InputMethod = "Typed" | "Detected (device)" | "Detected (OCR)";

export type Entry = {
  id: string;
  patientId: string;
  category: Category;
  version: number;
  supersedesId?: string;
  sealed: Sealed;
  authorStaffId: string;
  hospitalId: string;
  createdAt: number;
  mergedAt: number;
  reviewerStaffId: string;
  inputMethod: InputMethod;
  status: "current" | "superseded";
};

export type Proposal = {
  id: string;
  patientId: string;
  category: Category;
  sealed: Sealed;
  amendsEntryId?: string;
  authorStaffId: string;
  hospitalId: string;
  createdAt: number;
  inputMethod: InputMethod;
  status: "open" | "merged" | "declined" | "changes-requested";
  reviewerStaffId?: string;
  reviewComment?: string;
  decidedAt?: number;
};

export type AuditEvent = {
  id: string;
  at: number;
  actor: string;
  hospitalId?: string;
  patientId: string;
  action: string;
  detail: string;
};

export type CustodianGroup = "sehatlog" | "regulator" | "independent";

export type Custodian = {
  id: string;
  name: string;
  group: CustodianGroup;
  available: boolean;
};

export type ServerState = {
  citizens: Citizen[];
  hospitals: Hospital[];
  staff: Staff[];
  connections: Connection[];
  requests: AccessRequest[];
  entries: Entry[];
  proposals: Proposal[];
  audit: AuditEvent[];
  // Public keys only; private keys live in each hospital's own vault.
  hospitalPublicKeys: Record<string, string>; // hospitalId -> spki b64
  // Category keys wrapped to each patient's escrow public key.
  escrowWrapped: Record<string, Partial<Record<Category, Record<number, string>>>>;
  // Each patient's escrow private key, encrypted under S xor R xor I. Ciphertext only.
  escrowSealed: Record<string, { ciphertext: string; iv: string }>;
  custodians: Custodian[];
  currentKeyVersion: Record<string, Partial<Record<Category, number>>>;
};

export type Persona =
  | { kind: "citizen"; id: string }
  | { kind: "staff"; id: string }
  | { kind: "admin" };
