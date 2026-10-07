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
import { runPricingCli } from "./medusa-pricing.cli.js";
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
  "product" | "externalReference" | "unasProductSnapshot"
>;

/** A futtato, amit a `runOnce` hiv. Parameter, hogy cserelheto legyen. */
export type ProjectionRunner = (
  productIds: string[],
  out: { stdout(value: string): void; stderr(value: string): void },
) => Promise<number>;

export type ProjectionRunOutcome = "APPLIED" | "SKIPPED" | "FAILED";

/**
 * A NAPLO IS PARAMETER, UGYANABBOL AZ OKBOL, MINT AZ ADATBAZIS ES A FUTTATO:
 * enelkul az, HOGY MIT IR KI, nem merheto -- es epp ez a resz letezik azert,
 * hogy kivulrol latszodjon.
 */
export type ProjectionSchedulerLogger = {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

/** A cserelheto reszek egyben. A tesztek ezt adjak at; elesben nincs megadva. */
export interface MedusaProjectionSchedulerDeps {
  db?: ProjectionSchedulerDatabase;
  runProjection?: ProjectionRunner;
  /** Az ár-vetítés futtatója. Ugyanaz az alak, mint a termék-vetítésé. */
  runPricing?: ProjectionRunner;
  environment?: NodeJS.ProcessEnv;
  logger?: ProjectionSchedulerLogger;
  /** A „most”: az akció kezdete és vége az órához mér. */
  now?: () => Date;
}

/**
 * MINDEN HANYADIK URES KOR KAPJON SORT.
 *
 * Az ELSO ures kor MINDIG naplozodik (az mondja meg, hogy az utemezo el es nem
 * talalt munkat), utana minden ennyiedik. A cel nem a naplo teleirasa, hanem
 * hogy legyen KULSO jele a futasnak: harminc perces korrel ez naponta
 * nagyjabol negy sor, egy oras korrel ketto.
 */
const URES_KOR_NAPLO_RITKITAS = 12;

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
  private readonly runPricing: ProjectionRunner;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly naplo: ProjectionSchedulerLogger;
  private readonly now: () => Date;
  /** Hany URES kor telt el egymas utan. A nem-ures kor nullazza. */
  private egymasUtaniUresKorok = 0;

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
    this.runPricing =
      deps?.runPricing ?? ((ids, out) => runPricingCli(ids, out));
    this.environment = deps?.environment ?? process.env;
    this.naplo = deps?.logger ?? this.logger;
    this.now = deps?.now ?? (() => new Date());
  }

  onModuleInit(): void {
    const config = medusaProjectionScheduleConfig(this.environment);
    if (!config.enabled) return;
    this.naplo.log(
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
    const limit = config.batchSize || DEFAULT_BATCH;
    /*
      AZ AKCIÓ HATÁRA IS ESEDÉKESSÉ TESZ (329f8a2e, acrobot 27356). Az UNAS
      gazdájú termék ára az óra szerint vált (`isSaleActive(now)`): amikor egy
      akció elindul vagy lejár, semmi nem íródik, tehát a forrás-időbélyegek
      közül egyik sem mozdul, és a bolt a régi árat tartja. Az akciós termékek
      állnak elöl, hogy egy teli kör ne szorítsa ki őket.
    */
    const akcio = await this.akcioHatarAzonositok();
    const esedekes = [
      ...new Set([...akcio, ...(await this.esedekesAzonositok(limit))]),
    ].slice(0, limit);
    if (!esedekes.length) {
      this.uresKorNaploja();
      return "SKIPPED";
    }
    this.egymasUtaniUresKorok = 0;

    const kimenet = {
      stdout: (value: string) => this.logNemUres(value, "log"),
      stderr: (value: string) => this.logNemUres(value, "warn"),
    };
    const kod = await this.runProjection(esedekes, kimenet);

    /*
      AZ ÁR UGYANABBAN A KÖRBEN (7-es tétel, kártya 329f8a2e; acrobot 27251
      „a”). A termék-vetítés az árat NEM viszi (a futtatóban nulla ár-hivatkozás
      van), tehát egy ár eddig csak a kézi `medusa:pricing` paranccsal jutott a
      boltba. Itt UGYANAZ a parancs-törzs fut: `resolvePriceSource` és
      `decidePricingProjection`, változatlanul; az ütemező csak meghívja.

      CSAK A KÖTÖTT TERMÉKEKRE. A Medusa terméket a MEDUSA Product
      ExternalReference köti az OS termékhez (nautilus SKU alapú kötése,
      27254), és az ár-vetítés kötés nélkül `no-product-link` okkal megállna:
      minden körben ugyanazon a terméken, ugyanazzal a hibával. A kötés hiánya
      nem hiba, hanem az, hogy a termék nincs a boltban; a napló a számát
      mondja meg. Az ütemező kötést nem ír.

      A termék-vetítés bukása nem állítja meg: a kör többi terméke ugyanúgy
      kötött, és az áruk ugyanúgy igaz.
    */
    const arazhato = await this.kotottAzonositok(esedekes);
    const kotesNelkul = esedekes.length - arazhato.length;
    if (kotesNelkul > 0)
      this.naplo.log(
        `Medusa price projection: ${kotesNelkul} termek Medusa kotes nelkul, ` +
          `az aruk nem ment ki`,
      );
    const arKod = arazhato.length
      ? await this.runPricing(arazhato, kimenet)
      : 0;
    return kod === 0 && arKod === 0 ? "APPLIED" : "FAILED";
  }

  /**
   * Azok a kötött termékek, amelyeknél egy akció kezdete vagy vége a legutóbbi
   * vetítés ÓTA telt el. KÜLÖN LEKÉRDEZÉS, és ez a lényeg: az esedékességi
   * lekérdezés csak a legutóbb módosított termékeket olvassa (updatedAt
   * szerint), egy régen módosított termék akciós határa oda be sem kerülne.
   *
   * A jövőbeli határ nem számít, amíg el nem érkezik. A visszatekintő ablak
   * csak a keresést szűkíti; a döntést a kötés `lastSyncedAt`-je hozza, tehát
   * egy vetítés után a termék nem esedékes újra. Kötés nélküli termék nem
   * kerül be: annak az ára úgysem mehet ki.
   */
  private async akcioHatarAzonositok(): Promise<string[]> {
    const most = this.now();
    const ablak = { gt: new Date(most.getTime() - AKCIO_ABLAK_MS), lte: most };
    const sorok = await this.db.unasProductSnapshot.findMany({
      where: {
        OR: [{ saleStartsAt: ablak }, { saleEndsAt: ablak }],
        product: { isActive: true, webshopExcluded: false },
      },
      select: { productId: true, saleStartsAt: true, saleEndsAt: true },
    });
    if (!sorok.length) return [];

    const kotesek = await this.db.externalReference.findMany({
      where: {
        ...MEDUSA_PRODUCT_REFERENCE,
        entityId: { in: sorok.map((sor) => sor.productId) },
      },
      select: { entityId: true, lastSyncedAt: true },
    });
    const utoljara = new Map(
      kotesek.map((sor) => [sor.entityId, sor.lastSyncedAt]),
    );

    return sorok
      .filter((sor) => {
        if (!utoljara.has(sor.productId)) return false;
        const vetitve = utoljara.get(sor.productId) ?? null;
        const hatarok = [sor.saleStartsAt, sor.saleEndsAt].filter(
          (hatar): hatar is Date => hatar !== null && hatar <= most,
        );
        return hatarok.some((hatar) => vetitve === null || hatar > vetitve);
      })
      .map((sor) => sor.productId);
  }

  /**
   * Az esedékes termékek közül azok, amelyeknek VAN Medusa kötése, a kör
   * sorrendjében. A metszet a kódban is megvan, nem csak a lekérdezésben:
   * egy tágabb válasz se tegyen ár-vetítésbe olyan terméket, ami nem esedékes.
   */
  private async kotottAzonositok(esedekes: string[]): Promise<string[]> {
    const kotesek = await this.db.externalReference.findMany({
      where: { ...MEDUSA_PRODUCT_REFERENCE, entityId: { in: esedekes } },
      select: { entityId: true },
    });
    const kotott = new Set(kotesek.map((sor) => sor.entityId));
    return esedekes.filter((id) => kotott.has(id));
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
   *
   * A KAPCSOLATOK 2026-09-08-IG UGYANEBBE A LISTABA TARTOZTAK, ES MOSTANTOL NEM.
   * A `ProductRelation` tablan addig nem volt idobelyeg, tehat egy
   * kapcsolat-valtozas SOHA nem tette esedekesse a terméket: a kapcsolatok
   * kimentek az adatbazisba, es a boltba nem jutottak el. Egy egesz estet vitt
   * el a kerdes, hogy "megallt-e a vetites" -- nem allt meg, csak nem volt MIN
   * eszrevennie.
   */
  private async esedekesAzonositok(limit: number): Promise<string[]> {
    const termekek = await this.db.product.findMany({
      // A kihagyott termek (webshopExcluded, 2026-09-29) soha nem esedekes:
      // kulonben orokre "meg nem vetitett" maradna, es minden kor elore hozna.
      where: { isActive: true, webshopExcluded: false },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit * OVERSCAN,
      select: {
        id: true,
        updatedAt: true,
        variants: { select: { updatedAt: true } },
        unasSnapshot: { select: { updatedAt: true } },
        channelListings: { select: { updatedAt: true } },
        /**
         * A KAPCSOLATOK IDOBELYEGE -- ES A `sourceRelations`, NEM A
         * `targetRelations`.
         *
         * A vetites a termek SAJAT metaadataba irja a kapcsolatok azonositoit,
         * tehat csak azok a sorok szamitanak, ahol EZ a termek a FORRAS. Ha B
         * csak celpontja A egyik kapcsolatanak, B sajat metaadata nem valtozik
         * -- a `targetRelations` felvetele folosleges ujravetiteseket hozna.
         */
        sourceRelations: { select: { updatedAt: true } },
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
          ...termek.sourceRelations.map((sor) => sor.updatedAt),
        ],
      });
      if (dontes.due) esedekes.push(termek.id);
      if (esedekes.length >= limit) break;
    }
    return esedekes;
  }

  /**
   * AZ URES KOR IS KAP SORT -- ES EZ NEM NAPLO-DISZ.
   *
   * MERVE 2026-09-08 este, harom agens egy oraja: az utemezo `SKIPPED` agat
   * semmi nem naplozta, tehat egy EGESZSEGES, hatvan masodpercenkent futo
   * utemezo, ami nem talal munkat, KIVULROL MEGKULONBOZTETHETETLEN volt egy
   * leallt utemezotol. A kerdest a vegen kod-olvasas dontotte el, nem meres --
   * pedig egyetlen naplo-sor megvalaszolta volna.
   *
   * A SOR A SZAMOT MONDJA MEG, NEM CSAK AZ ALLAPOTOT (acrobot kikotese): a
   * "nulla esedekes" onmagaban valasz arra, hogy fut-e es talal-e munkat. Egy
   * puszta "SKIPPED" ugyanazt a ket kerdest hagyna nyitva.
   *
   * ES RITKITVA, mert a masik irany is hiba: egy sor minden korben azt jelenti,
   * hogy a valodi uzenetek elvesznek kozottuk -- ugyanaz, amiert a `logNemUres`
   * kiszuri az ures sorokat.
   */
  private uresKorNaploja(): void {
    this.egymasUtaniUresKorok += 1;
    const elso = this.egymasUtaniUresKorok === 1;
    if (!elso && this.egymasUtaniUresKorok % URES_KOR_NAPLO_RITKITAS !== 0)
      return;
    this.naplo.log(
      `Medusa projection run: SKIPPED (0 esedekes termek, ` +
        `${this.egymasUtaniUresKorok}. ures kor egymas utan)`,
    );
  }

  /**
   * A FUTTATO SORVEGGEL IR, A NAPLO NEM KER BELOLE. Egy ures sor a naplóban
   * ugyanugy egy bejegyzes, tehat kiszurjuk -- kulonben minden kor tele lenne
   * ures sorokkal, es a valodi uzenetek elvesznenek kozottuk.
   */
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
            this.naplo.log(`Medusa projection run: ${kimenetel}`);
        })
        .catch((error) => {
          this.naplo.error(
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
/**
 * Az akciós határ keresésének visszatekintő ablaka. Csak a keresést szűkíti;
 * egy hétnél hosszabban álló ütemező után a régebbi határt a következő
 * forrás-változás viszi ki.
 */
const AKCIO_ABLAK_MS = 7 * 24 * 60 * 60 * 1000;
