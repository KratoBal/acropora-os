import { Prisma } from "@acropora/database";

/**
 * A megrendelőlap pénz-tizedesjegye. A KARBANTARTÁSI KERETSZERZŐDÉS tételei
 * ma egész forintban állnak (lásd a minta-megrendelőlapot:
 * `exchange/minta-megrendelolap-allatkert.docx`), de a számolás így is
 * `Decimal`-lal megy, nem `number`-rel: egy 27%-os ÁFA-szorzás lebegőponton
 * kerekítési hibát adhat, és ez a lap az, amit az ügyfél alá is ír.
 *
 * A skála a `worksheet-amounts.ts` mintáját követi (`Decimal(19, 4)`), hogy a
 * két pénz-számoló ugyanazt a kerekítési szabályt vigye, ha valaha közös
 * helperré vonnák össze őket.
 */
export const MAINTENANCE_ORDER_FORM_MONEY_SCALE = 4;

export type MaintenanceOrderFormDecimalInput = Prisma.Decimal | number | string;

export interface MaintenanceOrderFormItemAmounts {
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
}

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(
    MAINTENANCE_ORDER_FORM_MONEY_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

/**
 * EGY TÉTEL DÍJA: egységár szorozva a darabszámmal ÉS az évi alkalommal.
 *
 * A minta-lap "díj összesen" oszlopa pontosan ez a szorzat (pl. "Cápasuli
 * nagymedence": 475 000 Ft x 1 db x 4 alkalom = 1 900 000 Ft), az ÁFA pedig a
 * KEREKÍTETT nettóból számol, ugyanazért, amiért a munkalap-tételeknél is:
 * a lapon kiírt nettó és ÁFA szorzatból kell kiadnia magát, nem egy rejtett,
 * pontosabb közbenső értékből.
 */
export function computeMaintenanceOrderFormItemAmounts(input: {
  unitPricePerOccasion: MaintenanceOrderFormDecimalInput;
  quantity: MaintenanceOrderFormDecimalInput;
  occasionsPerYear: MaintenanceOrderFormDecimalInput;
  vatRatePercent: MaintenanceOrderFormDecimalInput;
}): MaintenanceOrderFormItemAmounts {
  const unitPricePerOccasion = new Prisma.Decimal(input.unitPricePerOccasion);
  const quantity = new Prisma.Decimal(input.quantity);
  const occasionsPerYear = new Prisma.Decimal(input.occasionsPerYear);
  const vatRatePercent = new Prisma.Decimal(input.vatRatePercent);

  const netAmount = money(
    unitPricePerOccasion.mul(quantity).mul(occasionsPerYear),
  );
  const vatAmount = money(netAmount.mul(vatRatePercent).div(100));

  return { netAmount, vatAmount, grossAmount: netAmount.plus(vatAmount) };
}

/**
 * A FEJLÉC ÖSSZESÍTŐI A SOROK KEREKÍTETT ÉRTÉKEINEK ÖSSZEGEI, nem a nyers
 * szorzatoké -- ugyanaz az indok, mint a munkalapnál: a lapon felsorolt
 * tételeknek ki kell adniuk a végösszeget.
 */
export function sumMaintenanceOrderFormAmounts(
  items: readonly MaintenanceOrderFormItemAmounts[],
): MaintenanceOrderFormItemAmounts {
  return items.reduce<MaintenanceOrderFormItemAmounts>(
    (total, item) => ({
      netAmount: total.netAmount.plus(item.netAmount),
      vatAmount: total.vatAmount.plus(item.vatAmount),
      grossAmount: total.grossAmount.plus(item.grossAmount),
    }),
    {
      netAmount: new Prisma.Decimal(0),
      vatAmount: new Prisma.Decimal(0),
      grossAmount: new Prisma.Decimal(0),
    },
  );
}
