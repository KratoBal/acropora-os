import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { prisma } from "@acropora/database";

import { decideProjectionDue } from "./medusa-projection-due.js";
import { MEDUSA_PRODUCT_REFERENCE } from "./medusa-product-link.repository.js";
import { runProjectionCli } from "./medusa-projection.runner.js";

/**
 * A VETITES UTEMEZOJE.
 *
 * EZ A PR NEM UJ KEPESSEGET AD, HANEM EGY MEGLEVOT KOT BE. Az esedekesseg-jel
 * (`decideProjectionDue`) 2026-09-04 ota a fo agon all, es NULLA hivoja volt:
 * a kepesseg megvolt, csak semmi nem hasznalta. Ez az utemezo az elso hivoja.
 *
 * A MINTA A REPOE, NEM UJ TALALMANY: a `foxpost-settlement.scheduler.ts`
 * ugyanigy epul fel (Nest szolgaltatas, lancolt `setTimeout`, unref-elt timer,
 * kornyezeti kapcsolo, es egy kulon `runOnce`, amire allitas irhato). Uj
 * fuggoseg nem kell: a `@nestjs/schedule` nincs telepitve, es a minta szerint
 * nem is hianyzik.
 *
 * AZ ALAPERTELMEZES KIKAPCSOLT, ES EZ VEDELEM, NEM KENYELEM. A vetites IR egy
 * kulso rendszerbe (a boltba), es Balazs szabalya szerint az iras JOGA nem
 * engedely. Harom szint, es a harmadik nem a miénk:
 *
 *   a kapcsolo alapertelmezese KIKAPCSOLT;
 *   a teszt kornyezetben bekapcsolhato, acrobot dontesevel;
 *   az ELES bolt ellen bekapcsolni KULON dontes, es az BALAZSE.
 */

export interface MedusaProjectionScheduleConfig {
  enabled: boolean;
  intervalMs: number;
  startupDelayMs: number;
  /** Hany termeket vetit egy kor. A felso korlat nem kenyelmi: egy korlatlan
   *  kor egy elso feltoltesnel az egesz katalogust kikuldene egyszerre. */
  batchSize: number;
}

function boundedInteger(
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

export function medusaProjectionScheduleConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MedusaProjectionScheduleConfig {
  const enabled = environment.MEDUSA_PROJECTION_SCHEDULE_ENABLED === "true";
  if (!enabled)
    return { enabled: false, intervalMs: 0, startupDelayMs: 0, batchSize: 0 };
  return {
    enabled: true,
    intervalMs:
      boundedInteger(
        environment.MEDUSA_PROJECTION_SCHEDULE_INTERVAL_MINUTES,
        60,
        5,
        1440,
        "MEDUSA_PROJECTION_SCHEDULE_INTERVAL_INVALID",
      ) * 60_000,
    startupDelayMs:
      boundedInteger(
        environment.MEDUSA_PROJECTION_SCHEDULE_STARTUP_DELAY_SECONDS,
        60,
        0,
        3600,
        "MEDUSA_PROJECTION_SCHEDULE_STARTUP_DELAY_INVALID",
      ) * 1000,
    batchSize: boundedInteger(
      environment.MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE,
      25,
      1,
      500,
      "MEDUSA_PROJECTION_SCHEDULE_BATCH_SIZE_INVALID",
    ),
  };
}

/**
 * AZ ADATBAZIS-HOZZAFERES PARAMETERKENT, ugyanabbol az okbol, mint a
 * futtatonal: enelkul a `runOnce` eles adatbazis nelkul nem merheto.
 */
export type ProjectionSchedulerDatabase = Pick<
  typeof prisma,
  "product" | "externalReference"
>;

/** A futtato, amit a `runOnce` hiv. Parameter, hogy cserelheto legyen. */
export type ProjectionRunner = (
  productIds: string[],
  out: { stdout(value: string): void; stderr(value: string): void },
) => Promise<number>;

export type ProjectionRunOutcome = "APPLIED" | "SKIPPED" | "FAILED";

/** A cserelheto reszek egyben. A tesztek ezt adjak at; elesben nincs megadva. */
export interface MedusaProjectionSchedulerDeps {
  db?: ProjectionSchedulerDatabase;
  runProjection?: ProjectionRunner;
  environment?: NodeJS.ProcessEnv;
}

export const MEDUSA_PROJECTION_SCHEDULER_DEPS = Symbol(
  "MEDUSA_PROJECTION_SCHEDULER_DEPS",
);

@Injectable()
export class MedusaProjectionScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MedusaProjectionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  private readonly db: ProjectionSchedulerDatabase;
  private readonly runProjection: ProjectionRunner;
  private readonly environment: NodeJS.ProcessEnv;

  /**
   * EGY OPCIONALIS FUGGOSEG-OBJEKTUM, ES EZ A REPO MINTAJA, NEM ROGTONZES: a
   * `MedusaProductLinkRepository` ugyanigy fogad egy `@Optional() @Inject(...)`
   * parametert, es hianyaban a modul-szintu `prisma` peldanyra esik vissza.
   *
   * MIERT NEM HAROM POZICIONALIS PARAMETER (az elso valtozatom az volt): a
   * Nest a konstruktor parametereit FELOLDANI probalja, es egy TIPUS (nem
   * osztaly) nem feloldhato token. A bootstrap-teszt ezt azonnal meg is fogta:
   * az EGESZ fajl elhasalt, es a lefutott tesztek szama 2138-rol 2120-ra esett
   * -- vagyis nem egy allitas bukott, hanem tizennyolc le sem futott.
   */
  constructor(
    @Optional()
    @Inject(MEDUSA_PROJECTION_SCHEDULER_DEPS)
    deps?: MedusaProjectionSchedulerDeps,
  ) {
    this.db = deps?.db ?? (prisma as unknown as ProjectionSchedulerDatabase);
    this.runProjection =
      deps?.runProjection ?? ((ids, out) => runProjectionCli(ids, out));
    this.environment = deps?.environment ?? process.env;
  }

  onModuleInit(): void {
    const config = medusaProjectionScheduleConfig(this.environment);
    if (!config.enabled) return;
    this.logger.log(
      `Medusa projection scheduler enabled (${config.intervalMs / 60_000} min, ` +
        `batch ${config.batchSize})`,
    );
    this.schedule(config.startupDelayMs, config.intervalMs);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * EGY KOR, IDOZITO NELKUL IS HIVHATO -- es a HAROM allapot kulon all.
   *
   * A `SKIPPED` azert nem olvad az `APPLIED`-ba, mert a ket eset teendoje mas:
   * a "nem volt mit vetiteni" EGESZSEGES, a "kimentek es sikerult" pedig
   * esemeny. Egy kozos ertek epp azt a szamot rejtene el, amibol latszik, hogy
   * az utemezo dolgozik-e egyaltalan.
   */
  async runOnce(): Promise<ProjectionRunOutcome> {
    const config = medusaProjectionScheduleConfig(this.environment);
    const esedekes = await this.esedekesAzonositok(
      config.batchSize || DEFAULT_BATCH,
    );
    if (!esedekes.length) return "SKIPPED";

    const kod = await this.runProjection(esedekes, {
      stdout: (value) => this.logNemUres(value, "log"),
      stderr: (value) => this.logNemUres(value, "warn"),
    });
    return kod === 0 ? "APPLIED" : "FAILED";
  }

  /**
   * KET LEKERDEZES, ES A SORREND SZAMIT: eloszor a termekek a forras-
   * idobelyegekkel, aztan a MAR LEKEPEZETT termekek utolso vetitesi ideje.
   * Forditva a masodik lekerdezes olyan azonositokra kerdezne, amiket az elso
   * meg nem ismer.
   *
   * AMIT A JEL NEM LAT, es a `medusa-projection-due.ts` fejleceben tetelesen
   * all: a kod valtozasat, a kategoria- es kep-hozzarendelest (azokon a
   * tablakon NINCS `updatedAt` -- merve), es a bolt oldali valtozast.
   */
  private async esedekesAzonositok(limit: number): Promise<string[]> {
    const termekek = await this.db.product.findMany({
      where: { isActive: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit * OVERSCAN,
      select: {
        id: true,
        updatedAt: true,
        variants: { select: { updatedAt: true } },
        unasSnapshot: { select: { updatedAt: true } },
        channelListings: { select: { updatedAt: true } },
      },
    });
    if (!termekek.length) return [];

    const lekepezesek = await this.db.externalReference.findMany({
      where: {
        ...MEDUSA_PRODUCT_REFERENCE,
        entityId: { in: termekek.map((termek) => termek.id) },
      },
      select: { entityId: true, lastSyncedAt: true },
    });
    const utoljara = new Map(
      lekepezesek.map((sor) => [sor.entityId, sor.lastSyncedAt]),
    );

    const esedekes: string[] = [];
    for (const termek of termekek) {
      const dontes = decideProjectionDue({
        lastProjectedAt: utoljara.get(termek.id) ?? null,
        sourceTimestamps: [
          termek.updatedAt,
          ...termek.variants.map((valtozat) => valtozat.updatedAt),
          termek.unasSnapshot?.updatedAt,
          ...termek.channelListings.map((sor) => sor.updatedAt),
        ],
      });
      if (dontes.due) esedekes.push(termek.id);
      if (esedekes.length >= limit) break;
    }
    return esedekes;
  }

  /**
   * A FUTTATO SORVEGGEL IR, A NAPLO NEM KER BELOLE. Egy ures sor a naplóban
   * ugyanugy egy bejegyzes, tehat kiszurjuk -- kulonben minden kor tele lenne
   * ures sorokkal, es a valodi uzenetek elvesznenek kozottuk.
   */
  private logNemUres(value: string, szint: "log" | "warn"): void {
    const szoveg = value.trimEnd();
    if (!szoveg) return;
    if (szint === "warn") this.logger.warn(szoveg);
    else this.logger.log(szoveg);
  }

  private schedule(delayMs: number, intervalMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .then((kimenetel) => {
          if (kimenetel !== "SKIPPED")
            this.logger.log(`Medusa projection run: ${kimenetel}`);
        })
        .catch((error) => {
          this.logger.error(
            `Scheduled Medusa projection failed: ${
              error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
                ? error.message
                : "MEDUSA_PROJECTION_SCHEDULED_FAILED"
            }`,
          );
        })
        .finally(() => {
          if (!this.stopped) this.schedule(intervalMs, intervalMs);
        });
    }, delayMs);
    this.timer.unref();
  }
}

/** Ha a kapcsolo ki van kapcsolva, a `runOnce` kezi hivasa is kap merteket. */
const DEFAULT_BATCH = 25;
/**
 * TOBBET OLVASUNK, MINT AMENNYIT VETITUNK, mert az esedekesseget csak a sorok
 * beolvasasa utan tudjuk eldonteni: egy naprakesz termek nem tolti a keretet.
 */
const OVERSCAN = 4;
