import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Repository, prisma } from "@acropora/database";

import {
  budapestDayKey,
  startOfBudapestDay,
} from "../dashboard/budapest-day.js";
import {
  buyerTaxCheckLine,
  buyerTaxCheckReason,
  buyerTaxCheckWhere,
  invoicesWithoutBuyerTaxNumber,
  type BuyerTaxCheckRow,
} from "./buyer-tax-check.js";

/** A számlák egy időszakból, csak olvasva. */
@Injectable()
export class BuyerTaxCheckRepository extends Repository {
  constructor() {
    super(prisma);
  }

  issuedBetween(from: Date, to: Date): Promise<BuyerTaxCheckRow[]> {
    return this.database.invoice.findMany({
      where: buyerTaxCheckWhere(from, to),
      select: {
        invoiceNumber: true,
        issueDate: true,
        partnerName: true,
        partnerTaxNumber: true,
        buyerSnapshot: true,
        customer: { select: { type: true, partner: { select: { id: true } } } },
      },
      orderBy: [{ issueDate: "asc" }, { invoiceNumber: "asc" }],
    });
  }
}

/**
 * A NAPI ADÓSZÁM-ELLENŐRZÉS ÜTEMEZÉSE (kártya aaf4f09d; acrobot 42382). A repo saját
 * mintája (láncolt `setTimeout`, unref-elt időzítő, külön `runOnce`). ALAPBÓL BEKAPCSOLVA,
 * mert csak olvas: `BUYER_TAX_CHECK_ENABLED=false` kapcsolja ki, PONTOSAN így. Naponta
 * egyszer, budapesti reggel hatkor, az előző budapesti nap számláira; az óraátállítás
 * napján a futás egy órát csúszhat, a nézett nap nem.
 */
export const BUYER_TAX_CHECK_HOUR = 6;

export function buyerTaxCheckEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.BUYER_TAX_CHECK_ENABLED !== "false";
}

/** A következő budapesti reggel hat óráig hátralévő idő. */
export function delayUntilNextRun(now: Date): number {
  const hour = BUYER_TAX_CHECK_HOUR * 60 * 60_000;
  const today = startOfBudapestDay(now).getTime() + hour;
  const next =
    today > now.getTime() ? today : startOfBudapestDay(now, 1).getTime() + hour;
  return next - now.getTime();
}

/** A pótló futás az indulás után ennyivel (a modulok és az adatbázis kapcsolat előbb). */
export const CATCH_UP_DELAY_MS = 2 * 60_000;

/**
 * Induláskor fusson-e le egyszer az előző napra: ha a mai budapesti hat óra már elmúlt.
 * Ha aznap a rendes futás már lement, a sor kétszer áll a naplóban; ez idempotens.
 */
export function catchUpOnStart(now: Date): boolean {
  return (
    now.getTime() >=
    startOfBudapestDay(now).getTime() + BUYER_TAX_CHECK_HOUR * 60 * 60_000
  );
}

@Injectable()
export class BuyerTaxCheckScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BuyerTaxCheckScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(private readonly repository: BuyerTaxCheckRepository) {}

  onModuleInit(): void {
    if (!buyerTaxCheckEnabled()) return;
    const now = new Date();
    // a start after six (a deploy, a restart) would skip today's run, and tomorrow's run
    // looks at a new yesterday: the missed day would never be checked (barracuda, #2159)
    if (catchUpOnStart(now))
      this.timer = setTimeout(() => {
        void this.runOnce().finally(() => {
          if (!this.stopped) this.schedule(new Date());
        });
      }, CATCH_UP_DELAY_MS);
    else this.schedule(now);
    this.timer?.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * Egy futás az előző budapesti napra; a még futó nem indul kétszer. Mindig EGY
   * naplósort ír, a hibás futás is, és azt adja vissza.
   */
  async runOnce(now: Date = new Date()): Promise<string> {
    if (this.running) return "";
    this.running = true;
    const from = startOfBudapestDay(now, -1);
    const day = budapestDayKey(from);
    try {
      const findings = invoicesWithoutBuyerTaxNumber(
        await this.repository.issuedBetween(from, startOfBudapestDay(now)),
      );
      const line = buyerTaxCheckLine(day, { ok: true, findings });
      if (findings.length > 0) this.logger.warn(line);
      else this.logger.log(line);
      return line;
    } catch (error) {
      const line = buyerTaxCheckLine(day, {
        ok: false,
        reason: buyerTaxCheckReason(error),
      });
      this.logger.error(line);
      return line;
    } finally {
      this.running = false;
    }
  }

  private schedule(now: Date, extraMs = 0): void {
    this.timer = setTimeout(
      () => {
        void this.runOnce().finally(() => {
          // a minute past the run: an early timer cannot see today's six o'clock again
          if (!this.stopped)
            this.schedule(new Date(Date.now() + 60_000), 60_000);
        });
      },
      delayUntilNextRun(now) + extraMs,
    );
    this.timer.unref();
  }
}
