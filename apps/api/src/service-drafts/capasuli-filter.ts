import type { ServiceDraftFilterState } from "@acropora/database";

/**
 * A CÁPASULI TÉTEL SORSA A JEV BESOROLÁSÁBÓL (Balázs, 2026-10-05; brief:
 * `exchange/capasuli-jev-szures-2026-10-05.md`). Tiszta függvény: a szabály
 * itt mérhető, a hívás és a tárolás máshol.
 *
 *   nincs besorolás (ki, hiba, nem ment ki)   UNFILTERED  látszik, "nem szűrt"
 *   OUR_TECHNICAL_FAULT, küszöb fölött         PASSED      látszik
 *   bármi, küszöb alatt                        UNCERTAIN   látszik, "bizonytalan"
 *   NOT_OURS / NOT_A_FAULT, küszöb fölött      FILTERED    a "Kiszűrve" alatt
 *
 * A HIBA IRÁNYA A MEGJELENÍTÉS FELÉ ÁLL: semmi nem vész el, ha a Jev nem
 * válaszol vagy bizonytalan; csak a biztosan nem nekünk szóló tétel kerül félre,
 * és onnan is visszahozható.
 */
export const OUR_TECHNICAL_FAULT = "OUR_TECHNICAL_FAULT";

export interface CapasuliVerdict {
  readonly kind: string;
  readonly confidence: number;
}

export function draftFilterState(
  verdict: CapasuliVerdict | null,
  threshold: number,
): ServiceDraftFilterState {
  if (!verdict) return "UNFILTERED";
  if (verdict.confidence < threshold) return "UNCERTAIN";
  return verdict.kind === OUR_TECHNICAL_FAULT ? "PASSED" : "FILTERED";
}

/**
 * A KÜSZÖB A KÖRNYEZETBŐL (`CAPASULI_JEV_MIN_CONFIDENCE`, 0 és 1 között, tizedesvesszővel is), a vak
 * mérés után beállítva. Alapérték 0.7; rossz alakú értékre is ez, nem a 0 (a
 * 0-nál semmi nem lenne bizonytalan: minden gyenge besorolás is döntene, a
 * kiszűrésről is, csendben).
 */
export const DEFAULT_CAPASULI_THRESHOLD = 0.7;

export function capasuliThreshold(raw: string | undefined): number {
  // tizedesvesszővel is, mint a többi Jev-küszöb (JEV_INVOICE_COLLECTION_THRESHOLD)
  const value = Number(raw?.replace(",", "."));
  return raw !== undefined &&
    raw.trim() !== "" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1
    ? value
    : DEFAULT_CAPASULI_THRESHOLD;
}

/** A futás entitása: egy jelentő-tétel, a piszkozat természetes kulcsa. */
export function capasuliItemEntityId(key: {
  readonly source: string;
  readonly mailbox: string;
  readonly reportDate: string;
  readonly fingerprint: string;
}): string {
  return `${key.source}:${key.mailbox}:${key.reportDate}:${key.fingerprint}`;
}
