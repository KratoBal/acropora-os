import { Injectable } from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";
import type { PartnerMigrationPlan } from "@acropora/types";

import {
  PartnerDuplicateRepository,
  type CustomerReferenceCounts,
} from "../partner-duplicates/partner-duplicate-report.service.js";
import {
  buildMigrationPlan,
  type MigrationCustomer,
  type MigrationSupplier,
} from "./partner-migration-plan.js";

/** A partnerek a tervhez: a szerepekkel és a szerviz-kóddal, CSAK OLVASVA. */
@Injectable()
export class PartnerMigrationSuppliers extends Repository {
  constructor() {
    super(prisma);
  }

  list(): Promise<MigrationSupplier[]> {
    return this.database.supplier.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        taxNumber: true,
        country: true,
        customerId: true,
        isActive: true,
        isSupplier: true,
        isService: true,
        worksheetPartnerCode: true,
      },
    });
  }

  /** A TÖRÖLT partnerek vevő-sorai: továbbra is kötöttek, tehát nem szabad jelöltek (barracuda, #2181 review). */
  async deletedPartnerCustomerIds(): Promise<Set<string>> {
    const rows = await this.database.supplier.findMany({
      where: { deletedAt: { not: null }, customerId: { not: null } },
      select: { customerId: true },
    });
    return new Set(
      rows.flatMap((row) => (row.customerId ? [row.customerId] : [])),
    );
  }
}

const total = (counts: CustomerReferenceCounts | undefined): number =>
  counts
    ? counts.invoices +
      counts.salesOrders +
      counts.contracts +
      counts.worksheets +
      counts.quotes +
      counts.serviceJobs
    : 0;

/**
 * AZ EGYSZERI ÁTVEZETÉS TERVE (CSAK OLVAS): a partnerek és a vevő-sorok betöltése, a párosítás (`buildMigrationPlan`), és a
 * hivatkozás-számok a kötött és a jelölt sorokra. Semmit nem ír.
 */
@Injectable()
export class PartnerMigrationPlanService {
  constructor(
    private readonly suppliers: PartnerMigrationSuppliers,
    private readonly duplicates: PartnerDuplicateRepository,
  ) {}

  async build(): Promise<PartnerMigrationPlan> {
    const [suppliers, customers, deleted] = await Promise.all([
      this.suppliers.list(),
      this.duplicates.customers(),
      this.suppliers.deletedPartnerCustomerIds(),
    ]);
    const bare: MigrationCustomer[] = customers.map((customer) => ({
      ...customer,
      references: 0,
    }));
    // a hivatkozás-számok csak a tervben szereplő sorokra kellenek: előbb a terv, aztán a számok
    const first = buildMigrationPlan(suppliers, bare, new Date(), deleted);
    const ids = new Set<string>();
    for (const row of first.rows) {
      if (row.linkedCustomer) ids.add(row.linkedCustomer.id);
      for (const candidate of [...row.candidates, ...row.nameCandidates])
        ids.add(candidate.id);
    }
    const counts = await this.duplicates.referenceCounts([...ids]);
    return buildMigrationPlan(
      suppliers,
      bare.map((customer) => ({
        ...customer,
        references: total(counts.get(customer.id)),
      })),
    );
  }
}
