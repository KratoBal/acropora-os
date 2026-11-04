import { Injectable, Logger } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";

import {
  duplicateReportLine,
  findDuplicates,
  type CustomerGroup,
  type CustomerRow,
  type DuplicateReport,
  type SupplierRow,
  type UnlinkedPair,
} from "./partner-duplicate-groups.js";

/** Hány hivatkozás áll egy vevő-soron: ebből látszik, melyik sor viszi a történetet az összevonásnál (terv 3.3). */
export interface CustomerReferenceCounts {
  invoices: number;
  salesOrders: number;
  contracts: number;
  worksheets: number;
  quotes: number;
  serviceJobs: number;
}

export interface ReportCustomer extends CustomerRow {
  references: CustomerReferenceCounts;
}

export interface ReportGroup extends Omit<CustomerGroup, "customers"> {
  customers: ReportCustomer[];
}

export interface ReportPair extends Omit<UnlinkedPair, "customer"> {
  customer: ReportCustomer;
}

export interface PartnerDuplicateResponse {
  generatedAt: string;
  /** a naplósor ugyanezekkel a számokkal */
  summary: string;
  strong: ReportGroup[];
  weakGroupTax: ReportGroup[];
  unlinked: ReportPair[];
  unas: DuplicateReport["unas"];
}

/** A tárolt sorok, CSAK OLVASVA (az API saját adatbázis-jogával; a flotta csak olvasó szerepének nincs joga ezekre a táblákra). */
@Injectable()
export class PartnerDuplicateRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async customers(): Promise<CustomerRow[]> {
    const [rows, unas] = await Promise.all([
      this.database.customer.findMany({
        where: { archivedAt: null },
        select: {
          id: true,
          customerNumber: true,
          displayName: true,
          companyName: true,
          type: true,
          taxNumber: true,
          euTaxNumber: true,
          partner: { select: { id: true } },
        },
      }),
      this.database.externalReference.findMany({
        where: { system: "UNAS", entityType: "Customer" },
        select: { entityId: true },
      }),
    ]);
    const fromUnas = new Set(unas.map((reference) => reference.entityId));
    return rows.map((row) => ({
      id: row.id,
      customerNumber: row.customerNumber,
      displayName: row.displayName,
      companyName: row.companyName,
      type: row.type,
      taxNumber: row.taxNumber,
      euTaxNumber: row.euTaxNumber,
      partnerMirror: Boolean(row.partner),
      fromUnas: fromUnas.has(row.id),
    }));
  }

  suppliers(): Promise<SupplierRow[]> {
    return this.database.supplier.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        taxNumber: true,
        country: true,
        customerId: true,
      },
    });
  }

  /** A hivatkozás-számok a megadott vevő-sorokra (csak a csoportokban szereplőkre, nem az egész törzsre). */
  async referenceCounts(
    ids: readonly string[],
  ): Promise<Map<string, CustomerReferenceCounts>> {
    const result = new Map<string, CustomerReferenceCounts>(
      ids.map((id) => [
        id,
        {
          invoices: 0,
          salesOrders: 0,
          contracts: 0,
          worksheets: 0,
          quotes: 0,
          serviceJobs: 0,
        },
      ]),
    );
    if (ids.length === 0) return result;
    const where = { customerId: { in: [...ids] } };
    const [invoices, salesOrders, contracts, worksheets, quotes, serviceJobs] =
      await Promise.all([
        this.database.invoice.groupBy({
          by: ["customerId"],
          where,
          _count: { _all: true },
        }),
        this.database.salesOrder.groupBy({
          by: ["customerId"],
          where,
          _count: { _all: true },
        }),
        this.database.contract.groupBy({
          by: ["customerId"],
          where,
          _count: { _all: true },
        }),
        this.database.worksheet.groupBy({
          by: ["customerId"],
          where,
          _count: { _all: true },
        }),
        this.database.quote.groupBy({
          by: ["customerId"],
          where,
          _count: { _all: true },
        }),
        this.database.serviceJob.groupBy({
          by: ["customerId"],
          where,
          _count: { _all: true },
        }),
      ]);
    const add = (
      rows: Array<{ customerId: string | null; _count: { _all: number } }>,
      field: keyof CustomerReferenceCounts,
    ) => {
      for (const row of rows)
        if (row.customerId && result.has(row.customerId))
          result.get(row.customerId)![field] = row._count._all;
    };
    add(invoices, "invoices");
    add(salesOrders, "salesOrders");
    add(contracts, "contracts");
    add(worksheets, "worksheets");
    add(quotes, "quotes");
    add(serviceJobs, "serviceJobs");
    return result;
  }
}

@Injectable()
export class PartnerDuplicateReportService {
  private readonly logger = new Logger(PartnerDuplicateReportService.name);

  constructor(private readonly repository: PartnerDuplicateRepository) {}

  /** A számok és a lista; a sorok csak olvasva, semmi nem íródik. */
  async build(): Promise<PartnerDuplicateResponse> {
    const [customers, suppliers] = await Promise.all([
      this.repository.customers(),
      this.repository.suppliers(),
    ]);
    const report = findDuplicates(customers, suppliers);
    const ids = new Set<string>();
    for (const group of [...report.strong, ...report.weakGroupTax])
      for (const row of group.customers) ids.add(row.id);
    for (const pair of report.unlinked) ids.add(pair.customer.id);
    const counts = await this.repository.referenceCounts([...ids]);
    const withCounts = (row: CustomerRow): ReportCustomer => ({
      ...row,
      references: counts.get(row.id)!,
    });
    const group = (item: CustomerGroup): ReportGroup => ({
      ...item,
      customers: item.customers.map(withCounts),
    });
    return {
      generatedAt: new Date().toISOString(),
      summary: duplicateReportLine(report),
      strong: report.strong.map(group),
      weakGroupTax: report.weakGroupTax.map(group),
      unlinked: report.unlinked.map((pair) => ({
        ...pair,
        customer: withCounts(pair.customer),
      })),
      unas: report.unas,
    };
  }

  /** Egy naplósor, csak számokkal; a hibás futás is egy sor, és nem dobja tovább a hibát (a mérés nem állíthatja le az API-t). */
  async logOnce(): Promise<string> {
    try {
      const line = duplicateReportLine(
        findDuplicates(
          await this.repository.customers(),
          await this.repository.suppliers(),
        ),
      );
      this.logger.log(line);
      return line;
    } catch (error) {
      const line = `PARTNER-DUPLIKATUM hiba=${(error as Error)?.name ?? "hiba"}`;
      this.logger.error(line);
      return line;
    }
  }
}
