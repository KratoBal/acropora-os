import { Prisma } from "@acropora/database";

import {
  computeCertificateLineAmounts,
  wholeForintCertificateAmounts,
  type CertificateAmounts,
} from "../completion-certificates/completion-certificate-amounts.js";
import type { SzamlazzAgentInvoiceInput } from "../integrations/szamlazz/szamlazz-agent-xml.js";

/**
 * A TELJESÍTÉSI IGAZOLÁS -> SZÁMLÁZZ.HU XML LEKÉPEZÉSE (ADR-014, 4. szelet).
 */

export interface MaintenanceInvoiceCertificateSource {
  number: string;
  issuedAt: Date;
  serviceJob: {
    customer: {
      id: string;
      displayName: string;
      taxNumber: string | null;
      addresses: readonly {
        line1: string;
        line2: string | null;
        postalCode: string;
        city: string;
      }[];
    };
  };
  items: readonly {
    description: string;
    quantity: Prisma.Decimal;
    unitNet: Prisma.Decimal;
    vatRatePercent: Prisma.Decimal;
  }[];
}

export class MaintenanceInvoiceInputError extends Error {
  constructor(readonly code: "NO_BILLING_ADDRESS" | "NO_ITEMS") {
    super(code);
    this.name = "MaintenanceInvoiceInputError";
  }
}

/**
 * EGY BIZONYLAT-SOR EGYENLŐ EGY XML-TÉTEL, MENNYISÉG MINDIG 1.
 *
 * A Számlázz.hu Agent API tételenként ellenőriz: `nettoEgysegar × mennyiseg
 * = nettoErtek` (lásd generating_invoice_xml.txt). A teljesítési igazolás
 * viszont a SAJÁT mennyiségét (pl. "3 alkalom") és EGYSÉGÁRÁT tartja --
 * `wholeForintCertificateAmounts` a SOR (mennyiség × egységár) végösszegét
 * kerekíti egész forintra, nem az egységárat. Ha a mennyiség nem 1, az
 * egységár × mennyiség szorzat a kerekítés UTÁN már nem feltétlenül adja ki
 * pontosan a kerekített sorösszeget.
 *
 * Ezért a leképezés minden bizonylat-sort EGY XML-tételnek felel meg,
 * mennyiség=1-gyel és egységár=a kerekített sorösszeg: ez garantáltan
 * kielégíti a Számlázz.hu azonosságát, és pontosan azt az összeget viszi,
 * ami a teljesítési igazoláson is áll (ugyanaz a kerekítési szabály, ADR-014
 * "a számla a mérvadó" pontja).
 */
function mapItem(item: {
  description: string;
  quantity: Prisma.Decimal;
  unitNet: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
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
  );
  return {
    amounts,
    line: {
      name: item.description,
      quantity: 1,
      unit: "db",
      netUnitPrice: amounts.netAmount.toNumber(),
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
 * A FIZETÉSI FELTÉTELEK MA FELTÉTELEZETT ÉRTÉKEK, NEM MÉRT ÜZLETI SZABÁLY.
 *
 * A teljesítés dátuma a bizonylat kiállításának napja (ez a "teljesítés"
 * ténye maga). A fizetési határidő +8 nap és a fizetési mód "Átutalás" --
 * mindkettő ÉSZSZERŰ B2B alapérték, de Balázzsal NINCS megerősítve. Ez a
 * kör (ADR-014) csak ELŐNÉZETET készít (`elonezetpdf=true`), tehát a
 * feltétel ma nem hordoz jogi következményt -- VALÓS kiállítás előtt
 * (`MAINTENANCE_INVOICE_ISSUE_ENABLED`) ezt meg kell erősíteni.
 */
const PAYMENT_DUE_DAYS = 8;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function maintenanceInvoiceXmlInputFrom(
  certificate: MaintenanceInvoiceCertificateSource,
): MaintenanceInvoiceXmlInput {
  if (certificate.items.length === 0)
    throw new MaintenanceInvoiceInputError("NO_ITEMS");

  const address = certificate.serviceJob.customer.addresses[0];
  if (!address) throw new MaintenanceInvoiceInputError("NO_BILLING_ADDRESS");

  const mapped = certificate.items.map(mapItem);
  const fulfillmentDate = certificate.issuedAt;
  const dueDate = new Date(fulfillmentDate);
  dueDate.setDate(dueDate.getDate() + PAYMENT_DUE_DAYS);

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
      paymentDueDate: isoDate(dueDate),
      fulfillmentDate: isoDate(fulfillmentDate),
      paymentMethod: "Átutalás",
      currency: "HUF",
      orderNumber: certificate.number,
      comment: `Karbantartási teljesítési igazolás: ${certificate.number}`,
      seller: {},
      buyer: {
        name: certificate.serviceJob.customer.displayName,
        zip: address.postalCode,
        city: address.city,
        address: [address.line1, address.line2]
          .filter((part): part is string => Boolean(part))
          .join(", "),
        taxNumber: certificate.serviceJob.customer.taxNumber ?? undefined,
      },
      items: mapped.map((item) => item.line),
    },
    lineAmounts: mapped.map((item) => item.amounts),
  };
}
