// Allergy check for prescribing and dispensing. It runs in the browser, on entries this
// device has decrypted: the server never sees the medicine or the allergy.
//
// A small table of common drug classes, not a drug database: it catches a medicine that
// is named in an allergy, or that shares a class with one ("amoxicillin" against a
// "penicillin allergy"). It supports clinical judgement and does not replace it.

import type { Payload } from "./records.ts";

const CLASSES: { name: string; aliases: string[]; members: string[] }[] = [
  {
    name: "penicillin",
    aliases: ["penicillin", "penicillins", "beta-lactam"],
    members: ["amoxicillin", "ampicillin", "co-amoxiclav", "amoxiclav", "augmentin", "flucloxacillin", "cloxacillin", "ampiclox", "piperacillin", "benzylpenicillin", "phenoxymethylpenicillin", "benzathine"],
  },
  { name: "cephalosporin", aliases: ["cephalosporin", "cephalosporins"], members: ["cefalexin", "cephalexin", "cefuroxime", "ceftriaxone", "cefixime", "cefotaxime", "ceftazidime", "cefazolin", "cefpodoxime"] },
  { name: "sulfonamide", aliases: ["sulfonamide", "sulphonamide", "sulfa", "sulpha"], members: ["sulfamethoxazole", "co-trimoxazole", "cotrimoxazole", "septrin", "sulfadoxine", "fansidar", "sulfasalazine"] },
  { name: "NSAID", aliases: ["nsaid", "nsaids", "anti-inflammatory"], members: ["ibuprofen", "diclofenac", "naproxen", "aspirin", "piroxicam", "indomethacin", "ketoprofen", "mefenamic"] },
  { name: "macrolide", aliases: ["macrolide", "macrolides"], members: ["azithromycin", "erythromycin", "clarithromycin"] },
  { name: "quinolone", aliases: ["quinolone", "quinolones", "fluoroquinolone"], members: ["ciprofloxacin", "levofloxacin", "ofloxacin", "moxifloxacin"] },
  { name: "tetracycline", aliases: ["tetracycline", "tetracyclines"], members: ["doxycycline", "minocycline", "oxytetracycline"] },
  { name: "opioid", aliases: ["opioid", "opioids", "opiate"], members: ["morphine", "codeine", "tramadol", "pethidine", "pentazocine"] },
];

// Classes known to cross-react: prescribing the second with an allergy to the first.
const CROSS: { allergy: string; drug: string }[] = [{ allergy: "penicillin", drug: "cephalosporin" }];

export type AllergyAlert = {
  level: "stop" | "caution";
  allergy: string; // the allergy entry's title
  message: string;
};

const an = (s: string) => (/^[aeiou]|^NSAID/i.test(s) ? `an ${s}` : `a ${s}`);
const words = (s: string) => s.toLowerCase().match(/[a-z][a-z-]+/g) ?? [];
const has = (text: string, term: string) => words(text).some((w) => w === term || (term.length >= 6 && w.startsWith(term)));

function classesIn(text: string): string[] {
  return CLASSES.filter((c) => [...c.aliases, ...c.members].some((t) => has(text, t))).map((c) => c.name);
}

/** The medicine's own name: the first word of "Amoxicillin 500 mg capsules". */
export function medicineName(text: string): string {
  return words(text)[0] ?? "";
}

/** Recorded allergies: current Allergy entries this device could decrypt. */
export function allergiesOf(items: { payload: Payload | null; status?: string }[]): Payload[] {
  return items.filter((i) => i.payload?.kind === "Allergy" && i.status !== "superseded").map((i) => i.payload!);
}

/** Checks a medicine against the patient's recorded allergies. */
export function checkAllergies(medicine: string, allergies: Payload[]): AllergyAlert[] {
  const name = medicineName(medicine);
  if (!name) return [];
  const drugClasses = classesIn(medicine);
  const display = name[0].toUpperCase() + name.slice(1);
  const out: AllergyAlert[] = [];
  for (const a of allergies) {
    const text = [a.title, a.details ?? "", ...Object.values(a.fields ?? {})].join(" ");
    const allergyClasses = classesIn(text);
    const shared = drugClasses.find((c) => allergyClasses.includes(c));
    if (has(text, name)) {
      out.push({ level: "stop", allergy: a.title, message: `Recorded allergy to ${display}.` });
    } else if (shared) {
      out.push({ level: "stop", allergy: a.title, message: `${display} is ${an(shared)}. The patient has a recorded ${shared} allergy.` });
    } else {
      const cross = CROSS.find((x) => allergyClasses.includes(x.allergy) && drugClasses.includes(x.drug));
      if (cross) out.push({ level: "caution", allergy: a.title, message: `${display} is ${an(cross.drug)}, which can cross-react with ${an(cross.allergy)} allergy.` });
    }
  }
  return out;
}
