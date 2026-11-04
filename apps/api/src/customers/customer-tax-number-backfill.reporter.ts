import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";

/**
 * A VEVŐ-ADÓSZÁM VISSZATÖLTÉS SZÁMAI AZ API NAPLÓJÁBA (kártya aaf4f09d; acrobot 42502).
 *
 * A `20261104160000_customer_tax_number_from_orders` migráció a számait egy `DomainEvent`
 * sorba írja, mert a `prisma migrate deploy` a Postgres üzeneteit nem írja ki (mérve
 * 2026-11-04), a flotta pedig csak az API naplóját olvassa. Az API induláskor ezt a sort
 * kiolvassa, és a telepítés után TIZENNÉGY NAPIG minden induláskor egy sort ír:
 *   VEVO-ADOSZAM-VISSZATOLTES kitoltve=N kimaradt_ellentmondas=M kimaradt_nem_magyar=K kimaradt_maganszemely=P
 * Ha a sor hiányzik (a migráció még nem futott), nem ír semmit. A hiba nem állítja meg
 * az indulást.
 */
export const BACKFILL_EVENT_ID = "customer-tax-number-backfill-20261104";
export const BACKFILL_REPORT_DAYS = 14;

export interface BackfillEvent {
  payload: Prisma.JsonValue;
  occurredAt: Date;
}

const count = (payload: Prisma.JsonValue, key: string): string => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return "?";
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" ? String(value) : "?";
};

/** A naplósor, vagy `null`, ha nincs mit (vagy már nem kell) kiírni. */
export function backfillReportLine(
  event: BackfillEvent | null,
  now: Date,
): string | null {
  if (!event) return null;
  if (
    now.getTime() - event.occurredAt.getTime() >
    BACKFILL_REPORT_DAYS * 86_400_000
  )
    return null;
  return `VEVO-ADOSZAM-VISSZATOLTES kitoltve=${count(event.payload, "filled")} kimaradt_ellentmondas=${count(event.payload, "conflicting")} kimaradt_nem_magyar=${count(event.payload, "notHungarian")} kimaradt_maganszemely=${count(event.payload, "persons")}`;
}

/**
 * MIÉRT LETT NULLA (acrobot 42581, 42586): élesen `kitoltve=0`, és a 430 UNAS-vevő mind
 * adószám nélkül áll. A karantén-összegző a hosszú sor `kimaradt_*` részét elhagyta, ezért
 * minden szám SAJÁT, rövid sorban megy, és a visszatöltés számai is újra, egyenként. Csak
 * olvas, csak darabszám: név, adószám, azonosító nem kerül a naplóba.
 */
export interface BackfillMeasure {
  /** `SalesOrder` UNAS csatornán */
  unasOrders: number;
  /** ebből a vevő-adószám (`buyerTaxNumber`) nem üres */
  unasOrdersWithTax: number;
  /** ebből vevőhöz kötött (`customerId`) */
  unasOrdersWithTaxLinked: number;
  /** ebből a vevő UNAS-vevő (`ExternalReference` UNAS/Customer) */
  unasOrdersWithTaxUnasCustomer: number;
  /** az UNAS-vevők száma és típusa */
  unasCustomers: number;
  unasCustomersPerson: number;
  unasCustomersCompany: number;
  /** az UNAS-vevők közül, akiknek van céges (`buyerCustomerType=company`), adószámos rendelése */
  unasCustomersWithCompanyTaxedOrder: number;
}

const MEASURE_KEYS: readonly [keyof BackfillMeasure, string][] = [
  ["unasOrders", "unas_rendeles"],
  ["unasOrdersWithTax", "unas_rendeles_adoszammal"],
  ["unasOrdersWithTaxLinked", "unas_rendeles_adoszammal_vevohoz_kotve"],
  ["unasOrdersWithTaxUnasCustomer", "unas_rendeles_adoszammal_unas_vevohoz"],
  ["unasCustomers", "unas_vevo"],
  ["unasCustomersPerson", "unas_vevo_maganszemely"],
  ["unasCustomersCompany", "unas_vevo_ceg"],
  [
    "unasCustomersWithCompanyTaxedOrder",
    "unas_vevo_ceges_adoszamos_rendelessel",
  ],
];

/** Soronként egy szám: a mérés, és a lefutott visszatöltés számai újra. */
export function backfillMeasureLines(
  measure: BackfillMeasure,
  event: BackfillEvent | null,
): string[] {
  const lines = MEASURE_KEYS.map(
    ([key, name]) => `VEVO-ADOSZAM-MERES ${name}=${measure[key]}`,
  );
  if (event)
    for (const [key, name] of [
      ["filled", "kitoltve"],
      ["conflicting", "kimaradt_ellentmondas"],
      ["notHungarian", "kimaradt_nem_magyar"],
      ["persons", "kimaradt_maganszemely"],
    ] as const)
      lines.push(
        `VEVO-ADOSZAM-VISSZATOLTES ${name}=${count(event.payload, key)}`,
      );
  return lines;
}

@Injectable()
export class CustomerTaxNumberBackfillRepository extends Repository {
  constructor() {
    super(prisma);
  }

  event(): Promise<BackfillEvent | null> {
    return this.database.domainEvent.findUnique({
      where: { id: BACKFILL_EVENT_ID },
      select: { payload: true, occurredAt: true },
    });
  }

  async measure(): Promise<BackfillMeasure> {
    const unasCustomerIds = (
      await this.database.externalReference.findMany({
        where: { system: "UNAS", entityType: "Customer" },
        select: { entityId: true },
      })
    ).map((reference) => reference.entityId);
    const withTax: Prisma.SalesOrderWhereInput = {
      channel: "UNAS",
      buyerTaxNumber: { not: null },
      NOT: { buyerTaxNumber: "" },
    };
    const [
      unasOrders,
      unasOrdersWithTax,
      unasOrdersWithTaxLinked,
      unasOrdersWithTaxUnasCustomer,
      types,
      companyTaxed,
    ] = await Promise.all([
      this.database.salesOrder.count({ where: { channel: "UNAS" } }),
      this.database.salesOrder.count({ where: withTax }),
      this.database.salesOrder.count({
        where: { ...withTax, customerId: { not: null } },
      }),
      this.database.salesOrder.count({
        where: { ...withTax, customerId: { in: unasCustomerIds } },
      }),
      this.database.customer.groupBy({
        by: ["type"],
        where: { id: { in: unasCustomerIds } },
        _count: { _all: true },
      }),
      this.database.salesOrder.findMany({
        where: {
          ...withTax,
          buyerCustomerType: "company",
          customerId: { in: unasCustomerIds },
        },
        select: { customerId: true },
        distinct: ["customerId"],
      }),
    ]);
    const ofType = (type: string) =>
      types.find((row) => row.type === type)?._count._all ?? 0;
    return {
      unasOrders,
      unasOrdersWithTax,
      unasOrdersWithTaxLinked,
      unasOrdersWithTaxUnasCustomer,
      unasCustomers: unasCustomerIds.length,
      unasCustomersPerson: ofType("PERSON"),
      unasCustomersCompany: ofType("COMPANY"),
      unasCustomersWithCompanyTaxedOrder: companyTaxed.length,
    };
  }
}

@Injectable()
export class CustomerTaxNumberBackfillReporter implements OnApplicationBootstrap {
  private readonly logger = new Logger(CustomerTaxNumberBackfillReporter.name);

  constructor(
    private readonly repository: CustomerTaxNumberBackfillRepository,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.report(new Date());
  }

  /** Egy kiolvasás; a kiírt sort adja vissza (a teszthez). */
  async report(now: Date): Promise<string | null> {
    try {
      const event = await this.repository.event();
      const line = backfillReportLine(event, now);
      if (line) {
        this.logger.log(line);
        // the measurement goes with it, in the same fourteen days (acrobot 42586)
        for (const measured of backfillMeasureLines(
          await this.repository.measure(),
          event,
        ))
          this.logger.log(measured);
      }
      return line;
    } catch (error) {
      const line = `VEVO-ADOSZAM-VISSZATOLTES HIBA ok=${error instanceof Error ? error.name : "ismeretlen"}`;
      this.logger.warn(line);
      return line;
    }
  }
}
