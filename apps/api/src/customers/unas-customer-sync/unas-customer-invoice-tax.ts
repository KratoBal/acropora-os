import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import { normalizeHuTaxNumber } from "@acropora/types";

/**
 * A MEASUREMENT, NOTHING ELSE (acrobot 42630): of the UNAS customers, how many have an outgoing invoice, on how many
 * of those invoices a Hungarian tax number stands, and for how many customers that number is unambiguous (one) or
 * contradictory (more than one). It decides whether a backfill of the customer rows from the invoices is worth
 * building; the backfill itself comes later, separately. Read only; counts only in the log, no names and no numbers.
 *
 * An invoice belongs to a customer through its own `customerId`, or through its sales order's (a UNAS invoice is
 * often bound to the order only: #2169 measured "bound to a customer: 0"). The buyer's tax number is the sent
 * snapshot's, the invoice row's partner tax number only when the snapshot has none (the daily check's rule,
 * `buyer-tax-check.ts`).
 */
export const MEASURED_DOCUMENT_TYPES = [
  "INVOICE",
  "ADVANCE_INVOICE",
  "FINAL_INVOICE",
  "CORRECTION",
] as const;

export interface UnasInvoiceTaxRow {
  customerId: string | null;
  partnerTaxNumber: string | null;
  buyerSnapshot: Prisma.JsonValue | null;
  salesOrder: { customerId: string | null } | null;
}

export interface UnasInvoiceTaxCounts {
  unasCustomers: number;
  customersWithInvoice: number;
  invoices: number;
  invoicesBoundThroughOrder: number;
  invoicesWithHuTaxNumber: number;
  customersUnambiguous: number;
  customersContradictory: number;
  /** contradictory by the eight-digit base: a changed VAT code (the middle digit) of one company is not counted */
  customersContradictoryByBase: number;
  customersWithoutHuTaxNumber: number;
}

const snapshotText = (snapshot: Prisma.JsonValue | null, key: string) => {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
};

/** The invoice's Hungarian buyer tax number in its stored shape, or null. */
export function invoiceHuTaxNumber(row: UnasInvoiceTaxRow): string | null {
  const raw =
    snapshotText(row.buyerSnapshot, "taxNumber") ?? row.partnerTaxNumber;
  return raw?.trim() ? normalizeHuTaxNumber(raw.trim()) : null;
}

export function unasInvoiceTaxCounts(
  unasCustomerIds: readonly string[],
  invoices: readonly UnasInvoiceTaxRow[],
): UnasInvoiceTaxCounts {
  const unas = new Set(unasCustomerIds);
  const numbersByCustomer = new Map<string, Set<string>>();
  let counted = 0;
  let throughOrder = 0;
  let withHu = 0;
  for (const invoice of invoices) {
    const direct =
      invoice.customerId && unas.has(invoice.customerId)
        ? invoice.customerId
        : null;
    const viaOrder =
      invoice.salesOrder?.customerId && unas.has(invoice.salesOrder.customerId)
        ? invoice.salesOrder.customerId
        : null;
    const owner = direct ?? viaOrder;
    if (!owner) continue;
    counted += 1;
    if (!direct) throughOrder += 1;
    const numbers = numbersByCustomer.get(owner) ?? new Set<string>();
    numbersByCustomer.set(owner, numbers);
    const number = invoiceHuTaxNumber(invoice);
    if (number) {
      withHu += 1;
      numbers.add(number);
    }
  }
  const sizes = [...numbersByCustomer.values()].map((set) => set.size);
  const baseSizes = [...numbersByCustomer.values()].map(
    (set) => new Set([...set].map((number) => number.slice(0, 8))).size,
  );
  return {
    unasCustomers: unas.size,
    customersWithInvoice: numbersByCustomer.size,
    invoices: counted,
    invoicesBoundThroughOrder: throughOrder,
    invoicesWithHuTaxNumber: withHu,
    customersUnambiguous: sizes.filter((size) => size === 1).length,
    customersContradictory: sizes.filter((size) => size > 1).length,
    customersContradictoryByBase: baseSizes.filter((size) => size > 1).length,
    customersWithoutHuTaxNumber: sizes.filter((size) => size === 0).length,
  };
}

/** One number per line, the same head on every line, as the fleet searches the log. */
export function unasInvoiceTaxLines(
  result:
    { ok: true; counts: UnasInvoiceTaxCounts } | { ok: false; reason: string },
): string[] {
  const head = "UNAS-VEVO-SZAMLA-ADOSZAM";
  if (!result.ok) return [`${head} HIBA ok=${result.reason}`];
  const c = result.counts;
  return [
    `unas_vevo=${c.unasCustomers}`,
    `kimeno_szamlas_vevo=${c.customersWithInvoice}`,
    `kimeno_szamla=${c.invoices}`,
    `ebbol_rendelesen_at_kotott=${c.invoicesBoundThroughOrder}`,
    `magyar_adoszamos_szamla=${c.invoicesWithHuTaxNumber}`,
    `egyertelmu_vevo=${c.customersUnambiguous}`,
    `ellentmondo_vevo=${c.customersContradictory}`,
    `ellentmondo_vevo_torzsszam=${c.customersContradictoryByBase}`,
    `adoszam_nelkuli_vevo=${c.customersWithoutHuTaxNumber}`,
  ].map((part) => `${head} ${part}`);
}

@Injectable()
export class UnasInvoiceTaxRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async rows(): Promise<{
    unasCustomerIds: string[];
    invoices: UnasInvoiceTaxRow[];
  }> {
    const references = await this.database.externalReference.findMany({
      where: { system: "UNAS", entityType: "Customer" },
      select: { entityId: true },
    });
    const unasCustomerIds = [...new Set(references.map((row) => row.entityId))];
    const invoices = await this.database.invoice.findMany({
      where: {
        direction: "OUTBOUND",
        status: "ISSUED",
        documentType: { in: [...MEASURED_DOCUMENT_TYPES] },
        OR: [
          { customerId: { in: unasCustomerIds } },
          { salesOrder: { customerId: { in: unasCustomerIds } } },
        ],
      },
      select: {
        customerId: true,
        partnerTaxNumber: true,
        buyerSnapshot: true,
        salesOrder: { select: { customerId: true } },
      },
    });
    return { unasCustomerIds, invoices };
  }
}

/** After the start, once: the modules and the database connection come first. */
export const MEASURE_DELAY_MS = 2 * 60_000;

@Injectable()
export class UnasInvoiceTaxMeasurement
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UnasInvoiceTaxMeasurement.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly repository: UnasInvoiceTaxRepository) {}

  onModuleInit(): void {
    this.timer = setTimeout(() => void this.runOnce(), MEASURE_DELAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** The lines it logged; a failure is one line, never a throw. */
  async runOnce(): Promise<string[]> {
    let lines: string[];
    try {
      const { unasCustomerIds, invoices } = await this.repository.rows();
      lines = unasInvoiceTaxLines({
        ok: true,
        counts: unasInvoiceTaxCounts(unasCustomerIds, invoices),
      });
    } catch (error) {
      lines = unasInvoiceTaxLines({
        ok: false,
        reason: error instanceof Error ? error.constructor.name : "ismeretlen",
      });
      for (const line of lines) this.logger.error(line);
      return lines;
    }
    for (const line of lines) this.logger.log(line);
    return lines;
  }
}
