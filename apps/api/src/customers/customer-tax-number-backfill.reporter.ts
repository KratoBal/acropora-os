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
      const line = backfillReportLine(await this.repository.event(), now);
      if (line) this.logger.log(line);
      return line;
    } catch (error) {
      const line = `VEVO-ADOSZAM-VISSZATOLTES HIBA ok=${error instanceof Error ? error.name : "ismeretlen"}`;
      this.logger.warn(line);
      return line;
    }
  }
}
