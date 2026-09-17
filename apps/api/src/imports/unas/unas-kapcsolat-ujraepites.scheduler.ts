import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";

import { prisma } from "@acropora/database";

import { decideUjraepitesDue } from "./unas-kapcsolat-ujraepites-esedekes.js";
import { runKapcsolatUjraepites } from "./unas-kapcsolat-ujraepites.runner.js";

/**
 * A KAPCSOLAT-UJRAEPITES NAPI UTEMEZOJE.
 *
 * acrobot dontese (2026-09-17, a `319c3007` kartya (b) valtozata): a teljes
 * ujraepites NEM egyszeri torlesztes marad, hanem napi egy futas csendes
 * orakban -- mert a szinkron a valtozatlan termekeket tovabbra sem irja ujra,
 * tehat az elsodras az elso futas utan is termelodik.
 *
 * A MINTA A REPOE: a `medusa-projection.scheduler.ts` es a
 * `unas-product-sync.scheduler.ts` ugyanigy epul fel (Nest szolgaltatas,
 * lancolt `setTimeout`, unref-elt idozito, kornyezeti kapcsolo, es egy kulon
 * `runOnce`, amire allitas irhato). Uj fuggoseg nem kell.
 *
 * === HAROM ZAR, ES MIND A HAROM MAS DOLGOT FOG MEG ===
 *
 * 1. AZ ALAPERTELMEZES KIKAPCSOLT. A futas TOROL, mielott ujrair.
 * 2. AZ IRAS KULON KAPCSOLO (`..._APPLY`). Bekapcsolva, de `APPLY` nelkul az
 *    utemezo TERVET keszit es FELJEGYZI a szamokat -- vagyis az elsodras
 *    lathatova valik anelkul, hogy barmit irnank. Ez nem felmegoldas: a
 *    kartyan pont az a kerdes, hogy MENNYI az elsodras.
 * 3. A NAGY VALTOZAS HATARA EL. Az utemezo SOSEM adja at a
 *    `--nagy-valtozas-is` kapcsolot, tehat egy elromlott pillanatkep-kinyeres
 *    utan megall, nem ir. acrobot negyedik kikotese, es allitas all rajta.
 *
 * === ES AMI A TELEPITES-HULLAM ELLEN VED ===
 *
 * Az indulasi keslelteto (acrobot kerese) eltolja az elso kort, DE NEM
 * SZUNTETI MEG: tizennegy telepites egy napon tizennegy elso kort jelentene.
 * Ezert a naponkenti korlat az adatbazisbol dol el, nem a folyamat
 * emlekezetebol -- az ujrainditas azt is elvinne. A `UnasRelationRebuildRun`
 * tabla (#804) epp ezt teszi lekerdezhetove, es ez az elso hivoja.
 */

export interface UjraepitesScheduleConfig {
  enabled: boolean;
  /** Ir-e a futas, vagy csak tervet keszit es feljegyzi a szamokat. */
  apply: boolean;
  startupDelayMs: number;
  /** Milyen surun ebredunk FEL -- nem ilyen surun futunk. */
  checkIntervalMs: number;
  ablakKezdoOra: number;
  ablakZaroOra: number;
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

export function ujraepitesScheduleConfig(
  environment: NodeJS.ProcessEnv = process.env,
): UjraepitesScheduleConfig {
  const enabled = environment.UNAS_RELATION_REBUILD_SCHEDULE_ENABLED === "true";
  if (!enabled)
    return {
      enabled: false,
      apply: false,
      startupDelayMs: 0,
      checkIntervalMs: 0,
      ablakKezdoOra: 0,
      ablakZaroOra: 0,
    };
  const ablakKezdoOra = boundedInteger(
    environment.UNAS_RELATION_REBUILD_SCHEDULE_WINDOW_START_HOUR,
    2,
    0,
    23,
    "UNAS_RELATION_REBUILD_SCHEDULE_WINDOW_START_HOUR_INVALID",
  );
  const ablakZaroOra = boundedInteger(
    environment.UNAS_RELATION_REBUILD_SCHEDULE_WINDOW_END_HOUR,
    5,
    1,
    24,
    "UNAS_RELATION_REBUILD_SCHEDULE_WINDOW_END_HOUR_INVALID",
  );
  /**
   * AZ EJFELT ATLEPO ABLAK NEM CSENDES OTLET, HANEM MAS SZAMOLAS: a
   * "ma mar futott" a HELYI naptari napra szol, es egy 23-2 ablak ket kulon
   * napra esne szet. Ahelyett, hogy csendben mast csinalnank, mint amit a
   * beallitas igér, elutasitjuk.
   */
  if (ablakZaroOra <= ablakKezdoOra)
    throw new Error("UNAS_RELATION_REBUILD_SCHEDULE_WINDOW_INVALID");
  return {
    enabled: true,
    apply: environment.UNAS_RELATION_REBUILD_SCHEDULE_APPLY === "true",
    startupDelayMs:
      boundedInteger(
        environment.UNAS_RELATION_REBUILD_SCHEDULE_STARTUP_DELAY_SECONDS,
        300,
        0,
        3600,
        "UNAS_RELATION_REBUILD_SCHEDULE_STARTUP_DELAY_INVALID",
      ) * 1000,
    checkIntervalMs:
      boundedInteger(
        environment.UNAS_RELATION_REBUILD_SCHEDULE_CHECK_INTERVAL_MINUTES,
        15,
        1,
        720,
        "UNAS_RELATION_REBUILD_SCHEDULE_CHECK_INTERVAL_INVALID",
      ) * 60_000,
    ablakKezdoOra,
    ablakZaroOra,
  };
}

/** Amit az utemezo az adatbazistol ker: az utolso futas KEZDETE. */
export type UjraepitesSchedulerDatabase = {
  utolsoFutasKezdete(): Promise<Date | null>;
};

/** A futtato, amit a `runOnce` hiv. Parameter, hogy cserelheto legyen. */
export type UjraepitesRunner = (
  argv: readonly string[],
  out: { stdout(value: string): void; stderr(value: string): void },
) => Promise<number>;

export type UjraepitesSchedulerLogger = {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export interface UjraepitesSchedulerDeps {
  db?: UjraepitesSchedulerDatabase;
  runRebuild?: UjraepitesRunner;
  environment?: NodeJS.ProcessEnv;
  logger?: UjraepitesSchedulerLogger;
  /** A jelenlegi ido. Parameter, kulonben az ablak nem merheto. */
  most?: () => Date;
}

/**
 * A HAROM KIMENETEL KULON ALL, UGYANABBOL AZ OKBOL, MINT A VETITESNEL: a
 * "nem volt esedekes" EGESZSEGES, a "lefutott" esemeny, a "megallt" pedig
 * dontest kivan. Egy kozos ertek epp azt a szamot rejtene el, amibol latszik,
 * hogy az utemezo dolgozik-e egyaltalan.
 */
export type UjraepitesRunOutcome = "APPLIED" | "SKIPPED" | "STOPPED" | "FAILED";

export const UJRAEPITES_SCHEDULER_DEPS = Symbol("UJRAEPITES_SCHEDULER_DEPS");

@Injectable()
export class UnasKapcsolatUjraepitesScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(UnasKapcsolatUjraepitesScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  private readonly db: UjraepitesSchedulerDatabase;
  private readonly runRebuild: UjraepitesRunner;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly naplo: UjraepitesSchedulerLogger;
  private readonly most: () => Date;

  /**
   * EGY OPCIONALIS FUGGOSEG-OBJEKTUM, ES EZ A REPO MINTAJA: a
   * `MedusaProjectionScheduler` ugyanigy fogad egy `@Optional() @Inject(...)`
   * parametert. Harom pozicionalis parameter helyette NEM mukodik: a Nest a
   * konstruktor parametereit feloldani probalja, es egy TIPUS nem feloldhato
   * token.
   */
  constructor(
    @Optional()
    @Inject(UJRAEPITES_SCHEDULER_DEPS)
    deps?: UjraepitesSchedulerDeps,
  ) {
    this.db = deps?.db ?? {
      utolsoFutasKezdete: async () =>
        (
          await prisma.unasRelationRebuildRun.findFirst({
            orderBy: { startedAt: "desc" },
            select: { startedAt: true },
          })
        )?.startedAt ?? null,
    };
    this.runRebuild = deps?.runRebuild ?? runKapcsolatUjraepites;
    this.environment = deps?.environment ?? process.env;
    this.naplo = deps?.logger ?? this.logger;
    this.most = deps?.most ?? (() => new Date());
  }

  onModuleInit(): void {
    const config = ujraepitesScheduleConfig(this.environment);
    if (!config.enabled) return;
    this.naplo.log(
      `UNAS relation rebuild scheduler enabled (` +
        `${config.ablakKezdoOra}-${config.ablakZaroOra} óra, ` +
        `${config.apply ? "apply" : "terv"}, ` +
        `ellenőrzés ${config.checkIntervalMs / 60_000} percenként)`,
    );
    this.schedule(config.startupDelayMs, config.checkIntervalMs);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * EGY EBREDES. Nem minden ebredes futas: eloszor az esedekesseg dol el.
   */
  async runOnce(): Promise<UjraepitesRunOutcome> {
    const config = ujraepitesScheduleConfig(this.environment);
    const dontes = decideUjraepitesDue({
      most: this.most(),
      ablakKezdoOra: config.ablakKezdoOra,
      ablakZaroOra: config.ablakZaroOra,
      utolsoFutasKezdete: await this.db.utolsoFutasKezdete(),
    });
    if (!dontes.due) return "SKIPPED";

    /**
     * A `--nagy-valtozas-is` SOSEM KERUL IDE. A hatar akkor er valamit, ha egy
     * automatikus futas NEM tudja atlepni: az atlepes kimondas, es kimondani
     * embernek kell. (acrobot negyedik kikotese, 2026-09-17.)
     */
    const argv = config.apply ? ["--apply"] : [];
    const kod = await this.runRebuild(argv, {
      stdout: (value) => this.logNemUres(value, "log"),
      stderr: (value) => this.logNemUres(value, "warn"),
    });
    if (kod === 0) return "APPLIED";
    if (kod === 2) return "STOPPED";
    return "FAILED";
  }

  private logNemUres(value: string, szint: "log" | "warn"): void {
    const szoveg = value.trimEnd();
    if (!szoveg) return;
    if (szint === "warn") this.naplo.warn(szoveg);
    else this.naplo.log(szoveg);
  }

  private schedule(delayMs: number, intervalMs: number): void {
    this.timer = setTimeout(() => {
      void this.runOnce()
        .then((kimenetel) => {
          if (kimenetel !== "SKIPPED")
            this.naplo.log(`UNAS relation rebuild run: ${kimenetel}`);
        })
        .catch((error) => {
          this.naplo.error(
            `Scheduled UNAS relation rebuild failed: ${
              error instanceof Error && /^[A-Z0-9_:.-]+$/.test(error.message)
                ? error.message
                : "UNAS_RELATION_REBUILD_SCHEDULED_FAILED"
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
