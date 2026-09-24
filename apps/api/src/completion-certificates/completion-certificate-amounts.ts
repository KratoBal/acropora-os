import { Prisma } from "@acropora/database";

/**
 * A pénz-oszlopok tizedesjegye. Ugyanaz a mintát követi, mint a
 * `worksheets/worksheet-amounts.ts`: a nettó a NYERS szorzatból (mennyiség x
 * egységár) kerekül, az ÁFA a KEREKÍTETT nettóból, nem a nyers szorzatból --
 * a lapon a nettó az, ami látszik, és az ügyfél abból ellenőrzi az ÁFA-t. Ha
 * az ÁFA egy nem mutatott, pontosabb értékből jönne, a papíron kiadott három
 * szám nem adná ki egymást.
 *
 * SZÁNDÉKOSAN NEM A `worksheets/worksheet-amounts.ts`-t importáljuk: az a
 * `WorksheetLine` mezőneveihez (`unitNet`) kötött, és ez a modul ÖNÁLLÓ marad
 * -- a bekötés, amikor megtörténik, dönthet úgy is, hogy a kettőt egyesíti,
 * de az egy külön döntés.
 */
export const CERTIFICATE_MONEY_SCALE = 2;

export type DecimalInput = Prisma.Decimal | number | string;

export interface CertificateAmounts {
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
}

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(
    CERTIFICATE_MONEY_SCALE,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}

/**
 * EGY TÉTEL ÖSSZEGEI. Mindig `Prisma.Decimal`-lal számol, sosem `number`-rel
 * -- egy natív lebegőpontos szorzás ugyanezen a bemeneten (mennyiség x
 * egységár) látható, hibás tizedesjegyeket adna, lásd a spec kalibrációját.
 */
export function computeCertificateLineAmounts(input: {
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  vatRatePercent: DecimalInput;
}): CertificateAmounts {
  const quantity = new Prisma.Decimal(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const vatRatePercent = new Prisma.Decimal(input.vatRatePercent);

  const netAmount = money(quantity.mul(unitPrice));
  const vatAmount = money(netAmount.mul(vatRatePercent).div(100));

  return { netAmount, vatAmount, grossAmount: netAmount.plus(vatAmount) };
}

/**
 * A FEJLÉC ÖSSZEGEI A SOROK KEREKÍTETT ÉRTÉKEINEK ÖSSZEGEI. Fordítva (a
 * nyers szorzatok összegét kerekítve) a lapon felsorolt tételek nem adnák ki
 * a végösszeget, és a különbséget senki nem tudná megmagyarázni.
 */
export function sumCertificateAmounts(
  lines: readonly CertificateAmounts[],
): CertificateAmounts {
  return lines.reduce<CertificateAmounts>(
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
