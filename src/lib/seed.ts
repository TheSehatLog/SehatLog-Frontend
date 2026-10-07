// Demo directory data. All people and facilities are fictional.

import type { Category, Citizen, EntryPayload, Hospital, Staff } from "./types";

export const DEMO_PASSWORD = "sehat123";

export const citizens: Citizen[] = [
  {
    id: "c-aisha",
    nin: "23456789012",
    name: "Aisha Bello",
    dob: "1991-03-14",
    sex: "F",
    phone: "+234 803 555 0142",
    email: "aisha.bello@example.com",
    nokId: "c-musa",
    familyIds: ["c-fatima"],
    guardianIds: [],
    fingerprint: "FP-AISHA",
  },
  {
    id: "c-musa",
    nin: "34567890123",
    name: "Musa Bello",
    dob: "1988-07-02",
    sex: "M",
    phone: "+234 806 555 0187",
    email: "musa.bello@example.com",
    nokId: "c-aisha",
    familyIds: [],
    guardianIds: [],
    fingerprint: "FP-MUSA",
  },
  {
    id: "c-fatima",
    nin: "45678901234",
    name: "Fatima Bello",
    dob: "1995-11-20",
    sex: "F",
    phone: "+234 810 555 0119",
    email: "fatima.bello@example.com",
    familyIds: ["c-aisha"],
    guardianIds: [],
    fingerprint: "FP-FATIMA",
  },
  {
    id: "c-zainab",
    nin: "56789012345",
    name: "Zainab Bello",
    dob: "2019-05-09",
    sex: "F",
    phone: "+234 803 555 0142",
    email: "aisha.bello@example.com",
    nokId: "c-aisha",
    familyIds: ["c-fatima"],
    guardianIds: ["c-aisha", "c-musa"],
    fingerprint: "FP-ZAINAB",
  },
];

export const hospitals: Hospital[] = [
  {
    id: "h-lcth",
    name: "Lagos Central Teaching Hospital",
    hfrId: "24/01/1/2/1/0101",
    address: "Idi-Araba, Surulere, Lagos",
    type: "Tertiary",
  },
  {
    id: "h-igh",
    name: "Ikeja General Hospital",
    hfrId: "24/01/2/1/1/0217",
    address: "Oba Akinjobi Way, Ikeja, Lagos",
    type: "Secondary",
  },
  {
    id: "h-ade",
    name: "Ade Diagnostics Centre",
    hfrId: "24/01/3/1/1/0450",
    address: "Allen Avenue, Ikeja, Lagos",
    type: "Diagnostic centre",
  },
];

export const staff: Staff[] = [
  { id: "s-femi", name: "Dr. Femi Adebayo", role: "Consultant", specialty: "Respiratory Medicine", licence: "MDCN/R/31207", hospitalId: "h-lcth", canMerge: true },
  { id: "s-amaka", name: "Dr. Amaka Obi", role: "Doctor", specialty: "Emergency Medicine (Registrar)", licence: "MDCN/R/45821", hospitalId: "h-igh", canMerge: false },
  { id: "s-tunde", name: "Dr. Tunde Adeyemi", role: "Consultant", specialty: "Emergency Medicine", licence: "MDCN/R/22984", hospitalId: "h-igh", canMerge: true },
  { id: "s-ngozi", name: "Dr. Ngozi Eze", role: "Medical Director", licence: "MDCN/R/18840", hospitalId: "h-igh", canMerge: true },
  { id: "s-blessing", name: "Blessing Okafor", role: "Nurse", licence: "NMCN/RN/77310", hospitalId: "h-igh", canMerge: false },
  { id: "s-ibrahim", name: "Ibrahim Musa", role: "Paramedic", licence: "EMS/LAS/04471", hospitalId: "h-igh", canMerge: false },
  { id: "s-kunle", name: "Kunle Ade", role: "Lab Scientist", licence: "MLSCN/LS/10452", hospitalId: "h-ade", canMerge: false },
];

const DAY = 86_400_000;

// Seeded history: written at Lagos Central Teaching Hospital, reviewed by Dr. Femi Adebayo.
export const seedEntries: { patientId: string; category: Category; daysAgo: number; payload: EntryPayload }[] = [
  {
    patientId: "c-aisha",
    category: "basic",
    daysAgo: 240,
    payload: {
      kind: "Allergy",
      title: "Penicillin: anaphylaxis",
      details: "Severe reaction in 2019. Avoid all penicillins.",
      fields: { Severity: "Severe", Reaction: "Anaphylaxis" },
    },
  },
  {
    patientId: "c-aisha",
    category: "basic",
    daysAgo: 240,
    payload: {
      kind: "Note",
      title: "Blood group O+, genotype AS",
      details: "Confirmed by laboratory.",
      fields: { "Blood group": "O+", Genotype: "AS" },
    },
  },
  {
    patientId: "c-aisha",
    category: "clinical",
    daysAgo: 238,
    payload: {
      kind: "Diagnosis",
      title: "Asthma, moderate persistent",
      details: "Night-time symptoms twice a week. Triggers: dust, cold air.",
      fields: { "ICD-11": "CA23.1", Status: "Active" },
    },
  },
  {
    patientId: "c-aisha",
    category: "medications",
    daysAgo: 238,
    payload: {
      kind: "Prescription",
      title: "Salbutamol inhaler 100 mcg",
      details: "Reliever.",
      fields: { Dose: "2 puffs as needed", Route: "Inhaled", Duration: "Ongoing" },
    },
  },
  {
    patientId: "c-aisha",
    category: "medications",
    daysAgo: 238,
    payload: {
      kind: "Prescription",
      title: "Budesonide inhaler 200 mcg",
      details: "Preventer.",
      fields: { Dose: "1 puff twice daily", Route: "Inhaled", Duration: "Ongoing" },
    },
  },
  {
    patientId: "c-aisha",
    category: "labs",
    daysAgo: 60,
    payload: {
      kind: "Lab result",
      title: "Full blood count",
      details: "Within normal limits.",
      fields: { Hb: "12.8 g/dL", WBC: "6.2 x10^9/L", Platelets: "245 x10^9/L" },
    },
  },
  {
    patientId: "c-aisha",
    category: "sensitive",
    daysAgo: 45,
    payload: {
      kind: "Note",
      title: "Generalised anxiety: CBT referral",
      details: "Referred for 8 sessions of cognitive behavioural therapy.",
      fields: { "ICD-11": "6B00" },
    },
  },
  {
    patientId: "c-zainab",
    category: "basic",
    daysAgo: 700,
    payload: {
      kind: "Note",
      title: "Blood group A+, genotype AA",
      details: "No known allergies.",
      fields: { "Blood group": "A+", Genotype: "AA" },
    },
  },
  {
    patientId: "c-zainab",
    category: "clinical",
    daysAgo: 400,
    payload: {
      kind: "Immunisation",
      title: "Measles, second dose (MCV2)",
      details: "Given per the national schedule.",
      fields: { Batch: "MCV-24-1187", Site: "Left upper arm" },
    },
  },
];

export const seedConnections = [
  { patientId: "c-aisha", hospitalId: "h-lcth", grantedById: "c-aisha", grantedBy: "self" as const, daysAgo: 240 },
  { patientId: "c-zainab", hospitalId: "h-lcth", grantedById: "c-aisha", grantedBy: "guardian" as const, daysAgo: 700 },
];

export { DAY };
