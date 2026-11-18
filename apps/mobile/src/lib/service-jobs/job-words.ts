/**
 * A LAP NEVE A MONDATBAN, A FAJTA SZERINT (hibajegy-maradek lista, 4. fejezet, acrobot 56196; Balázs 2026-11-18: "a karbantartásnak semmi köze a hibajegyekhez"). A KT-lap a saját nevén
 * szerepel a telefonon, a javítási jegy "hibajegy" marad. A webes `serviceJobNoun` mintája (apps/api/src/service-jobs/service-job-noun.ts), de a telefon app a munkatér csomagjait nem éri
 * el, ezért a másolat itt áll. A ragos alakok kiírva (gépi ragozás nincs: a hangrend miatt a "-hez"/"-hoz", "-ről"/"-ról" nem számolható biztonságosan).
 *
 * RELATÍV UT, NEM `@/` ALIAS: ez a modul spec-ből is behúzódik (lásd a `tsconfig.test.json` fejlécét).
 */
export type JobWordsKind = "REPAIR" | "MAINTENANCE" | string | null | undefined;

export interface JobWords {
  /** "hibajegy" / "karbantartási lap" */
  noun: string;
  /** "Hibajegy" / "Karbantartási lap" */
  nounCap: string;
  /** "hibajegyen" / "karbantartási lapon" */
  on: string;
  /** "hibajegyhez" / "karbantartási laphoz" */
  to: string;
  /** "hibajegy alatt" / "karbantartási lap alatt" */
  under: string;
  /** "hibajegyre" / "karbantartási lapra" */
  onto: string;
  /** "hibajegyről" / "karbantartási lapról" */
  from: string;
}

const REPAIR: JobWords = {
  noun: "hibajegy",
  nounCap: "Hibajegy",
  on: "hibajegyen",
  to: "hibajegyhez",
  under: "hibajegy alatt",
  onto: "hibajegyre",
  from: "hibajegyről",
};

const MAINTENANCE: JobWords = {
  noun: "karbantartási lap",
  nounCap: "Karbantartási lap",
  on: "karbantartási lapon",
  to: "karbantartási laphoz",
  under: "karbantartási lap alatt",
  onto: "karbantartási lapra",
  from: "karbantartási lapról",
};

/** A fajta szerinti szavak: a MAINTENANCE a karbantartási lapét, minden más (a hiányzó fajta is) a hibajegyét kapja. */
export function jobWords(kind: JobWordsKind): JobWords {
  return kind === "MAINTENANCE" ? MAINTENANCE : REPAIR;
}

/**
 * A FAJTA NÉLKÜLI HELYEK SZAVAI: a lista és a menü a hibajegyeket ÉS a karbantartási lapokat együtt mutatja (a telefon minden listahívása `kind=ALL`), ezért ott a mondat mindkettőt nevezi meg.
 */
export const BOTH_NOUN = "hibajegy vagy karbantartási lap";
export const BOTH_NOUN_PLURAL = "hibajegyek és karbantartási lapok";
