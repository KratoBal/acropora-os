import { Prisma } from "@acropora/database";

/** A pénz-oszlopok tizedesjegye a sémában (`Decimal(19, 4)`). */
export const WORKSHEET_MONEY_SCALE = 4;

/** A mennyiség tizedesjegye a sémában (`Decimal(19, 6)`). */
export const WORKSHEET_QUANTITY_SCALE = 6;

export type DecimalInput = Prisma.Decimal | number | string;

export interface WorksheetAmounts {
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
}

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(
    WORKSHEET_MONEY_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

/**
 * Egy tétel összegei. Az ÁFA a KEREKÍTETT nettóból számol, nem a nyers
 * szorzatból: a dokumentumon a nettó az, ami látszik, és az ügyfél abból
 * ellenőrzi az ÁFA-t. Ha az ÁFA egy nem mutatott, pontosabb értékből jönne,
 * a papíron kiadott három szám nem adná ki egymást.
 */
export function computeWorksheetLineAmounts(input: {
  quantity: DecimalInput;
  unitNet: DecimalInput;
  vatRatePercent: DecimalInput;
}): WorksheetAmounts {
  const quantity = new Prisma.Decimal(input.quantity);
  const unitNet = new Prisma.Decimal(input.unitNet);
  const vatRatePercent = new Prisma.Decimal(input.vatRatePercent);

  const netAmount = money(quantity.mul(unitNet));
  const vatAmount = money(netAmount.mul(vatRatePercent).div(100));

  return { netAmount, vatAmount, grossAmount: netAmount.plus(vatAmount) };
}

/**
 * A fejléc összegei a SOROK kerekített értékeinek összegei. Fordítva (a nyers
 * szorzatok összegét kerekítve) a lapon felsorolt tételek nem adnák ki a
 * végösszeget, és a különbséget senki nem tudná megmagyarázni.
 */
export function sumWorksheetAmounts(
  lines: readonly WorksheetAmounts[],
): WorksheetAmounts {
  return lines.reduce<WorksheetAmounts>(
    (total, line) => ({
      netAmount: total.netAmount.plus(line.netAmount),
      vatAmount: total.vatAmount.plus(line.vatAmount),
      grossAmount: total.grossAmount.plus(line.grossAmount),
    }),
    {
      netAmount: new Prisma.Decimal(0),
      vatAmount: new Prisma.Decimal(0),
      grossAmount: new Prisma.Decimal(0),
    },
  );
}
