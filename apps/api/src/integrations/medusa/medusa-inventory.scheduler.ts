import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import { ensureMainWarehouse } from "../../common/warehouse.util.js";
import {
  projectTargetInventory,
  type InventoryCliDatabase,
} from "./medusa-inventory.cli.js";
import { MedusaInventoryProjectionService } from "./medusa-inventory-projection.service.js";
import {
  inventoryDueProducts,
  recordInventoryAttempt,
  type InventorySyncDatabase,
} from "./medusa-inventory-sync.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";
import { storefrontSalesChannelId } from "./medusa-sales-channel.config.js";

/**
 * A KÉSZLET ÜTEMEZETT KIKÜLDÉSE A MEDUSÁBA (kártya 54d289d3, 9738d2b5; Balázs
 * 2026-10-06 22:05:01 UTC „Mehet a 2,7,6,8”, csak a teszt kirakat).
 *
 * A vetítés forrása a fő raktár hely és tétel nélküli `StockItem` sora; a kiküldés
 * eddig csak kézi parancsból (`medusa:inventory`) ment. Ez az időzítő körönként a
 * változott készletű, MÁR vetített termékeket küldi ki, ugyanazzal a
 * `projectTargetInventory`-vel, amit a kézi parancs futtat.
 *
 * AMI EBBŐL KÖVETKEZIK, ÉS BEKAPCSOLÁS ELŐTT TUDNI KELL: ahol egy változatnak nincs
 * ilyen sora (még nem volt rá leltár-korrekció vagy bevételezés), ott a kiküldött
 * készlet NULLA, ugyanúgy, mint a kézi parancsnál. A UNAS tükör-oszlop
 * (`unasReportedStock`) itt nem tartalék: a leltár-felvétel igen, a vetítés nem
 * olvassa. Hogy a teszt kirakat vetített termékei közül hánynak nincs sora, az az
 * adatbázisban mérhető, a kódban nem.
 *
 * KÜLÖN IDŐZÍTŐ ÉS KÜLÖN KAPCSOLÓ a termék-vetítéstől: a publikáció és a készlet külön
 * felelősség (a kézi parancs fejléce), tehát a nulla készlet itt sem hathat a
 * publikációra, és az egyik leállítása nem állítja meg a másikat.
 *
 *   MEDUSA_INVENTORY_SCHEDULE_ENABLED            `true`: fut. Bármi más: KI.
 *   MEDUSA_INVENTORY_SCHEDULE_INTERVAL_MINUTES   alapból 15 (5..1440)
 *   MEDUSA_INVENTORY_SCHEDULE_BATCH_SIZE         alapból 50 (1..500)
 *
 * Élesen nem kapcsoljuk be: az éles Commerce indulás előtt tisztán újratelepül, és
 * élő boltba írás csak Balázs esetenkénti engedélyével mehet.
 */
export interface MedusaInventoryScheduleConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
}

function bounded(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(code);
  return parsed;
}

export function medusaInventoryScheduleConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MedusaInventoryScheduleConfig {
  if (environment.MEDUSA_INVENTORY_SCHEDULE_ENABLED !== "true")
    return { enabled: false, intervalMs: 0, batchSize: 0 };
  return {
    enabled: true,
    intervalMs:
      bounded(
        environment.MEDUSA_INVENTORY_SCHEDULE_INTERVAL_MINUTES,
        15,
        5,
        1440,
        "MEDUSA_INVENTORY_SCHEDULE_INTERVAL_INVALID",
      ) * 60_000,
    batchSize: bounded(
      environment.MEDUSA_INVENTORY_SCHEDULE_BATCH_SIZE,
      50,
      1,
      500,
      "MEDUSA_INVENTORY_SCHEDULE_BATCH_SIZE_INVALID",
    ),
  };
}

export type InventoryRunOutcome = "APPLIED" | "SKIPPED" | "FAILED";

/** Egy kör, amit az ütemező hív: a kiküldő szolgáltatás felépítése a hívóé. */
export interface InventorySchedulerDeps {
  db?: InventorySyncDatabase & InventoryCliDatabase;
  environment?: NodeJS.ProcessEnv;
  /** A Medusa-kapcsolat; tesztben dublő. */
  createService?: () => Promise<
    Pick<MedusaInventoryProjectionService, "project">
  >;
  now?: () => Date;
  logger?: {
    log(m: string): void;
    warn(m: string): void;
    error(m: string): void;
  };
}

/**
 * AZ ÜRES KÖR IS KAP SORT, ritkítva: az első mindig, utána minden ennyiedik. A
 * termék-ütemező ugyanígy tesz (`medusa-projection.scheduler.ts`), és ugyanazért:
 * enélkül egy élő, de munkát nem találó ütemező kívülről nem különböztethető meg egy
 * leálltól. Mérve 2026-10-07 04:40: az első kör után a boltban semmi nem változott, és
 * a naplóból nem derült ki, hogy a kör lefutott-e.
 */
const EMPTY_ROUND_LOG_EVERY = 12;

/** Ennyi megállási okot ír ki a kör sora; a többi a termék hivatkozás-során áll. */
const STOP_REASONS_IN_LOG = 3;

export const MEDUSA_INVENTORY_SCHEDULER_DEPS = Symbol(
  "MEDUSA_INVENTORY_SCHEDULER_DEPS",
);

@Injectable()
export class MedusaInventoryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MedusaInventoryScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private emptyRoundsInARow = 0;
  private readonly db: InventorySyncDatabase & InventoryCliDatabase;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly createService: () => Promise<
    Pick<MedusaInventoryProjectionService, "project">
  >;
  private readonly now: () => Date;
  private readonly naplo: {
    log(m: string): void;
    warn(m: string): void;
    error(m: string): void;
  };

  constructor(
    @Optional()
    @Inject(MEDUSA_INVENTORY_SCHEDULER_DEPS)
    deps?: InventorySchedulerDeps,
  ) {
    this.db =
      deps?.db ??
      (prisma as unknown as InventorySyncDatabase & InventoryCliDatabase);
    this.environment = deps?.environment ?? process.env;
    this.now = deps?.now ?? (() => new Date());
    this.naplo = deps?.logger ?? this.logger;
    this.createService =
      deps?.createService ??
      (async () =>
        new MedusaInventoryProjectionService(
          new MedusaProductLinkRepository(),
          await medusaClientForProjection(storedCredentialProvider(), {
            stdout: () => undefined,
            stderr: (value) => this.naplo.warn(value.trim()),
          }),
          storefrontSalesChannelId(this.environment),
        ));
  }

  onModuleInit(): void {
    const config = medusaInventoryScheduleConfig(this.environment);
    if (!config.enabled) return;
    this.naplo.log(
      `Medusa inventory scheduler enabled (${config.intervalMs / 60_000} min, batch ${config.batchSize})`,
    );
    this.schedule(config.intervalMs);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(intervalMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((error: unknown) =>
          this.naplo.error(
            `Medusa inventory run failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => this.schedule(intervalMs));
    }, intervalMs);
    this.timer.unref?.();
  }

  /**
   * EGY KÖR: az esedékes termékek, egyenként. Sikernél a termék a kör kezdetének
   * idejével rögzül (ami közben változott, a következő körben újra jön), kudarcnál az
   * ok rögzül, és a termék csak forrás-változásra vagy a visszalépési idő után jön újra.
   */
  async runOnce(): Promise<InventoryRunOutcome> {
    const config = medusaInventoryScheduleConfig(this.environment);
    const startedAt = this.now();
    const warehouse = await ensureMainWarehouse(this.db);
    const due = await inventoryDueProducts(
      this.db,
      warehouse.id,
      config.batchSize || 50,
      startedAt,
    );
    if (!due.length) {
      this.emptyRoundsInARow += 1;
      if (
        this.emptyRoundsInARow === 1 ||
        this.emptyRoundsInARow % EMPTY_ROUND_LOG_EVERY === 0
      )
        this.naplo.log(
          `Medusa inventory run: SKIPPED (0 esedékes termék, ${this.emptyRoundsInARow}. üres kör egymás után)`,
        );
      return "SKIPPED";
    }
    this.emptyRoundsInARow = 0;

    const service = await this.createService();
    let failed = 0;
    const variants = { created: 0, updated: 0, "no-change": 0, stopped: 0 };
    const reasons: string[] = [];
    for (const product of due) {
      let failures: string[];
      try {
        const result = await projectTargetInventory(
          product.productId,
          { service, warehouse, database: this.db },
          { stdout: () => undefined, stderr: () => undefined },
        );
        failures = result.failures;
        for (const action of result.actions) variants[action] += 1;
      } catch (error) {
        failures = [error instanceof Error ? error.message : String(error)];
      }
      if (failures.length) {
        failed += 1;
        if (reasons.length < STOP_REASONS_IN_LOG) reasons.push(failures[0]!);
      }
      await recordInventoryAttempt(this.db, {
        productId: product.productId,
        medusaProductId: product.medusaProductId,
        startedAt,
        failure: failures.length ? failures.join("; ") : null,
      });
    }
    /**
     * A SOR AZT IS MEGMONDJA, VÁLTOZOTT-E VALAMI, nem csak hogy kiment-e: a
     * "változatlan" azt jelenti, hogy a bolt már ugyanazt a számot mutatta. Enélkül
     * egy kör, ami mindenhol nullát ír a nullára, sikeresnek és hatástalannak
     * egyszerre látszik, és a kettő nem választható szét.
     */
    this.naplo.log(
      `Medusa inventory run: ${due.length - failed} kiment, ${failed} megállt (${due.length} esedékes termék); ` +
        `változat: ${variants.created} létrehozva, ${variants.updated} frissítve, ` +
        `${variants["no-change"]} változatlan, ${variants.stopped} megállt` +
        (reasons.length ? `; első okok: ${reasons.join(" | ")}` : ""),
    );
    return failed ? "FAILED" : "APPLIED";
  }
}
