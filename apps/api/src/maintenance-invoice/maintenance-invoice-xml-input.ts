import { Prisma } from "@acropora/database";
import { EU_COUNTRY_NAMES_HU, viesCountry } from "@acropora/types";

import {
  computeCertificateLineAmounts,
  wholeForintCertificateAmounts,
  type CertificateAmounts,
} from "../completion-certificates/completion-certificate-amounts.js";
import { missingAddressParts } from "../customers/address-parts.js";
import { budapestDayKey } from "../dashboard/budapest-day.js";
import type { SzamlazzAgentInvoiceInput } from "../integrations/szamlazz/szamlazz-agent-xml.js";

/**
 * A TELJESÍTÉSI IGAZOLÁS -> SZÁMLÁZZ.HU XML LEKÉPEZÉSE (ADR-014, 4. szelet).
 */

/**
 * AN EU BUYER'S COUNTRY, IN HUNGARIAN (barracuda #2157, 3rd point; card e7806491): Számlázz.hu's `orszag` is free text
 * and the invoice prints it as written, so it goes by its Hungarian name, as on the billing page's invoices
 * (`billing-document-issue.ts`): the address's country when it is an EU one, else the EU tax number's prefix. Nothing
 * when neither is known: an empty country is left out, never guessed.
 */
export function euBuyerCountry(
  addressCountry: string | undefined,
  euTaxNumber: string,
): { country?: string } {
  const code =
    addressCountry && EU_COUNTRY_NAMES_HU[addressCountry]
      ? addressCountry
      : viesCountry(euTaxNumber);
  const name = code ? EU_COUNTRY_NAMES_HU[code] : undefined;
  return name ? { country: name } : {};
}

export interface MaintenanceInvoiceCertificateSource {
  number: string;
  issuedAt: Date;
  serviceJob: {
    customer: {
      id: string;
      displayName: string;
      taxNumber: string | null;
      /** a vevő típusa és partner-tükre: az adószám-kapuhoz (kártya aaf4f09d) */
      type?: string | null;
      euTaxNumber?: string | null;
      partner?: { id: string } | null;
      /** Napban; `null` = az alapérték (`DEFAULT_PAYMENT_DUE_DAYS`). */
      paymentDueDays: number | null;
      addresses: readonly {
        line1: string;
        line2: string | null;
        postalCode: string;
        city: string;
        /** ISO code (HU by default) */
        country?: string;
      }[];
    };
  };
  items: readonly {
    description: string;
    quantity: Prisma.Decimal;
    unitNet: Prisma.Decimal;
    vatRatePercent: Prisma.Decimal;
    /** Megrendelések S2: a megrendeléses TIG sorának egysége; a szervizes soron nincs */
    quantityUnit?: string | null;
  }[];
  /** a számla megjegyzése; alapból a karbantartási TIG mondata */
  comment?: string;
}

export class MaintenanceInvoiceInputError extends Error {
  constructor(
    readonly code:
      "NO_BILLING_ADDRESS" | "BILLING_ADDRESS_INCOMPLETE" | "NO_ITEMS",
    /** Only for BILLING_ADDRESS_INCOMPLETE: the Hungarian names of the blank parts. */
    readonly missing: readonly string[] = [],
  ) {
    super(code);
    this.name = "MaintenanceInvoiceInputError";
  }
}

/**
 * EGY BIZONYLAT-SOR EGYENLŐ EGY XML-TÉTEL, ÉS A TÉTEL MINDIG A TIG SORÁNAK MÁSA: a valódi mennyiség, a TIG-en álló egység és a
 * TIG-en álló egységár (tizedes is). SOHA nem "1 db a sorösszeggel".
 *
 * ACROBOT DÖNTÉSE (61289, Balázs szabálya, emlék 2957: a számla mindig a TIG-gel egyezik): a mennyiség és az egységár az
 * igazolás sora szerint megy, akkor is, ha a mennyiség x egységár szorzata a kerekített sorösszegtől egy kerekítésnyit eltér.
 * Ez a kerekítési különbség a TIG-en is ugyanúgy látszik (az igazolás a sor végösszegét kerekíti egész forintra, nem az
 * egységárat), tehát a számla és a TIG egyformán mutatja, és a sor összege (`nettoErtek`) a TIG sorösszege. Eddig a nem pontos
 * szorzatú sor "1 db, sorösszeg" lett, a nevében a mennyiséggel (barracuda L1): ez megszűnt. Hogy a Számlázz.hu a kerekítésnyi
 * eltérést a tételen elfogadja-e, a teszt OS elő-nézetén mérendő (a kiállítás előtt), nem ebből a kódból tudható.
 *
 * AZ EGYSÉG: az igazoláson álló; az egység nélküli sor (régi, szervizes) "alkalom", ahogy a PDF is írja (barracuda L2), 1-es
 * mennyiségnél is. Eddig az egység nélküli 1-es sor "1 db" volt az igazolás "1 alkalom"-ja helyett.
 */
function mapItem(item: {
  description: string;
  quantity: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
  quantityUnit?: string | null;
}): {
  line: SzamlazzAgentInvoiceInput["items"][number];
  amounts: CertificateAmounts;
} {
  const amounts = wholeForintCertificateAmounts(
    computeCertificateLineAmounts({
      quantity: item.quantity,
      unitPrice: item.unitNet,
      vatRatePercent: item.vatRatePercent,
    }),
    item.vatRatePercent,
  );
  return {
    amounts,
    line: {
      name: item.description,
      quantity: item.quantity.toNumber(),
      unit: item.quantityUnit || "alkalom",
      netUnitPrice: item.unitNet.toNumber(),
      vatRatePercent: item.vatRatePercent.toString(),
      netAmount: amounts.netAmount.toNumber(),
      vatAmount: amounts.vatAmount.toNumber(),
      grossAmount: amounts.grossAmount.toNumber(),
    },
  };
}

export interface MaintenanceInvoiceXmlInput {
  xmlInput: Omit<SzamlazzAgentInvoiceInput, "agentKey" | "previewOnly">;
  totals: CertificateAmounts;
  /**
   * A SOR-ÖSSZEGEK `Prisma.Decimal`-KÉNT, UGYANABBAN A SORRENDBEN, mint a
   * bemeneti `items` -- így az `InvoiceLine` rekord a PONTOS (whole-forint
   * kerekített) értéket kapja, nem az XML-be írt `number` visszaalakítását.
   */
  lineAmounts: readonly CertificateAmounts[];
}

/**
 * A FIZETÉSI FELTÉTELEK, BALÁZS MEGERŐSÍTÉSÉVEL (2026-10-03, pontosítva 2026-11-11).
 *
 * A teljesítés dátuma a teljesítési igazolás kiállításának napja (ez a "teljesítés"
 * ténye maga), a fizetési mód "Átutalás". A fizetési határidő PARTNERENKÉNT
 * állítható (a Partnerek képernyőn, a vevő-tükörre másolva), mert van, aki 8,
 * és van, aki 30 nap alatt fizet. Ahol nincs megadva, ott 8 nap.
 *
 * A HATÁRIDŐ KEZDŐPONTJA A SZÁMLA KELTE, NEM A TIG DÁTUMA (Balázs, 2026-11-10
 * 10:39 UTC, kártya 27d12a67): Luca egy napokkal korábbi TIG-ből állított ki
 * számlát, és a 30 napos határidő 24 lett, mert a napokat a TIG dátumához adtuk.
 * A számla keltét a Számlázz.hu adja (a kérésben nincs `keltDatum`): a kérés
 * napja, ezért a határidő a kérés napjából indul. A napok száma változatlan: a
 * partnerből jön.
 */
export const DEFAULT_PAYMENT_DUE_DAYS = 8;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `yyyy-MM-dd` + napok, naptári számolással (nincs időzóna-eltolás). */
function addCalendarDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function maintenanceInvoiceXmlInputFrom(
  certificate: MaintenanceInvoiceCertificateSource,
  /** A kérés pillanata: a számla kelte (Budapest szerinti napja) ez, a határidő innen indul. */
  now: Date = new Date(),
): MaintenanceInvoiceXmlInput {
  if (certificate.items.length === 0)
    throw new MaintenanceInvoiceInputError("NO_ITEMS");

  const address = certificate.serviceJob.customer.addresses[0];
  if (!address) throw new MaintenanceInvoiceInputError("NO_BILLING_ADDRESS");
  // A customer created at an aquarium may hold an address with blank parts (os-ugyfel-akvarium-hianyos); the
  // draft would otherwise go to Számlázz.hu with an empty zip, city or street.
  const missing = missingAddressParts(address);
  if (missing.length > 0)
    throw new MaintenanceInvoiceInputError(
      "BILLING_ADDRESS_INCOMPLETE",
      missing,
    );

  const mapped = certificate.items.map(mapItem);
  const fulfillmentDate = certificate.issuedAt;
  const dueDate = addCalendarDays(
    budapestDayKey(now),
    certificate.serviceJob.customer.paymentDueDays ?? DEFAULT_PAYMENT_DUE_DAYS,
  );

  return {
    totals: mapped.reduce<CertificateAmounts>(
      (total, item) => ({
        netAmount: total.netAmount.plus(item.amounts.netAmount),
        vatAmount: total.vatAmount.plus(item.amounts.vatAmount),
        grossAmount: total.grossAmount.plus(item.amounts.grossAmount),
      }),
      {
        netAmount: new Prisma.Decimal(0),
        vatAmount: new Prisma.Decimal(0),
        grossAmount: new Prisma.Decimal(0),
      },
    ),
    xmlInput: {
      paymentDueDate: dueDate,
      // the TIG's day in Budapest, not in UTC: one issued after midnight there was the day before in UTC (barracuda
      // 46870, card 6c957695)
      fulfillmentDate: budapestDayKey(fulfillmentDate),
      paymentMethod: "Átutalás",
      currency: "HUF",
      orderNumber: certificate.number,
      comment:
        certificate.comment ??
        `Karbantartási teljesítési igazolás: ${certificate.number}`,
      seller: {},
      buyer: {
        name: certificate.serviceJob.customer.displayName,
        zip: address.postalCode,
        city: address.city,
        address: [address.line1, address.line2]
          .filter((part): part is string => Boolean(part))
          .join(", "),
        taxNumber: certificate.serviceJob.customer.taxNumber ?? undefined,
        // a külföldi partner tükre a közösségi adószámot viseli (`mirroredTaxNumber`)
        ...(!certificate.serviceJob.customer.taxNumber?.trim() &&
        certificate.serviceJob.customer.euTaxNumber?.trim()
          ? {
              euTaxNumber: certificate.serviceJob.customer.euTaxNumber.trim(),
              vatSubject: 6,
              ...euBuyerCountry(
                address.country,
                certificate.serviceJob.customer.euTaxNumber.trim(),
              ),
            }
          : {}),
        taxSubject: {
          type: certificate.serviceJob.customer.type ?? null,
          partnerMirror: Boolean(certificate.serviceJob.customer.partner),
        },
      },
      items: mapped.map((item) => item.line),
    },
    lineAmounts: mapped.map((item) => item.amounts),
  };
}
