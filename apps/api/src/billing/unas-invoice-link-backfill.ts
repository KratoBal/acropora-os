import type { UnasApiOrder } from "@acropora/types";

/**
 * A WEBSHOP-SZÁMLÁK LINKJE VISSZAMENŐLEG A UNAS-RENDELÉSEKBŐL (785dfea6, acrobot 58605, 58609). Az `Invoice` (source UNAS) sort a
 * rendelés-szinkron írja, de csak a saját kurzorától: élesen az első linkes szám az ACRW-2026/00406 (július), januártól júniusig
 * nincs sor, ezért a `--unas-link` PDF-kitöltő ott nem talált semmit (2026-01: 75 ACRW-szám, 0 link).
 *
 * EZ A PARANCS CSAK A SZÁMLASZÁMOT ÉS A LINKET ÍRJA, SEMMI MÁST: nem nyúl a rendeléshez, a státuszhoz, a készlethez, és a UNAS
 * felé sem ír (a rendelésenkénti `refreshOrder` a készletet is újraközölné: élő boltba írás). Rendelésenként:
 *
 *   NINCS_SZAMLA      a rendeléshez nincs számlaszám vagy link a UNAS-ban: nincs mit írni
 *   MAR_VAN           a számla sora megvan, linkkel: nem ír
 *   LINK_POTOLNA      a sor megvan, link nélkül: a linket írná (csak ha még üres)
 *   SOR_LENNE         nincs sor: új `Invoice` (OUTBOUND, source UNAS) a számlaszámmal és a linkkel; a helyi rendeléshez kötve, ha
 *                     megvan (`rendeles`), különben rendelés nélkül (`rendeles nelkul`)
 *
 * Alapból SZÁRAZ; az `--apply` ír. A link nem kerül a kimenetbe (token lehet benne). A sorok a számlaszámmal kezdődnek, hogy a
 * PDF-kitöltő kimenetével összevethetők legyenek.
 */

export interface InvoiceLinkStore {
  /** Az `Invoice` (source UNAS) sor ezzel a számmal, ha van, és hogy van-e linkje. */
  existing(number: string): Promise<{ hasUrl: boolean } | null>;
  /** A helyi rendelés id-je a UNAS-rendelés stabil `Id`-je (régi soroknál a `Key`) szerint; null, ha nincs, vagy törölt. */
  localOrderId(order: Pick<UnasApiOrder, "id" | "key">): Promise<string | null>;
  /** A link a meglévő sorra, CSAK ha még üres; `false`, ha közben valaki kitöltötte. */
  setUrlIfEmpty(number: string, url: string): Promise<boolean>;
  /** Új sor; `false`, ha közben létrejött (egyedi kulcs: source + szám). */
  create(input: {
    number: string;
    url: string;
    salesOrderId: string | null;
    partnerName: string;
    partnerTaxNumber: string | null;
    currency: string;
  }): Promise<boolean>;
}

export type InvoiceLinkOutcome =
  | "NINCS_SZAMLA"
  | "MAR_VAN"
  | "LINK_POTOLNA"
  | "LINK_POTOLVA"
  | "SOR_LENNE"
  | "SOR_IRVA"
  | "KOZBEN_MEGVOLT";

export interface InvoiceLinkReport {
  orders: number;
  counts: Record<InvoiceLinkOutcome, number>;
}

const emptyCounts = (): Record<InvoiceLinkOutcome, number> => ({
  NINCS_SZAMLA: 0,
  MAR_VAN: 0,
  LINK_POTOLNA: 0,
  LINK_POTOLVA: 0,
  SOR_LENNE: 0,
  SOR_IRVA: 0,
  KOZBEN_MEGVOLT: 0,
});

/** Egy lap rendelés feldolgozása. A `prefix` (pl. `ACRW-2026/`) szűkít: más számú számlához nem nyúl. */
export async function backfillInvoiceLinks(input: {
  orders: readonly UnasApiOrder[];
  store: InvoiceLinkStore;
  apply: boolean;
  prefix: string | null;
  out: (line: string) => void;
  report: InvoiceLinkReport;
}): Promise<void> {
  const { store, apply, out, report } = input;
  for (const order of input.orders) {
    report.orders += 1;
    const number = order.invoiceNumber?.trim() ?? "";
    const url = order.invoiceUrl?.trim() ?? "";
    if (!number || !url) {
      report.counts.NINCS_SZAMLA += 1;
      continue;
    }
    if (input.prefix && !number.startsWith(input.prefix)) continue;
    const existing = await store.existing(number);
    let outcome: InvoiceLinkOutcome;
    let detail = "";
    if (existing?.hasUrl) {
      outcome = "MAR_VAN";
    } else if (existing) {
      outcome = !apply
        ? "LINK_POTOLNA"
        : (await store.setUrlIfEmpty(number, url))
          ? "LINK_POTOLVA"
          : "KOZBEN_MEGVOLT";
    } else {
      const salesOrderId = await store.localOrderId(order);
      detail = salesOrderId ? " rendeles" : " rendeles nelkul";
      outcome = !apply
        ? "SOR_LENNE"
        : (await store.create({
              number,
              url,
              salesOrderId,
              partnerName:
                order.buyerInvoiceName?.trim() ||
                order.customerName?.trim() ||
                "-",
              partnerTaxNumber: order.buyerTaxNumber?.trim() || null,
              currency: order.currency?.trim() || "HUF",
            }))
          ? "SOR_IRVA"
          : "KOZBEN_MEGVOLT";
    }
    report.counts[outcome] += 1;
    if (outcome !== "MAR_VAN")
      out(`${outcome.padEnd(15)} ${number}${detail}\n`);
  }
}

export const newInvoiceLinkReport = (): InvoiceLinkReport => ({
  orders: 0,
  counts: emptyCounts(),
});

export const UNAS_INVOICE_LINK_USAGE = `A webshop-szamlak linkje visszamenoleg a UNAS-rendelesekbol (csak szamlaszam es link az Invoice-ba).

  node dist/billing/unas-invoice-link-backfill.cli.js --tol 2026-01-01 [--ig 2026-07-01] [--elotag ACRW-2026/] [--apply]

  --tol      a UNAS-rendelesek modositasi idejenek kezdete (UTC nap), kotelezo
  --ig       a vege (UTC nap, nem benne), elhagyhato
  --elotag   csak az ilyen kezdetu szamlaszamokhoz nyul
  --apply    ir; nelkule szaraz futas

Kilepes: 0 nincs (tobb) teendo, 1 szaraz futas es lenne mit irni, 2 hibas hivas vagy UNAS-hiba.
`;
