import {
  BILLING_ISSUING_MIN_AGE_MINUTES,
  type BillingDocumentType,
  type BillingIssuingAction,
  type BillingIssuingLookup,
} from "@acropora/types";

import type { IssuingKind } from "./billing-issuing-diagnose.js";
import type { SzamlazzQueryResult } from "./billing-szamlazz-query.js";

/**
 * A KIVEZETŐ ÚT DÖNTÉSE AZ ISSUING-BEN ÁLLÓ SORRÓL (kártya 38e9271d, terv:
 * acrobot jóváhagyása 37530). TISZTA FÜGGVÉNY: nincs hálózat és adatbázis; a
 * szolgáltatás gyűjti a tényeket, ez dönt, a táblázatos teszt minden ágat
 * fedi.
 *
 * A SZABÁLY, EGY MONDATBAN: a szerver csak azt javasolja, amit a Számlázz.hu
 * IGAZOLT, és minden más "nem tudjuk" (a sor ISSUING marad, nincs végrehajtó
 * gomb).
 *
 *   ISSUED     csak olyan számmal, amit a Számlázz.hu a SAJÁT bizonylatunkra
 *              adott vissza (külső azonosítóra, vagy a szövegben álló számra
 *              számlaszám szerint), és ha a bizonylat típusa és bruttó
 *              végösszege is egyezik a miénkkel.
 *   DRAFT      csak az ISSUING-ben bizonytalan ágakon (NO_REPLY, UNCLEAR_REPLY,
 *              NO_NOTE, OTHER), és csak ha MIND teljesül: a válasz érvényes
 *              "nincs ilyen azonosító" (hibakód 7); ugyanebben a futásban egy
 *              ismert, kiállított bizonylatot a lekérdezés MEGTALÁLT (pozitív
 *              kontroll: ha a kérés alakja hibás, a 7-es mindenre jönne, és
 *              egy hamis "nincs szám" dupla kiállításhoz vezetne); a sor
 *              legalább 30 perce áll ISSUING-ben (a kérdéses hívás ne
 *              lehessen még feldolgozás alatt).
 *   MÁS MINDEN időtúllépés, HTTP-hiba, más hibakód, érthetetlen válasz,
 *              ellentmondás (a szöveg szerint létezik, de a Számlázz.hu nem
 *              találja; eltérő szám, típus vagy összeg): NONE.
 */
export interface ResolutionFacts {
  kind: IssuingKind;
  /** A `syncError` szövegében álló Számlázz.hu-szám (RECORDING_FAILED, STRAY_PREVIEW). */
  knownNumber: string | null;
  ageMinutes: number;
  documentType: BillingDocumentType;
  /** A vázlatból számolt bruttó végösszeg (ugyanaz, ami a Számlázz.hu-ra ment). */
  computedGross: string;
  /** A lekérdezés eredménye, vagy `UNAVAILABLE`, ha nem jött érthető válasz. */
  lookup: SzamlazzQueryResult | { outcome: "UNAVAILABLE" };
  /** Egy ismert, kiállított bizonylatot ugyanebben a futásban megtalált-e a lekérdezés. */
  controlProven: boolean;
}

export interface ResolutionDecision {
  lookup: BillingIssuingLookup;
  action: BillingIssuingAction;
  invoiceNumber: string | null;
  reason: string;
}

/** A `szamla.alap.tipus` kódja, amit az adott típusú bizonylattól várunk. */
const EXPECTED_KIND_CODE: Record<BillingDocumentType, string> = {
  INVOICE: "SZ",
  ADVANCE_INVOICE: "ES",
  FINAL_INVOICE: "VS",
  PROFORMA: "D",
  DELIVERY_NOTE: "SL",
};

export function expectedSzamlazzKindCode(type: BillingDocumentType): string {
  return EXPECTED_KIND_CODE[type];
}

/** A szövegben számlaszám szerint kell keresni (nincs külső azonosító az előnézet-kérésen). */
export function lookupKeyFor(
  kind: IssuingKind,
  knownNumber: string | null,
): { by: "externalId" } | { by: "invoiceNumber"; value: string } | null {
  if (kind === "STRAY_PREVIEW")
    return knownNumber ? { by: "invoiceNumber", value: knownNumber } : null;
  return { by: "externalId" };
}

const none = (
  lookup: BillingIssuingLookup,
  reason: string,
): ResolutionDecision => ({
  lookup,
  action: "NONE",
  invoiceNumber: null,
  reason,
});

/** "12 345.00" és "12345" ugyanaz az összeg; a Számlázz.hu a tizedespontot használja. */
function sameAmount(a: string | null, b: string): boolean {
  if (a === null) return false;
  const left = Number(a.replace(/\s/g, "").replace(",", "."));
  const right = Number(b.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

export function decideResolution(facts: ResolutionFacts): ResolutionDecision {
  const { lookup } = facts;
  if (lookup.outcome === "UNAVAILABLE")
    return none(
      "UNKNOWN",
      "A Számlázz.hu válasza nem érkezett meg vagy nem érthető: nem tudjuk, van-e bizonylat.",
    );
  if (lookup.outcome === "ERROR")
    return none(
      "UNKNOWN",
      `A Számlázz.hu hibát adott${lookup.errorCode ? ` (${lookup.errorCode})` : ""}, ami nem azt jelenti, hogy nincs bizonylat: nem tudjuk.`,
    );

  const numberInNote =
    facts.kind === "RECORDING_FAILED" || facts.kind === "STRAY_PREVIEW";

  if (lookup.outcome === "FOUND") {
    if (numberInNote && lookup.invoiceNumber !== facts.knownNumber)
      return none(
        "FOUND",
        "A Számlázz.hu más számot ad, mint ami a hibaszövegben áll: ellentmondás, kézi ellenőrzés kell.",
      );
    if (lookup.kindCode !== expectedSzamlazzKindCode(facts.documentType))
      return none(
        "FOUND",
        "A Számlázz.hu bizonylatának típusa nem egyezik a vázlatéval: nem a mi bizonylatunk lehet.",
      );
    if (!sameAmount(lookup.grossTotal, facts.computedGross))
      return none(
        "FOUND",
        "A Számlázz.hu bizonylatának bruttó végösszege eltér a vázlatétól: nem rögzíthető magától.",
      );
    if (!lookup.issueDate)
      return none(
        "FOUND",
        "A Számlázz.hu bizonylatának keltét nem tudjuk kiolvasni: nem rögzíthető magától.",
      );
    return {
      lookup: "FOUND",
      action: "RECORD_ISSUED",
      invoiceNumber: lookup.invoiceNumber,
      reason: `A Számlázz.hu igazolja a(z) ${lookup.invoiceNumber} bizonylatot (típus és bruttó végösszeg egyezik): rögzíthető kiállítottként.`,
    };
  }

  // NOT_FOUND
  if (numberInNote)
    return none(
      "NOT_FOUND",
      "A hibaszöveg szerint van bizonylat, a Számlázz.hu viszont nem találja: ellentmondás, nem nyúlunk a sorhoz.",
    );
  if (!facts.controlProven)
    return none(
      "NOT_FOUND",
      'A "nincs ilyen azonosító" válasz nem igazolható: ugyanebben a futásban nem sikerült egy ismert, kiállított bizonylatot megtalálni a lekérdezéssel.',
    );
  if (facts.ageMinutes < BILLING_ISSUING_MIN_AGE_MINUTES)
    return none(
      "NOT_FOUND",
      `A sor még csak ${Math.floor(facts.ageMinutes)} perce áll ISSUING-ben: a kérdéses hívás még feldolgozás alatt lehet (legalább ${BILLING_ISSUING_MIN_AGE_MINUTES} perc kell).`,
    );
  return {
    lookup: "NOT_FOUND",
    action: "BACK_TO_DRAFT",
    invoiceNumber: null,
    reason:
      "A Számlázz.hu nem ismeri a bizonylat azonosítóját (hibakód 7), a lekérdezés működése ugyanebben a futásban igazolt, és a sor elég régi: bizonyított, hogy nincs kiállított bizonylat.",
  };
}
