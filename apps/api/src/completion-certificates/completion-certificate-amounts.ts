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
 *
 * A SKÁLA 2-RŐL 4-RE VÁLTOZOTT (nautilus, a karbantartás 3. szeletének
 * bekötésekor, 2026-09-24, a 679d4c04 kanban-kártya jegyzete alapján): a
 * tételek EZENTÚL a `ContractItem.unitNet` oszlopból jönnek, ami a sémán
 * `Decimal(19, 4)` -- egy 2 tizedesjegyes belső kerekítés itt már a FORRÁS
 * pontosságát vágná le, mielőtt bármi kiírásra kerülne.
 */
export const CERTIFICATE_MONEY_SCALE = 4;

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
 * TELJES FORINTRA KEREKÍTETT ÖSSZEGEK, TÉTELENKÉNT -- A SZÁMLÁVAL EGYEZŐ
 * SZABÁLY (679d4c04 kártya, acrobot döntése, 2026-09-24: "a SZÁMLA a
 * mérvadó").
 *
 * === MIÉRT KÜLÖN LÉPÉS, ÉS NEM ELÉG A KIJELZÉS KEREKÍTÉSE ===
 *
 * A Számlázz.hu TÉTELENKÉNT egész forintra kerekít, MAJD összead. Ha ez a
 * modul a 4 tizedesjegyes pontos összegeket adná össze és csak a VÉGÖSSZEGET
 * kerekítené 0 tizedesjegyre a kijelzéskor, a két módszer -- kerekítve
 * összegezve kontra összegezve kerekítve -- 1 FORINTTAL eltérhet egymástól
 * (a kártya jegyzete: "Több tételnél 1 Ft eltérés jöhet"). A teljesítési
 * igazolás és a belőle kiállított számla ekkor két különböző számot mutatna
 * ugyanarra a munkára.
 *
 * Ezért a nyomtatott és összegzett értékek EBBŐL a függvényből jönnek, a
 * pontos `CertificateAmounts`-ból SOSEM közvetlenül.
 */
export function wholeForintCertificateAmounts(
  amounts: CertificateAmounts,
): CertificateAmounts {
  const round = (value: Prisma.Decimal) =>
    value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return {
    netAmount: round(amounts.netAmount),
    vatAmount: round(amounts.vatAmount),
    grossAmount: round(amounts.grossAmount),
  };
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
