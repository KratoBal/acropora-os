import {
  MORTALITY_PRODUCT_NAME_MAX,
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
 * A FORRÁS ÉRVÉNYESSÉGE: beszállítónál a rendszerbeli beszállító VAGY a neve
 * szabad szöveggel (pontosan az egyik; Balázs 2026-10-07: „előfordulhat, hogy
 * olyan beszállító van, aki nincs a rendszerben, és nem is akarjuk felvenni”),
 * más forrásnál nem lehet beszállító, az „egyéb” forrásnak neve kell. Hibánál az
 * üzenet, egyébként `null`.
 */
export function mortalitySourceProblem(
  input: MortalitySourceInput,
): string | null {
  const note = input.sourceNote?.trim() ?? "";
  if (note.length > MORTALITY_SOURCE_NOTE_MAX)
    return `A forrás megnevezése legfeljebb ${MORTALITY_SOURCE_NOTE_MAX} karakter.`;
  if (input.sourceType === "SUPPLIER") {
    if (input.supplierId && note)
      return "Beszállítónál vagy a listából válassz, vagy írd be a nevét, a kettőt együtt nem.";
    return input.supplierId || note
      ? null
      : "Beszállítói forrásnál válaszd ki a beszállítót, vagy írd be a nevét.";
  }
  if (input.supplierId)
    return "Beszállító csak beszállítói forrásnál adható meg.";
  if (input.sourceType === "OTHER" && !note)
    return "Az „Egyéb” forrásnál meg kell nevezni, honnan érkezett az állat.";
  return null;
}

/**
 * A tárolt forrás-mezők: beszállítónál a rendszerbeli beszállító, vagy ha nincs,
 * a neve szabad szövegként; másutt nincs beszállító.
 */
export function normalizedSource(input: MortalitySourceInput): {
  sourceType: MortalitySourceType;
  supplierId: string | null;
  sourceNote: string | null;
} {
  const note = input.sourceNote?.trim() || null;
  if (input.sourceType === "SUPPLIER")
    return input.supplierId
      ? {
          sourceType: "SUPPLIER",
          supplierId: input.supplierId,
          sourceNote: null,
        }
      : { sourceType: "SUPPLIER", supplierId: null, sourceNote: note };
  return { sourceType: input.sourceType, supplierId: null, sourceNote: note };
}

export interface MortalityProductInput {
  productId?: string | null;
  productName?: string | null;
}

/**
 * AZ ÉLŐLÉNY: rendszerbeli termék VAGY szabad szöveges név, pontosan az egyik
 * (Balázs 2026-10-07). Hibánál az üzenet, egyébként `null`.
 */
export function mortalityProductProblem(
  input: MortalityProductInput,
): string | null {
  const name = input.productName?.trim() ?? "";
  if (name.length > MORTALITY_PRODUCT_NAME_MAX)
    return `Az élőlény neve legfeljebb ${MORTALITY_PRODUCT_NAME_MAX} karakter.`;
  if (input.productId && name)
    return "Az élőlényt vagy a listából válaszd, vagy írd be a nevét, a kettőt együtt nem.";
  return input.productId || name
    ? null
    : "Válaszd ki az élőlényt, vagy írd be a nevét.";
}

/** A tárolt élőlény-mezők: a termék, vagy ha nincs, a szabad szöveges név. */
export function normalizedProduct(input: MortalityProductInput): {
  productId: string | null;
  productName: string | null;
} {
  return input.productId
    ? { productId: input.productId, productName: null }
    : { productId: null, productName: input.productName?.trim() || null };
}

/**
 * A HELYSZÍN: a bolt saját akváriuma VAGY egy halas rack, legalább az egyik
 * (2026-10-07: a halas rackek nem akváriumok, és nem is kerülnek az Akváriumok
 * menübe). Mindkettő is megadható. Az adatbázis CHECK-je ugyanezt őrzi.
 */
export const PLACE_REQUIRED_MESSAGE =
  "Add meg az akváriumot vagy a halas racket (legalább az egyiket).";

export function placeProblem(input: {
  aquariumId?: string | null;
  locationId?: string | null;
}): string | null {
  return input.aquariumId || input.locationId ? null : PLACE_REQUIRED_MESSAGE;
}

/** Pozitív egész példányszám (a prompt: se 0, se negatív). */
export function quantityProblem(quantity: unknown): string | null {
  return Number.isInteger(quantity) && (quantity as number) >= 1
    ? null
    : "A példányszám legalább 1, egész szám.";
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * AZ ELHULLÁS NAPJA (Luca kérése, 2026-10-07): létező naptári nap, `ÉÉÉÉ-HH-NN`
 * alakban, és nem a jövőben. A „ma” Budapest napja (`today`), nem a szerveré.
 * Hibánál az üzenet, egyébként `null`.
 */
export function occurredOnProblem(day: string, today: string): string | null {
  const match = DAY.exec(day);
  const date = match ? new Date(`${day}T00:00:00Z`) : null;
  // a `Date` a 02-30-at csendben 03-02-re görgetné: a visszaolvasás dönt
  if (!date || Number.isNaN(date.getTime()) || dayKeyOf(date) !== day)
    return "Az elhullás napja érvénytelen dátum.";
  return day > today ? "Az elhullás napja nem lehet a jövőben." : null;
}

/** Egy `@db.Date` mező napja: a Prisma UTC éjfélként adja és várja. */
export function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A nap mint `@db.Date` érték (UTC éjfél). */
export function dateOfDayKey(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * AZ AUDITNAPLÓ VÁLTOZÁS-LISTÁJA: csak a ténylegesen megváltozott mezők, régi és
 * új értékkel. Egy „semmi nem változott” módosítás nem ír naplósort. A dátum
 * (az elhullás napja) napként hasonlít és naplózódik: két `Date` példány
 * `!==`-vel mindig különbözne.
 */
export function mortalityChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const comparable = (value: unknown) =>
    value instanceof Date ? dayKeyOf(value) : (value ?? null);
  for (const key of Object.keys(after)) {
    const from = comparable(before[key]);
    const to = comparable(after[key]);
    if (from !== to) changes[key] = { from, to };
  }
  return changes;
}
