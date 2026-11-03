import type { Prisma } from "@acropora/database";

import type {
  IncomingPayment,
  IncomingVatSummary,
} from "../billing/incoming-szamlazz-invoice.js";
import type { IncomingDocumentLine } from "@acropora/types";

/**
 * THE DEMO ROWS FOR THE STAGE, AS DATA (card c958804d, T6.3 part 1).
 *
 * WHAT THIS IS: a small set of SYNTHETIC, marked rows so the three flows can be tried on the
 * test server: a customer quote (editor, publish, send), and the incoming invoices list
 * (paid, unpaid, overdue, foreign currency). Every name, number and amount is invented.
 *
 * WHAT THIS IS NOT (acrobot 41676): the stage's BASE DATA. That comes from the anonymisation
 * chain (card 07b56a1f) and needs a production read; this has none, and does not mix with it.
 *
 * THE MARKER IS THE KEY. Every row is found again, and removed, by the `DEMO-` prefix of its
 * own business key (customer number, quote number, invoice external id), never by a list of
 * ids that could go stale. A row without the prefix is not ours and is never touched.
 *
 * The inputs are the generated Prisma types, so a new REQUIRED column stops the compiler here.
 */

export const DEMO_PREFIX = "DEMO-";

/*
  THE TAX NUMBERS ARE `0000000N-2-4N` ON PURPOSE: a real Hungarian tax number does not start
  with a zero, so none of these can equal (or share the 8-digit base of) a supplier or a
  customer already on the stage, which the invoice collection and the pairing look up by base.
*/

export interface DemoQuoteItem {
  name: string;
  quantity: string;
  unit: string;
  unitNetPrice: string;
  vatRatePercent: string;
  isOptional: boolean;
}

export interface DemoQuote {
  quoteNumber: string;
  title: string;
  /** the `customerNumber` of one of the demo customers */
  customerNumber: string;
  /** the last valid day, `YYYY-MM-DD` */
  validUntil: string;
  priceDisplay: "NET" | "GROSS" | "BOTH";
  milestones: { label: string; percent: string }[];
  blocks: { title: string; items: DemoQuoteItem[] }[];
}

export interface DemoPlan {
  customers: Prisma.CustomerUncheckedCreateInput[];
  quotes: DemoQuote[];
  incomingInvoices: Prisma.IncomingBillingDocumentUncheckedCreateInput[];
}

/** `YYYY-MM-DD` plus whole days, in UTC (the input is already a Budapest calendar day). */
export function plusDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

const utcDay = (day: string) => new Date(`${day}T00:00:00Z`);

const VAT = 27;

interface InvoiceSeed {
  n: number;
  supplier: string;
  taxNumber: string | null;
  issueOffset: number;
  dueOffset: number;
  /** net amount of the single line, whole currency units */
  net: number;
  currency?: "HUF" | "EUR";
  paid?: boolean;
  paymentsKnown?: boolean;
  lineName: string;
}

function invoiceRow(
  today: string,
  seed: InvoiceSeed,
): Prisma.IncomingBillingDocumentUncheckedCreateInput {
  const currency = seed.currency ?? "HUF";
  const vatRate = currency === "EUR" ? 0 : VAT;
  const vat = Math.round((seed.net * vatRate) / 100);
  const gross = seed.net + vat;
  const issue = plusDays(today, seed.issueOffset);
  const due = plusDays(today, seed.dueOffset);
  const number = `${DEMO_PREFIX}SZ-${issue.slice(0, 4)}/${String(seed.n).padStart(3, "0")}`;
  const money = (value: number) => value.toFixed(2);
  const lines: IncomingDocumentLine[] = [
    {
      name: seed.lineName,
      quantity: "1",
      unit: "db",
      unitNet: money(seed.net),
      vatRate: String(vatRate),
      netAmount: money(seed.net),
      vatAmount: money(vat),
      grossAmount: money(gross),
    },
  ];
  const vatSummary: IncomingVatSummary[] = [
    {
      vatRate: String(vatRate),
      netAmount: money(seed.net),
      vatAmount: money(vat),
      grossAmount: money(gross),
    },
  ];
  const paymentsKnown = seed.paymentsKnown ?? true;
  const payments: IncomingPayment[] = seed.paid
    ? [
        {
          date: plusDays(today, seed.dueOffset - 2),
          title: "Átutalás",
          amount: money(gross),
          note: null,
          bankTransactionId: null,
        },
      ]
    : [];
  const received = new Date(`${issue}T08:00:00Z`);
  return {
    source: "SZAMLAZZ",
    externalId: `${DEMO_PREFIX}F-${String(seed.n).padStart(3, "0")}`,
    feedMessageId: `demo-msg-${seed.n}`,
    feedReceivedAt: received,
    versionCount: 1,
    kindCode: "SZ",
    documentNumber: number,
    electronic: true,
    issueDate: utcDay(issue),
    fulfillmentDate: utcDay(issue),
    dueDate: utcDay(due),
    paymentMethod: "Átutalás",
    currency,
    exchangeRate: currency === "EUR" ? "395.500000" : null,
    exchangeBank: currency === "EUR" ? "MNB" : null,
    supplierName: seed.supplier,
    supplierTaxNumber: seed.taxNumber,
    supplierEuTaxNumber: null,
    supplierAddress: "1011 Budapest, Mintaszállító utca 1.",
    supplierBankAccount: null,
    buyerName: "Acropora Kft.",
    buyerTaxNumber: "23916229-2-42",
    netAmount: money(seed.net),
    vatAmount: money(vat),
    grossAmount: money(gross),
    lines: lines as unknown as Prisma.InputJsonValue,
    vatSummary: vatSummary as unknown as Prisma.InputJsonValue,
    paymentsKnown,
    payments: payments as unknown as Prisma.InputJsonValue,
    paidAmount: seed.paid ? money(gross) : "0",
    lastPaymentDate: seed.paid
      ? utcDay(plusDays(today, seed.dueOffset - 2))
      : null,
    note: null,
    orderNumber: null,
    referencedInvoiceNumber: null,
    referencedProformaNumber: null,
    cancelled: false,
    sourceDocumentId: null,
    hasPdf: false,
    notBookable: false,
    notBookableAt: null,
    paperOriginalAt: null,
  };
}

const SEEDS: InvoiceSeed[] = [
  {
    n: 1,
    supplier: "DEMO Akvarisztikai Nagykereskedés Kft.",
    taxNumber: "00000001-2-41",
    issueOffset: -3,
    dueOffset: 11,
    net: 184000,
    lineName: "Szűrőbetét és vízkezelő szerek, vegyes tétel",
  },
  {
    n: 2,
    supplier: "DEMO Csomagoló Eszközök Zrt.",
    taxNumber: "00000002-2-42",
    issueOffset: -21,
    dueOffset: -7,
    net: 62500,
    paid: true,
    lineName: "Kartondoboz, 200 db",
  },
  {
    n: 3,
    supplier: "DEMO Világítástechnika Bt.",
    taxNumber: "00000003-2-43",
    issueOffset: -40,
    dueOffset: -10,
    net: 310000,
    lineName: "LED lámpatest, 4 db",
  },
  {
    n: 4,
    supplier: "DEMO Aquatic Supplies GmbH",
    taxNumber: null,
    issueOffset: -9,
    dueOffset: 21,
    net: 1840,
    currency: "EUR",
    lineName: "Protein skimmer spare parts",
  },
  {
    n: 5,
    supplier: "DEMO Szállítmányozó Kft.",
    taxNumber: "00000004-2-44",
    issueOffset: -1,
    dueOffset: 29,
    net: 27800,
    paymentsKnown: false,
    lineName: "Szállítási díj, októberi összesítő",
  },
];

/**
 * THE PLAN FOR ONE DAY. `today` is the Budapest calendar day (`YYYY-MM-DD`); the dates are
 * offsets from it, so the quotes are still valid and the invoices still look recent on the day
 * of the run. Same day in, same plan out.
 */
export function demoPlan(today: string): DemoPlan {
  const customers: Prisma.CustomerUncheckedCreateInput[] = [
    {
      customerNumber: `${DEMO_PREFIX}C-001`,
      type: "PERSON",
      displayName: "DEMO Kovács Anna",
      email: "demo.kovacs@example.invalid",
      phone: "+36 30 000 0001",
    },
    {
      customerNumber: `${DEMO_PREFIX}C-002`,
      type: "COMPANY",
      displayName: "DEMO Tengeri Akvárium Kft.",
      companyName: "DEMO Tengeri Akvárium Kft.",
      taxNumber: "00000005-2-45",
      email: "demo.iroda@example.invalid",
      phone: "+36 1 000 0002",
      paymentDueDays: 15,
    },
    {
      customerNumber: `${DEMO_PREFIX}C-003`,
      type: "COMPANY",
      displayName: "DEMO Állatkert Fejlesztő Nonprofit Kft.",
      companyName: "DEMO Állatkert Fejlesztő Nonprofit Kft.",
      taxNumber: "00000006-2-46",
      email: "demo.beszerzes@example.invalid",
      paymentDueDays: 30,
    },
  ];
  const quotes: DemoQuote[] = [
    {
      quoteNumber: `${DEMO_PREFIX}AJ-001`,
      title: "DEMO Nano tengeri akvárium indítócsomag",
      customerNumber: `${DEMO_PREFIX}C-001`,
      validUntil: plusDays(today, 14),
      priceDisplay: "GROSS",
      milestones: [],
      blocks: [
        {
          title: "Berendezés",
          items: [
            {
              name: "Akvárium 120 literes, szerelt",
              quantity: "1",
              unit: "db",
              unitNetPrice: "189000",
              vatRatePercent: "27",
              isOptional: false,
            },
            {
              name: "Fehér LED világítás",
              quantity: "1",
              unit: "db",
              unitNetPrice: "64000",
              vatRatePercent: "27",
              isOptional: false,
            },
          ],
        },
      ],
    },
    {
      quoteNumber: `${DEMO_PREFIX}AJ-002`,
      title: "DEMO Irodai akvárium karbantartási csomag",
      customerNumber: `${DEMO_PREFIX}C-002`,
      validUntil: plusDays(today, 30),
      priceDisplay: "BOTH",
      milestones: [],
      blocks: [
        {
          title: "Havi szerviz",
          items: [
            {
              name: "Havi karbantartás, 2 alkalom",
              quantity: "12",
              unit: "hó",
              unitNetPrice: "38000",
              vatRatePercent: "27",
              isOptional: false,
            },
            {
              name: "Vízvizsgálati jegyzőkönyv",
              quantity: "12",
              unit: "db",
              unitNetPrice: "6500",
              vatRatePercent: "27",
              isOptional: true,
            },
          ],
        },
        {
          title: "Pótalkatrészek",
          items: [
            {
              name: "Szűrőbetét készlet",
              quantity: "4",
              unit: "készlet",
              unitNetPrice: "12900",
              vatRatePercent: "27",
              isOptional: false,
            },
          ],
        },
      ],
    },
    {
      quoteNumber: `${DEMO_PREFIX}AJ-003`,
      title: "DEMO Bemutató medence kivitelezés, részletfizetéssel",
      customerNumber: `${DEMO_PREFIX}C-003`,
      validUntil: plusDays(today, 45),
      priceDisplay: "NET",
      milestones: [
        { label: "Előleg a szerződéskötéskor", percent: "30.00" },
        { label: "Szállításkor", percent: "50.00" },
        { label: "Átadáskor", percent: "20.00" },
      ],
      blocks: [
        {
          title: "Kivitelezés",
          items: [
            {
              name: "Medence és keringtető rendszer",
              quantity: "1",
              unit: "tétel",
              unitNetPrice: "4850000",
              vatRatePercent: "27",
              isOptional: false,
            },
            {
              name: "Üzembe helyezés és oktatás",
              quantity: "1",
              unit: "tétel",
              unitNetPrice: "320000",
              vatRatePercent: "27",
              isOptional: false,
            },
          ],
        },
      ],
    },
  ];
  return {
    customers,
    quotes,
    incomingInvoices: SEEDS.map((seed) => invoiceRow(today, seed)),
  };
}
