import { Prisma } from "@acropora/database";

import { WORKSHEET_QUANTITY_SCALE } from "./worksheet-amounts.js";

/**
 * MUNKAÓRA-SZÁMOLÁS. Balázs kérése és egyben a mérce (2026-09-17, szó szerint):
 * "ha egy tétel 0.5 óra de ketten dolgoztak rajta akkor az 1 óra és ha három
 * ilyen tétel van akkor összesen 3 óra".
 *
 * === MIÉRT A `kind` DÖNT, ÉS NEM A `unit` SZÖVEGE ===
 *
 * A `unit` szabad szöveg. Ha az összegzés arra épülne, egy elgépelt "ora", egy
 * nagy kezdőbetűs "Óra" vagy egy "munkaóra" CSENDBEN kimaradna -- és a hibás
 * összeg hihetőnek látszana. Egy szöveg-egyezés minden új elgépelésnél újra
 * téved; egy mező egyszer dől el.
 *
 * === A NEM-MUNKA TÉTEL NULLA, NEM KIMARAD ===
 *
 * Az `OTHER` fajtájú tétel munkaórája `0`, nem `null` és nem hiány. Így az
 * összegzés minden soron végigmegy, és a hívónak nem kell külön szűrnie --
 * a szűrés elfelejtése némán kevesebb összeget adna.
 */

/** A munkaóra tizedesjegye: ugyanaz, mint a mennyiségé (`Decimal(19, 6)`). */
export const WORKSHEET_LABOR_SCALE = WORKSHEET_QUANTITY_SCALE;

export type WorksheetLineKindValue = "LABOR" | "OTHER";

export interface WorksheetLaborInput {
  kind: WorksheetLineKindValue;
  quantity: Prisma.Decimal | number | string;
  workerCount: number;
}

function hours(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(
    WORKSHEET_LABOR_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

/**
 * EGY TÉTEL MUNKAÓRÁJA: `quantity * workerCount`, de csak `LABOR` fajtánál.
 *
 * A `workerCount` a sémában `Int @default(1)`, tehát mindig van értéke. Ha
 * mégis nulla vagy negatív érkezne (kézzel írt adat, régi sor), EGYNEK
 * számít -- az a legkisebb értelmes létszám, és a tétel így NEM esik ki
 * csendben az összegből. A hívó oldalon a DTO `@Min(1)` őrzi ugyanezt.
 */
export function computeWorksheetLineLaborHours(
  input: WorksheetLaborInput,
): Prisma.Decimal {
  if (input.kind !== "LABOR") return new Prisma.Decimal(0);

  const quantity = new Prisma.Decimal(input.quantity);
  const workers =
    Number.isFinite(input.workerCount) && input.workerCount >= 1
      ? Math.trunc(input.workerCount)
      : 1;

  return hours(quantity.mul(workers));
}

/**
 * A LAP ÖSSZESÍTETT MUNKAÓRÁJA: a SOROK kerekített munkaóráinak összege.
 *
 * Ugyanaz a döntés, mint a pénz-összegeknél (`sumWorksheetAmounts`): fordítva
 * -- a nyers szorzatok összegét kerekítve -- a lapon felsorolt tételek nem
 * adnák ki a végösszeget, és a különbséget senki nem tudná megmagyarázni.
 */
export function sumWorksheetLaborHours(
  lines: readonly WorksheetLaborInput[],
): Prisma.Decimal {
  return lines.reduce<Prisma.Decimal>(
    (total, line) => total.plus(computeWorksheetLineLaborHours(line)),
    new Prisma.Decimal(0),
  );
}
