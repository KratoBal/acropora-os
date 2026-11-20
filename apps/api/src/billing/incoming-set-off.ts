import { Prisma } from "@acropora/database";

import { hungarianTaxBase } from "../purchasing/nav-incoming-invoices/nav-incoming-invoice.types.js";

/**
 * A FUTÁR LEVONTA A DÍJSZÁMLÁJÁT AZ UTÁNVÉT-UTALÁSBÓL: a bejövő Foxpost és GLS díjszámla kifizetett (Balázs, 2026-10-01 21:35 UTC, emlék 1994; acrobot
 * 58315, 58343). TISZTA FÜGGVÉNY: az adatbázishoz nem nyúl, a betöltő (`loadSetOffInputs`) adja a bemenetet.
 *
 * A MÉRT TÉNY (élesen, acrobot 58343, 2026-11-20): a bankban szeptember óta CSAK jóváírás van a Foxpost és a GLS felől (heti utánvét-utalás), egyetlen
 * terhelés sincs. Mindkettő LEVONJA a díját az utalásból, tehát a díjszámlához soha nem lesz banki terhelés, és a Hiányzó számlák párosítása
 * (terhelés -> számla) soha nem találhat párt: a számla örökre „Nincs fizetve” maradt (18 számla, a Lejáró számlák listáján is).
 *
 * MIKOR KIFIZETETT EGY DÍJSZÁMLA (mindkét útnál ugyanaz az elv, mint a kimenő utánvét-jelölésnél: nem találgat, ha bármelyik feltétel nem áll):
 *
 * FOXPOST (`FoxpostSettlement`: az elszámolás levele egy XLSX-ből és a díjszámla PDF-jéből áll):
 *   1. az elszámolás teljesen olvasott (COMPLETED vagy NEEDS_REVIEW), és megnevezi a díjszámlát (`invoiceNumber`);
 *   2. a saját összegei egyeznek: a sorok összege a beszedett, és a beszedett MÍNUSZ a díjszámla bruttója az átutalt;
 *   3. pontosan EGY banki jóváírás nevezi meg az elszámolást (`FOXPOST 26H38`), és pontosan az átutalt összeg;
 *   4. a bejövő számla bruttója a díjszámla bruttója (1 Ft-on belül, forintban).
 *   A nap a jóváírás könyvelési napja.
 *
 * GLS (`GlsCompensationLetter`: a GLS a saját nyitott számláit beszámítja a beszedett utánvétbe, és csak a különbséget utalja):
 *   1. a levél minden hivatkozása GLS-számlaszám (`HU` és nyolc számjegy): más (például egy csomag) lehet a vevő pénze;
 *   2. a levél a nyitott tartozást TELJESEN beszámította (`remaining` nulla), és a saját összegei egyeznek (beszedett mínusz beszámított az átutalt);
 *   3. a levél beszedettje az aznapi utánvét-részletező összege;
 *   4. pontosan EGY banki jóváírás aznap, pontosan az átutalt összeg;
 *   5. a hivatkozott számlák bruttóinak összege a beszámított összeg (1 Ft-on belül), és MINDEGYIK számla ismert: részleges beszámítást, vagy egy
 *      később beszámított maradékot nem jelölünk kifizetettnek.
 *   A nap a beszámítás napja (egyben az utalásé).
 */

export interface SetOffPayment {
  /** `ÉÉÉÉ-HH-NN`: a jóváírás, illetve a beszámítás napja */
  readonly day: string;
  readonly carrier: "FOXPOST" | "GLS";
  /** az elszámolás kódja (Foxpost) vagy a beszámítás napja (GLS), a „miből” kimondására */
  readonly reference: string;
}

export interface FoxpostSetOffInput {
  readonly settlementCode: string | null;
  readonly status: string;
  readonly invoiceNumber: string | null;
  readonly invoiceGrossAmount: Prisma.Decimal | null;
  readonly collectedAmount: Prisma.Decimal | null;
  readonly transferredAmount: Prisma.Decimal | null;
  readonly currency: string;
  /** a sorok beszedett összegeinek összege */
  readonly lineSum: Prisma.Decimal;
  /** az elszámolást megnevező banki jóváírások */
  readonly credits: readonly {
    readonly amount: Prisma.Decimal;
    readonly bookingDate: string;
  }[];
}

export interface GlsSetOffInput {
  /** a beszámítás napja, `ÉÉÉÉ-HH-NN` */
  readonly day: string;
  readonly currency: string;
  readonly cod: Prisma.Decimal;
  readonly compensated: Prisma.Decimal;
  readonly transferred: Prisma.Decimal;
  readonly remaining: Prisma.Decimal;
  readonly references: readonly string[];
  /** az aznapi utánvét-részletező összege; `null`, ha nincs */
  readonly reportTotal: Prisma.Decimal | null;
  /** az aznapi utánvét-utalásra utaló banki jóváírások */
  readonly credits: readonly { readonly amount: Prisma.Decimal }[];
}

export interface SetOffInvoice {
  readonly gross: Prisma.Decimal;
  readonly currency: string;
}

const GLS_INVOICE = /^HU\d{8}$/;

/**
 * A SZÁMLA KULCSA A SZÁLLÍTÓ ÉS A SZÁM (barracuda, #2788 review): egy számlaszám csak a kiállítón belül egyedi, és a GLS száma egy EU-adószám alakja is
 * lehet (#2766). Szám szerint kötve egy MÁSIK szállító azonos számú számlája felülírná a Foxpost/GLS sorát a térképben, vagy futár-levonást kapna banki
 * terhelés nélkül. A két futár adószám-törzse ugyanaz, mint a Hiányzó számlák elszámolás-levonásánál (`missing-invoices.repository.ts`,
 * `FOXPOST_TAX_BASE`, `GLS_TAX_BASE`, mérve 2026-09-30 a NAV bejövő exportján); a spec egyezésüket őrzi.
 */
export const FOXPOST_SUPPLIER_BASE = "32435119";
export const GLS_SUPPLIER_BASE = "12369410";

/** A bejövő sor kulcsa: ugyanaz, mint amivel a betöltő és a szabály jelöl. */
export const setOffKeyOf = (row: {
  documentNumber: string;
  supplierTaxNumber: string | null;
}) => setOffKey(row.supplierTaxNumber, row.documentNumber);

/** A szállító nélküli (ismeretlen vagy nem magyar adószámú) sor kulcsa soha nem egyezik a futáréval. */
export const setOffKey = (
  supplierTaxNumber: string | null | undefined,
  documentNumber: string,
) => `${hungarianTaxBase(supplierTaxNumber) ?? ""}|${documentNumber}`;
const TOLERANCE = new Prisma.Decimal(1);
const close = (a: Prisma.Decimal, b: Prisma.Decimal) =>
  a.minus(b).abs().lte(TOLERANCE);

export function incomingSetOffPayments(input: {
  foxpost: readonly FoxpostSetOffInput[];
  gls: readonly GlsSetOffInput[];
  /** a bejövő számlák `setOffKey` szerint (szállító + szám): bruttó és pénznem */
  invoices: ReadonlyMap<string, SetOffInvoice>;
}): Map<string, SetOffPayment> {
  const out = new Map<string, SetOffPayment>();

  for (const settlement of input.foxpost) {
    const {
      invoiceNumber,
      invoiceGrossAmount,
      collectedAmount,
      transferredAmount,
    } = settlement;
    // A NEEDS_REVIEW elég: egyetlen oka van (`FOXPOST_ORDER_INVOICE_REVIEW_REQUIRED`), és az a sorok MEGRENDELÉS- és számla-feloldásáról szól
    // (`foxpost-settlement.repository.ts`), nem a pénzről. A díjszámla és az összegek a levélből és a PDF-ből jönnek, azokat az alábbi összeg-ellenőrzés
    // és a pontosan egy jóváírás önállóan bizonyítja. A PROCESSING és az ERROR olvasatlan vagy hibás: azok nem.
    if (
      (settlement.status !== "COMPLETED" &&
        settlement.status !== "NEEDS_REVIEW") ||
      !invoiceNumber ||
      !settlement.settlementCode ||
      !invoiceGrossAmount ||
      !collectedAmount ||
      !transferredAmount
    )
      continue;
    if (
      !settlement.lineSum.equals(collectedAmount) ||
      !collectedAmount.minus(invoiceGrossAmount).equals(transferredAmount)
    )
      continue;
    const credits = settlement.credits.filter((credit) =>
      credit.amount.equals(transferredAmount),
    );
    if (credits.length !== 1) continue;
    const invoiceKey = setOffKey(FOXPOST_SUPPLIER_BASE, invoiceNumber);
    const invoice = input.invoices.get(invoiceKey);
    if (
      !invoice ||
      invoice.currency !== "HUF" ||
      settlement.currency !== "HUF" ||
      !close(invoice.gross, invoiceGrossAmount)
    )
      continue;
    out.set(invoiceKey, {
      day: credits[0]!.bookingDate,
      carrier: "FOXPOST",
      reference: settlement.settlementCode,
    });
  }

  for (const letter of input.gls) {
    if (
      letter.currency !== "HUF" ||
      letter.references.length === 0 ||
      !letter.references.every((reference) => GLS_INVOICE.test(reference))
    )
      continue;
    if (
      !letter.remaining.isZero() ||
      !letter.cod.minus(letter.compensated).equals(letter.transferred)
    )
      continue;
    if (!letter.reportTotal || !letter.reportTotal.equals(letter.cod)) continue;
    const credits = letter.credits.filter((credit) =>
      credit.amount.equals(letter.transferred),
    );
    if (credits.length !== 1) continue;
    const known = letter.references.map((reference) => {
      const key = setOffKey(GLS_SUPPLIER_BASE, reference);
      return { key, invoice: input.invoices.get(key) };
    });
    if (known.some((k) => !k.invoice || k.invoice.currency !== "HUF")) continue;
    const sum = known.reduce(
      (total, k) => total.plus(k.invoice!.gross),
      new Prisma.Decimal(0),
    );
    if (!close(sum, letter.compensated)) continue;
    for (const k of known)
      out.set(k.key, {
        day: letter.day,
        carrier: "GLS",
        reference: letter.day,
      });
  }
  return out;
}
