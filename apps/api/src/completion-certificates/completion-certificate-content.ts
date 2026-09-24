import { Prisma } from "@acropora/database";

import {
  computeCertificateLineAmounts,
  sumCertificateAmounts,
  type CertificateAmounts,
} from "./completion-certificate-amounts.js";
import type { CompletionCertificateInput } from "./completion-certificate-types.js";

/**
 * A DÁTUM ALAKJA A MINTÁN "ÉÉÉÉ-HH-NN" (pl. "2026-07-28"), NEM a magyar
 * hosszú forma ("2026. július 28."), amit a hibajegy PDF-je használ máshol.
 * Ezt a mintáról mértem, nem találgattam.
 *
 * === A NAPTÁRI NAP BUDAPESTI IDŐ SZERINT ÁLL, NEM UTC SZERINT ===
 *
 * EZ A FÁJL KORÁBBAN `getUTCFullYear`/`getUTCMonth`/`getUTCDate`-tel olvasta
 * ki a napot -- acrobot mérése (nautilus PR #1046-jának átnézésekor jött ki,
 * és mindkettőnkre állt): egy `2026-07-28T22:30:00Z` bélyeg Budapesten MÁR
 * 07-29, tehát az UTC-s olvasás egy éjfél körüli generáláson rossz napot írt
 * volna egy aláírandó dokumentumra.
 *
 * A HELYES MINTA MÁR A KÓDBÁZISBAN ÁLLT:
 * `worksheets/worksheet-sheet-content.ts` `sheetDate()`-je, ugyanazzal a
 * zónás `Intl.DateTimeFormat` formázóval -- ezt a mintát követi ez a
 * függvény is, csak nem importálja onnan (lásd a fájl fejlécében a döntést,
 * hogy ez a szelet önálló marad).
 */
const HU_DATE = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Budapest",
});

export function isoDate(value: Date): string {
  return HU_DATE.format(value).replace(/\. /g, "-").replace(/\.$/, "");
}

const groupedNumber = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 0,
});

/**
 * EZREDES TAGOLÁS, SZÓKÖZZEL -- de `Intl.NumberFormat("hu-HU")` NEM sima
 * ASCII szóközt (0x20) ad tagolónak, hanem törésmentes szóközt (U+00A0).
 * Mérve. Ez a PDF-ben és a visszaolvasó tesztben is meglepetést okozna
 * (a keresett `"2 100 000"` -- sima szóközzel -- SOSEM találná meg a
 * PDF szövegét, amiben a szám tagolója `\u00a0`, nem `0x20`), ezért itt
 * egységesen sima szóközre cseréljük.
 */
export function formatHuf(amount: Prisma.Decimal): string {
  return groupedNumber.format(amount.toNumber()).replace(/\u00a0/g, " ");
}

export interface CompletionCertificateLine {
  description: string;
  detail: string | null;
  contractNumber: string | null;
  quantityLabel: string;
  unitPriceLabel: string;
  vatRateLabel: string;
  netLabel: string;
  amounts: CertificateAmounts;
}

export interface CompletionCertificateTotals {
  netLabel: string;
  vatLabel: string;
  grossLabel: string;
  amounts: CertificateAmounts;
}

export interface CompletionCertificateContent {
  certificateNumber: string;
  issuedAtLabel: string;
  completedAtLabel: string;
  subject: string;
  worksheetReference: string | null;
  customerName: string;
  customerAddressLines: readonly string[];
  customerTaxNumber: string | null;
  customerContactLine: string | null;
  lines: readonly CompletionCertificateLine[];
  totals: CompletionCertificateTotals;
  signerName: string | null;
  signerEmail: string | null;
}

/**
 * A NYERS BEMENETBŐL A LAPON MEGJELENŐ SZÖVEG -- TISZTA FÜGGVÉNY, pdfkit
 * import nélkül, ugyanúgy, ahogy a `service-job-sheet-content.ts` is elválik
 * a rajzolástól. Így a tartalom (számolás, formázás) a lap felrajzolása
 * nélkül is mérhető.
 */
export function completionCertificateContent(
  input: CompletionCertificateInput,
): CompletionCertificateContent {
  const lines = input.items.map((item): CompletionCertificateLine => {
    const amounts = computeCertificateLineAmounts({
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRatePercent: item.vatRatePercent,
    });
    const quantity = new Prisma.Decimal(item.quantity);
    const vatRatePercent = new Prisma.Decimal(item.vatRatePercent);
    return {
      description: item.description,
      detail: item.detail ?? null,
      contractNumber: item.contractNumber ?? null,
      quantityLabel: `${quantity.toString()} ${item.quantityUnit}`,
      unitPriceLabel: formatHuf(new Prisma.Decimal(item.unitPrice)),
      vatRateLabel: `${vatRatePercent.toString()}%`,
      netLabel: formatHuf(amounts.netAmount),
      amounts,
    };
  });

  const totalAmounts = sumCertificateAmounts(lines.map((line) => line.amounts));

  return {
    certificateNumber: input.certificateNumber,
    issuedAtLabel: isoDate(input.issuedAt),
    completedAtLabel: isoDate(input.completedAt),
    subject: input.subject,
    worksheetReference: input.worksheetReference ?? null,
    customerName: input.customer.name,
    customerAddressLines: input.customer.addressLines,
    customerTaxNumber: input.customer.taxNumber ?? null,
    customerContactLine: input.customer.contactLine ?? null,
    lines,
    totals: {
      netLabel: `${formatHuf(totalAmounts.netAmount)} HUF`,
      vatLabel: `${formatHuf(totalAmounts.vatAmount)} HUF`,
      grossLabel: `${formatHuf(totalAmounts.grossAmount)} HUF`,
      amounts: totalAmounts,
    },
    signerName: input.signerName ?? null,
    signerEmail: input.signerEmail ?? null,
  };
}
