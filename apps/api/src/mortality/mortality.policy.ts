import {
  MORTALITY_SOURCE_NOTE_MAX,
  type MortalitySourceType,
} from "@acropora/types";

/**
 * AZ ELHULLÁSI BEJEGYZÉS SZABÁLYAI, TISZTA FÜGGVÉNYEKBEN (kártya 115c9740).
 * Az adatbázis is őrzi a három legfontosabbat (a migráció CHECK-jei); ez a réteg
 * azért kell, hogy a felhasználó érthető magyar üzenetet kapjon, ne egy
 * megkötés nevét.
 */

export interface MortalitySourceInput {
  sourceType: MortalitySourceType;
  supplierId?: string | null;
  sourceNote?: string | null;
}

/**
 * A FORRÁS ÉRVÉNYESSÉGE: beszállítónál a beszállító kötelező, más forrásnál
 * nem lehet beszállító, az „egyéb” forrásnak neve kell. Hibánál az üzenet,
 * egyébként `null`.
 */
export function mortalitySourceProblem(
  input: MortalitySourceInput,
): string | null {
  const note = input.sourceNote?.trim() ?? "";
  if (note.length > MORTALITY_SOURCE_NOTE_MAX)
    return `A forrás megnevezése legfeljebb ${MORTALITY_SOURCE_NOTE_MAX} karakter.`;
  if (input.sourceType === "SUPPLIER")
    return input.supplierId
      ? null
      : "Beszállítói forrásnál a beszállító kötelező.";
  if (input.supplierId)
    return "Beszállító csak beszállítói forrásnál adható meg.";
  if (input.sourceType === "OTHER" && !note)
    return "Az „Egyéb” forrásnál meg kell nevezni, honnan érkezett az állat.";
  return null;
}

/** A tárolt forrás-mezők: beszállítónál nincs megnevezés, másutt nincs beszállító. */
export function normalizedSource(input: MortalitySourceInput): {
  sourceType: MortalitySourceType;
  supplierId: string | null;
  sourceNote: string | null;
} {
  const note = input.sourceNote?.trim() || null;
  return input.sourceType === "SUPPLIER"
    ? {
        sourceType: "SUPPLIER",
        supplierId: input.supplierId ?? null,
        sourceNote: null,
      }
    : { sourceType: input.sourceType, supplierId: null, sourceNote: note };
}

/** Pozitív egész példányszám (a prompt: se 0, se negatív). */
export function quantityProblem(quantity: unknown): string | null {
  return Number.isInteger(quantity) && (quantity as number) >= 1
    ? null
    : "A példányszám legalább 1, egész szám.";
}

/**
 * AZ AUDITNAPLÓ VÁLTOZÁS-LISTÁJA: csak a ténylegesen megváltozott mezők, régi és
 * új értékkel. Egy „semmi nem változott” módosítás nem ír naplósort.
 */
export function mortalityChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const from = before[key] ?? null;
    const to = after[key] ?? null;
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
}
