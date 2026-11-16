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
import {
  MEDUSA_ORPHAN_METADATA_KEY,
  MEDUSA_PRODUCT_REFERENCE,
  MedusaProductLinkRepository,
} from "./medusa-product-link.repository.js";
import { runPricingCli } from "./medusa-pricing.cli.js";
import {
  addPriceConflictShape,
  priceFailureCounts,
  priceRetryProducts,
  recordPriceAttempt,
  type PriceConflictShape,
  type PriceSyncDatabase,
} from "./medusa-price-sync.js";
import { nativeFieldKeys } from "../../products/attributes/public-fields.js";
import { projectKnowledgeEnabled } from "./medusa-product-knowledge.service.js";
import { runProjectionCli } from "./medusa-projection.runner.js";
import {
  medusaClientForProjection,
  storedCredentialProvider,
} from "./medusa-projection.cli.js";
import {
  skuParositas,
  type ShippingAttributesCliDatabase,
} from "./medusa-shipping-attributes.cli.js";
import {
  clearLeftoverKinds,
  describeLeftoverKinds,
  liveAnimalProductIds,
  type LeftoverKindReport,
} from "./medusa-leftover-kind.js";
import { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";
import { prismaRedirectSource } from "./medusa-redirect.cli.js";
import {
  describeHomepageProjection,
  prismaHomepageSource,
  projectHomepageContent,
  projectHomepageContentInRound,
  type HomepageProjectionOutcome,
} from "./medusa-homepage-projection.js";
import {
  describeLandingProjection,
  prismaLandingSource,
  projectLandingPages,
  type LandingPageOutcome,
} from "./medusa-landing-projection.js";
import {
  describeLivestockArrivalsProjection,
  type LivestockArrivalsOutcome,
  prismaLivestockArrivalSource,
  projectLivestockArrivals,
  projectLivestockArrivalsInRound,
} from "./medusa-livestock-arrivals-projection.js";
import {
  describeRedirectProjection,
  projectUrlRedirects,
  type RedirectProjectionOutcome,
} from "./medusa-redirect-projection.js";

/**
 * AZ ÁTIRÁNYÍTÁS-LISTA A KÖRBEN (SEO P0 PR 7b), kapcsolóval, alapból KI: a
 * commerce `url_redirect` modulja (PR 7a) előbb kerül ki, és amíg nincs ott, a
 * kör egy nem létező végpontot kérdezne. Bekapcsolva egy kör egy `GET`, és
 * `PUT` csak eltérésnél.
 */
export const projectRedirectsInRound = (env: NodeJS.ProcessEnv): boolean =>
  env.MEDUSA_PROJECT_REDIRECTS === "true";

/**
 * A LANDING OLDALAK A KORBEN (SEO P1-14), ugyanugy kapcsoloval, alapbol KI: a
 * commerce `landing_page` modulja (#541) elobb kerul ki.
 */
export const projectLandingPagesInRound = (env: NodeJS.ProcessEnv): boolean =>
  env.MEDUSA_PROJECT_LANDING_PAGES === "true";

/**
 * A BOLTBAN MARADT ELO ALLAT FAJTA LETORLESE A KORBEN (V2.6 S1b koveto, kartya 4b30b373, acrobot 2026-11-10), kapcsoloval,
 * alapbol KI, ugyanugy, mint a tobbi lista-lepes: a lepes a boltba IR, es az iras joga nem engedely. Bekapcsolva egy kor
 * egy olvasas (a bolt szallitasi-jellemzo sorai), es iras csak ott, ahol a bolti sor fajtat visel, az OS-termeknek
 * pedig nincs elo allat besorolasa: a fajta mezo null lesz, a tobbi zaszlo valtozatlan.
 */
export const clearLeftoverKindInRound = (env: NodeJS.ProcessEnv): boolean =>
  env.MEDUSA_CLEAR_LEFTOVER_KIND === "true";

/**
 * A BOLTBAN MARADT, AZ OS ALTAL SZARMAZTATOTT CSAK BOLTI ATVETEL LEVETELE A KORBEN (kartya c603774e, acrobot 45810), KULON
 * kapcsoloval, alapbol KI (a fajta kapcsolojatol fuggetlenul: az mar fut a teszten, ez nem inditjuk vele). Iras csak ott, ahol
 * a bolti sor `pickup_only` igaz ES az OS jelolte (commerce #724), az OS-termeknek nincs elo allat besorolasa, es a profil-sora
 * nem mondja ki az atvetelt. Egy kezzel bekapcsolt ertek (jelolo nelkul) soha. Iras elott a sort ujra olvassa.
 */
export const clearLeftoverPickupInRound = (env: NodeJS.ProcessEnv): boolean =>
  env.MEDUSA_CLEAR_LEFTOVER_PICKUP === "true";

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
 * A LASSU FRISSITESI FORGAS KAPCSOLOJA (kartya d8b512cb, acrobot 53592).
 *
 * AZ ESEDEKESSEG IDOBELYEG-ALAPU (`decideProjectionDue`): egy termek, amelynek az OS-sora az utolso vetites ota nem
 * valtozott, sosem esedekes, akarmi all a boltban. Mert egy rossz ertek a bolt oldalan (korabbi hibas iras, kezi atiras)
 * igy nem javul ki magatol (merve 2026-11-15, teszt Medusa: hat termek leirasaban kerdojeles futas allt 2026-10-07 ota,
 * pedig az OS leirasa tiszta volt; egy kezi vetites javitotta ki mind a hatot).
 *
 * A FORGAS NEM OSSZEHASONLIT, HANEM UJRAVETIT: nincs elvart allapot, amit ki kellene szamolni (azt a futtato allitja
 * ossze a termekbol, es az osszehasonlito annak a masolata lenne, tehat eltérne tole). Korankent legfeljebb `perRound`
 * olyan termek kerul a lista VEGERE, amelyik nem esedekes, a legregebben vetitettek kozul. Az esedekes termek
 * elsobbseget elvez: a forgas csak a maradek keretet toltheti.
 *
 * ALAPBOL KI, mert a vetites IR egy kulso rendszerbe: kornkent `perRound` idempotens iras. A teszt kornyezetben
 * bekapcsolhato, acrobot dontesevel; az ELES bolt ellen bekapcsolni KULON dontes, es az BALAZSE.
 */
export interface ProjectionRefreshConfig {
  enabled: boolean;
  perRound: number;
}

export function projectionRefreshConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProjectionRefreshConfig {
  if (environment.MEDUSA_PROJECTION_REFRESH_ENABLED !== "true")
    return { enabled: false, perRound: 0 };
  return {
    enabled: true,
    perRound: boundedInteger(
      environment.MEDUSA_PROJECTION_REFRESH_PER_ROUND,
      5,
      1,
      50,
      "MEDUSA_PROJECTION_REFRESH_INVALID",
    ),
  };
}

/**
 * AZ ADATBAZIS-HOZZAFERES PARAMETERKENT, ugyanabbol az okbol, mint a
 * futtatonal: enelkul a `runOnce` eles adatbazis nelkul nem merheto.
 */
export type ProjectionSchedulerDatabase = Pick<
  typeof prisma,
  | "product"
  | "externalReference"
  | "unasProductSnapshot"
  /** A saját akció határa (T4.1-D3, akció 2. szelet): az átvett termék akciója a változaton áll. */
  | "productVariant"
  /** A tények változása (SEO P0 PR 8): a tény-írás a terméket nem érinti. */
  | "productKnowledgeFact"
  /** A natív célú kulcsok (tömeg, méret): azok akkor is esedékessé tesznek, ha a termékismeret ki van kapcsolva. */
  | "attributeDefinition"
  /** A márka változása (t11): az átnevezés és a SEO-mezők a terméket nem érintik. */
  | "brand"
  /** A kezdőlap kapcsolója (az admin szerkesztő-oldali kapcsolója, egy sor). */
  | "homepageContent"
>;

/** A futtato, amit a `runOnce` hiv. Parameter, hogy cserelheto legyen. */
export type ProjectionRunner = (
  productIds: string[],
  out: {
    stdout(value: string): void;
    stderr(value: string): void;
    /** Termékenkénti kudarc (az ár-futás adja; a termék-vetítés nem). A `conflict` csak a kétértelmű árnál jön. */
    failed?(
      productId: string,
      reason: string,
      conflict?: PriceConflictShape,
    ): void;
  },
) => Promise<number>;

export type ProjectionRunOutcome = "APPLIED" | "SKIPPED" | "FAILED";

/** A kör esedékes-forrásai, a sorrendjükben: egy termék az ELSŐ forrásánál számít. */
export const PROJECTION_ROUND_SOURCES = [
  "sale",
  "fact",
  "brand",
  "general",
  "inactive",
  /** A lassu frissitesi forgas (d8b512cb): a sor VEGEN, csak a maradek keretet toltheti. */
  "refresh",
] as const;
export type ProjectionRoundSource = (typeof PROJECTION_ROUND_SOURCES)[number];

/**
 * A VETÍTŐ SORA KÍVÜLRŐL (ca422e92, acrobot 45402): a teszt API naplója és
 * környezete nem olvasható a flottának, tehát az, hogy egy termékcsoport
 * sorra kerül-e, vagy egy másik forrás minden kört kitölt (kiéheztetés), csak
 * innen dönthető el. Csak számok és időpontok: termék-azonosító, név és titok
 * nincs benne, és a lekérdezése nem dolgozik (a kör maga írja, memóriába).
 *
 *   candidates        forrásonként a jelöltek száma, a kör vágása ELŐTT (az
 *                     `general` legfeljebb a keret, mert a forrása is vág)
 *   taken             forrásonként, hány ment ebbe a körbe (az első forrásánál)
 *   inactiveDueTotal  az összes esedékes inaktivált kötött termék, a vágás előtt
 */
export type ProjectionRoundStatus = {
  enabled: boolean;
  batchSize: number;
  intervalMinutes: number;
  /** a folyamat (és az időzítő) indulása: újraindításkor ez is újraindul */
  schedulerStartedAt: string | null;
  nextRoundAt: string | null;
  lastRound: {
    startedAt: string;
    finishedAt: string | null;
    outcome: ProjectionRunOutcome | "ERROR" | null;
    candidates: Record<ProjectionRoundSource, number> | null;
    taken: Record<ProjectionRoundSource, number> | null;
    inactiveDueTotal: number | null;
    priceRetry: number | null;
    /**
     * az ujraprobalasbol kimaradt ar-kudarcok (550b80d1): a termek azota inaktivalt, nem webshopos, torolt, vagy nincs
     * Medusa kotese. Az ilyen termek ara nem kell (draftkent all, vagy nincs a boltban), es az ar-futas minden
     * ujraproban ugyanazzal bukna; ha a termek visszater, a termek-vetites esedekesse teszi, es az ara azzal megy ki.
     */
    priceRetryDropped: number | null;
    /**
     * az ar-futas kudarcai okfajtankent (550b80d1): a stage naploja a flottanak nem olvashato, a tarolt ok pedig csak az
     * adatbazisban all. Csak a fajta kodja (`own-price-missing`, `variant-not-found`, `run-threw` ...), cikkszam es
     * termek-azonosito nelkul; egy termek tobb valtozata tobbszor szamit. null = a korben nem futott ar.
     */
    priceFailures: Record<string, number> | null;
    /**
     * a termek-vetites MEGALLT termekei okfajtankent (2026-11-16, acrobot 53685): a stage naploja a flottanak nem
     * olvashato, a FAILED kor oka (a futtato minden megallt termekre `failed`-et noveli, es a kilepesi kod 1) pedig csak
     * ott allt. Csak a MEGALLT sor zarojeles okanak kodja (`no-sku`, `ambiguous` ...), `[a-z0-9-]`-re szurve, termek-azonosito
     * es reszlet nelkul. Egy megallt termek a koteset nem leptetni, tehat minden korben esedekes marad: ebbol latszik, hogy
     * ugyanazok foglaljak-e a keretet. null = a korben nem futott termek-vetites.
     */
    stopped: Record<string, number> | null;
    /**
     * a JELOLT ARVA kotesek szama (2026-11-16, acrobot 53748): olyan bolti termekre mutat a kotes, ami a boltban mar nincs (HTTP 404).
     * A vetites az ilyet NEM probalja ujra (a general, az inaktivalt es a forgas listabol kimarad, es a kor nem lesz tole FAILED):
     * egy 404 rendszerint szandekos bolti torlest jelent, amirol ember dont (`--forget-link`). A jel igy nem tunik el, csak nem
     * bukat: ez a szam mutatja. null = a kotesek olvasasa elbukott (a kor ilyenkor semmit nem hagy ki).
     */
    orphanedLinks: number | null;
    /**
     * a kor `ambiguous-price` kudarcainak utkozo forint sorai alakonkent (550b80d1), azonosito nelkul: arlistas,
     * szabalyos, mennyisegi, sima, vagy a valasz nem hozta a jelet (`unknown`). null = nem volt ketertelmu ar.
     */
    priceConflictRows: PriceConflictShape | null;
    /** a lista-lepesek szamai (csak szamok, azonosito nincs); null = a lepes ebben a korben nem futott (kapcsolo ki) */
    steps: RoundStepCounts;
  } | null;
};

/**
 * A LISTA-LEPESEK SZAMAI A KORBEN (acrobot 45814): a stage API naploja a flottanak nem olvashato, a lepes eredmenye
 * (hany sor, hanyon fajta, hany torolve) viszont csak ott allt. A lepesek a SKIPPED kor elott futnak, tehat egy ures
 * kor is hoz szamot. `failed: true` = a lepes dobott (a naploban az ok), a termek-vetites tovabb futott.
 */
export type RoundStepCounts = {
  leftoverKind:
    | { failed: true }
    | {
        failed: false;
        rows: number;
        carrying: number;
        /** hanyon all az OS altal jelolt, szarmaztatott csak bolti atvetel (kartya c603774e) */
        derivedPickup: number;
        cleared: number;
        unpaired: number;
      }
    | null;
  arrivals:
    | { failed: true }
    | {
        failed: false;
        status: LivestockArrivalsOutcome["status"];
        count: number;
        leftOut: number;
      }
    | null;
};

type KorAllapot = NonNullable<ProjectionRoundStatus["lastRound"]>;

/**
 * A MEGALLT SOROK SZAMLALASA (acrobot 53685). A futtato minden megallt termekre egy `<azonosito>: MEGÁLLT (<ok>) <reszlet>`
 * sort ir a hibakimenetre; innen CSAK az ok kodja kerul a szamlaloba: kisbetusre es `[a-z0-9-]`-re szurve (egy szabad szoveg
 * nem lehet kulcs), ures marad `unknown`. Az azonositot es a reszletet nem olvassa. Egy hivasban tobb sor is johet.
 */
export function countStoppedLines(
  text: string,
  into: Record<string, number>,
): void {
  for (const m of text.matchAll(/: MEGÁLLT \(([^)\n]{0,60})\)/g)) {
    const kod = m[1]!.toLowerCase().replace(/[^a-z0-9-]/g, "") || "unknown";
    into[kod] = (Object.hasOwn(into, kod) ? into[kod]! : 0) + 1;
  }
}

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
  /** Az átirányítás-lista köre (SEO P0 PR 7b). */
  runRedirects?: () => Promise<RedirectProjectionOutcome>;
  /** A landing oldalak köre (SEO P1-14). */
  runLandingPages?: () => Promise<LandingPageOutcome[]>;
  /** A kezdőlap tartalmának köre (Balázs, 2026-10-20). */
  runHomepageContent?: () => Promise<HomepageProjectionOutcome>;
  /** Be van-e kapcsolva a kezdőlap küldése: a változó VAGY az admin kapcsolója. */
  homepageSwitchedOn?: () => Promise<boolean>;
  /** Az érkező állatok listájának köre (V2.6 S4b). */
  runLivestockArrivals?: () => Promise<LivestockArrivalsOutcome>;
  /** A boltban maradt élő állat fajta letörlésének köre (kártya 4b30b373). */
  runLeftoverKinds?: () => Promise<LeftoverKindReport>;
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
  private indulas: Date | null = null;
  private kovetkezoKor: Date | null = null;
  private utolsoKor: KorAllapot | null = null;
  /** Az utolsó `inaktivaltAzonositok` hívás összes esedékese, a vágás előtt. */
  private inaktivEsedekesOsszesen = 0;

  private readonly db: ProjectionSchedulerDatabase;
  private readonly runProjection: ProjectionRunner;
  private readonly runPricing: ProjectionRunner;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly naplo: ProjectionSchedulerLogger;
  private readonly now: () => Date;
  private readonly runRedirects: () => Promise<RedirectProjectionOutcome>;
  private readonly runLandingPages: () => Promise<LandingPageOutcome[]>;
  private readonly runHomepageContent: () => Promise<HomepageProjectionOutcome>;
  private readonly homepageOn: () => Promise<boolean>;
  private readonly runLivestockArrivals: () => Promise<LivestockArrivalsOutcome>;
  private readonly runLeftoverKinds: () => Promise<LeftoverKindReport>;
  /** Az első lefutás összegzést is naplóz (ez a futás látható jele), a többi csak, ha törölt valamit. */
  private fajtaElsoKor = true;
  /** Hany URES kor telt el egymas utan. A nem-ures kor nullazza. */
  private egymasUtaniUresKorok = 0;
  /** Az inaktivált lista forgó kezdete (`inaktivaltAzonositok`): ahányat egy kör ténylegesen vitt, annyit lép. */
  private inaktivEltolas = 0;
  /**
   * A forgasbol mar kivalasztott termek -> a `lastSyncedAt` (ms) a kivalasztaskor. Ha a termek legkozelebb UGYANAZZAL
   * az ertekkel jelentkezik, a vetitese nem lepteti a kotest (megallt, vagy nem sikerult): a sor vegere kerul, hogy
   * a mogotte allok sorra keruljenek. Memoriaban el, ujrainduláskor nullazodik (a vesztes egy ujabb proba).
   */
  private frissitesProbalt = new Map<string, number>();
  /** Az utolso `frissitesAzonositok` valasztasa (id -> `lastSyncedAt` ms): a kor a ténylegesen vitt tagokat jegyzi fel. */
  private frissitesValasztott = new Map<string, number>();

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
    this.runRedirects =
      deps?.runRedirects ??
      (async () =>
        projectUrlRedirects(
          await medusaClientForProjection(storedCredentialProvider(), {
            stdout: (value) => this.logNemUres(value, "log"),
            stderr: (value) => this.logNemUres(value, "warn"),
          }),
          prismaRedirectSource,
          true,
        ));
    this.runLandingPages =
      deps?.runLandingPages ??
      (async () =>
        projectLandingPages(
          await medusaClientForProjection(storedCredentialProvider(), {
            stdout: (value) => this.logNemUres(value, "log"),
            stderr: (value) => this.logNemUres(value, "warn"),
          }),
          prismaLandingSource,
          true,
        ));
    this.runLivestockArrivals =
      deps?.runLivestockArrivals ??
      (async () =>
        projectLivestockArrivals(
          await medusaClientForProjection(storedCredentialProvider(), {
            stdout: (value) => this.logNemUres(value, "log"),
            stderr: (value) => this.logNemUres(value, "warn"),
          }),
          prismaLivestockArrivalSource,
          true,
        ));
    this.runLeftoverKinds =
      deps?.runLeftoverKinds ??
      (async () => {
        const out = {
          stdout: (value: string) => this.logNemUres(value, "log"),
          stderr: (value: string) => this.logNemUres(value, "warn"),
        };
        const service = new MedusaShippingAttributesService(
          new MedusaProductLinkRepository(),
          await medusaClientForProjection(storedCredentialProvider(), out),
        );
        const database = prisma as unknown as ShippingAttributesCliDatabase;
        const eloAllat = await liveAnimalProductIds(database);
        const pickupOn = clearLeftoverPickupInRound(this.environment);
        // a profil-sor kimondott atvetele tudatos ertek: azt a lepes nem veszi le
        const profilAtvetel = pickupOn
          ? new Set(
              (
                await database.productShippingProfile.findMany({
                  where: { pickupOnly: true },
                  select: { productId: true },
                })
              ).map((sor) => sor.productId),
            )
          : null;
        return clearLeftoverKinds(service, {
          kind: clearLeftoverKindInRound(this.environment),
          pickup: profilAtvetel
            ? { keep: (osProductId) => profilAtvetel.has(osProductId) }
            : undefined,
          skip: (osProductId) => eloAllat.has(osProductId),
          // lusta: a bolt SKU-listajat csak akkor olvassuk, ha van kotes-sor nelkuli, fajtat viselo bolti sor
          pairing: async () => (await skuParositas(service, database)).osToShop,
          apply: true,
        });
      });
    this.homepageOn =
      deps?.homepageSwitchedOn ??
      (() =>
        projectHomepageContentInRound(this.environment, {
          switchedOn: async () =>
            (
              await this.db.homepageContent.findUnique({
                where: { key: "main" },
                select: { projectionEnabled: true },
              })
            )?.projectionEnabled === true,
        }));
    this.runHomepageContent =
      deps?.runHomepageContent ??
      (async () =>
        projectHomepageContent(
          await medusaClientForProjection(storedCredentialProvider(), {
            stdout: (value) => this.logNemUres(value, "log"),
            stderr: (value) => this.logNemUres(value, "warn"),
          }),
          prismaHomepageSource,
          true,
        ));
  }

  onModuleInit(): void {
    const config = medusaProjectionScheduleConfig(this.environment);
    if (!config.enabled) return;
    /*
      A FORGÁS BEÁLLÍTÁSA IS INDULÁSKOR BUKJON (barracuda, #2623): a kör csak a forgás forrásánál értékelné, és egy
      elgépelt darabszám (0, 100) bekapcsolt forgásnál MINDEN kört ERROR-ra futtatna, vagyis a teljes vetítést megállítaná.
      Itt az indulást állítja meg, ami látható.
    */
    const forgas = projectionRefreshConfig(this.environment);
    if (forgas.enabled)
      this.naplo.log(
        `Medusa projection refresh rotation enabled (${forgas.perRound} per round)`,
      );
    this.naplo.log(
      `Medusa projection scheduler enabled (${config.intervalMs / 60_000} min, ` +
        `batch ${config.batchSize})`,
    );
    this.indulas = this.now();
    this.schedule(config.startupDelayMs, config.intervalMs);
  }

  /** A sor állapota a `GET /health/medusa-projection` számára: másolat, nem élő hivatkozás. */
  allapot(): ProjectionRoundStatus {
    const config = medusaProjectionScheduleConfig(this.environment);
    const kor = this.utolsoKor;
    return {
      enabled: config.enabled,
      batchSize: config.batchSize,
      intervalMinutes: config.intervalMs / 60_000,
      schedulerStartedAt: this.indulas?.toISOString() ?? null,
      nextRoundAt: this.kovetkezoKor?.toISOString() ?? null,
      lastRound: kor
        ? {
            ...kor,
            candidates: kor.candidates && { ...kor.candidates },
            taken: kor.taken && { ...kor.taken },
            priceFailures: kor.priceFailures && { ...kor.priceFailures },
            stopped: kor.stopped && { ...kor.stopped },
            priceConflictRows: kor.priceConflictRows && {
              ...kor.priceConflictRows,
            },
            steps: {
              leftoverKind: kor.steps.leftoverKind && {
                ...kor.steps.leftoverKind,
              },
              arrivals: kor.steps.arrivals && { ...kor.steps.arrivals },
            },
          }
        : null,
    };
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
    const kor: KorAllapot = {
      startedAt: this.now().toISOString(),
      finishedAt: null,
      outcome: null,
      candidates: null,
      taken: null,
      inactiveDueTotal: null,
      priceRetry: null,
      priceRetryDropped: null,
      priceFailures: null,
      stopped: null,
      orphanedLinks: null,
      priceConflictRows: null,
      steps: { leftoverKind: null, arrivals: null },
    };
    this.utolsoKor = kor;
    try {
      kor.outcome = await this.kor(kor);
      return kor.outcome;
    } catch (error) {
      kor.outcome = "ERROR";
      throw error;
    } finally {
      kor.finishedAt = this.now().toISOString();
    }
  }

  private async kor(allapot: KorAllapot): Promise<ProjectionRunOutcome> {
    const config = medusaProjectionScheduleConfig(this.environment);
    const limit = config.batchSize || DEFAULT_BATCH;
    /*
      AZ AKCIÓ HATÁRA IS ESEDÉKESSÉ TESZ (329f8a2e, acrobot 27356). Az UNAS
      gazdájú termék ára az óra szerint vált (`isSaleActive(now)`): amikor egy
      akció elindul vagy lejár, semmi nem íródik, tehát a forrás-időbélyegek
      közül egyik sem mozdul, és a bolt a régi árat tartja. Az akciós termékek
      állnak elöl, hogy egy teli kör ne szorítsa ki őket.
    */
    await this.atiranyitasKor();
    await this.landingKor();
    await this.kezdolapKor();
    await this.erkezoAllatokKor(allapot);
    await this.fajtaKor(allapot);
    const kezdet = this.now();
    // a jelolt arva kotesek: nem esedekesek sehol (lasd a `orphanedLinks` mezo)
    const arvak = await this.arvaKotesek();
    allapot.orphanedLinks = arvak ? arvak.size : null;
    const nemArva = (id: string) => !arvak?.has(id);
    const akcio = (await this.akcioHatarAzonositok()).filter(nemArva);
    const teny = (await this.tenyValtozasAzonositok()).filter(nemArva);
    const marka = (await this.markaValtozasAzonositok()).filter(nemArva);
    /*
      AZ INAKTIVÁLT TERMÉK A SOR VÉGÉN (ca422e92): a kifutott lap késése kisebb
      kár, mint egy értékesíthető terméké, és az első körök visszamenőleges
      halmazát így a napi változások nem várják ki.
    */
    const altalanos = await this.esedekesAzonositok(limit, arvak);
    const inaktivalt = await this.inaktivaltAzonositok(limit, arvak);
    const frissites = await this.frissitesAzonositok(
      new Set([...akcio, ...teny, ...marka, ...altalanos, ...inaktivalt]),
      arvak,
    );
    const esedekes = [
      ...new Set([
        ...akcio,
        ...teny,
        ...marka,
        ...altalanos,
        ...inaktivalt,
        ...frissites,
      ]),
    ].slice(0, limit);
    // a forgásból CSAK a ténylegesen vitt termék számít kipróbáltnak (a keret által levágott nem)
    for (const id of esedekes) {
      const mikor = this.frissitesValasztott.get(id);
      if (mikor !== undefined) this.frissitesProbalt.set(id, mikor);
    }
    // a forgás annyit lép, ahány inaktivált termék ebben a körben ténylegesen sorra került
    const elotte = new Set([...akcio, ...teny, ...marka, ...altalanos]);
    this.inaktivEltolas += esedekes.filter(
      (id) => inaktivalt.includes(id) && !elotte.has(id),
    ).length;
    const forrasok: Record<ProjectionRoundSource, string[]> = {
      sale: akcio,
      fact: teny,
      brand: marka,
      general: altalanos,
      inactive: inaktivalt,
      refresh: frissites,
    };
    allapot.candidates = {} as Record<ProjectionRoundSource, number>;
    allapot.taken = {} as Record<ProjectionRoundSource, number>;
    const szamolt = new Set<string>();
    for (const forras of PROJECTION_ROUND_SOURCES) {
      allapot.candidates[forras] = forrasok[forras].length;
      allapot.taken[forras] = forrasok[forras].filter(
        (id) => esedekes.includes(id) && !szamolt.has(id),
      ).length;
      for (const id of forrasok[forras]) szamolt.add(id);
    }
    allapot.inactiveDueTotal = this.inaktivEsedekesOsszesen;
    /*
      AZ ELBUKOTT ÁR ESEDÉKES MARAD (329f8a2e, murena tény-kommentje, acrobot
      27698). A termék-kötés `lastSyncedAt`-jét csak a termék-vetítés írja, tehát
      egy kör után, amiben a termék kiment, de az ára nem, a termék a következő
      forrás-változásig nem került volna sorra. Ezek a termékek CSAK az ár-futásba
      mennek: a termék-vetítésük sikerült, nincs mit megismételni.
    */
    /*
      CSAK AZ ÁRAZHATÓ PRÓBÁL ÚJRA (550b80d1). Az inaktivált és a nem webshopos termék a termék-vetítésből sem kap árat
      (lent: `arra`), a kötés nélküli pedig nincs a boltban: az ilyen újrapróba visszalépésenként ugyanazzal bukna, és
      a kört FAILED-dé tenné. A soruk marad; ha a termék visszatér, a forrása változik, és az ára a termék-vetítéssel
      megy ki. A szűrés a vágás ELŐTT áll, hogy a kimaradók ne szorítsák ki az árazhatókat.
    */
    const arUjraJeloltek = (
      await priceRetryProducts(this.db as unknown as PriceSyncDatabase, kezdet)
    ).filter((id) => !esedekes.includes(id));
    const arUjraArazhato = await this.arazhatoUjra(arUjraJeloltek);
    const arUjra = arUjraArazhato.slice(0, limit);
    allapot.priceRetry = arUjra.length;
    allapot.priceRetryDropped = arUjraJeloltek.length - arUjraArazhato.length;
    if (!esedekes.length && !arUjra.length) {
      this.uresKorNaploja();
      return "SKIPPED";
    }
    this.egymasUtaniUresKorok = 0;

    const kimenet = {
      stdout: (value: string) => this.logNemUres(value, "log"),
      stderr: (value: string) => this.logNemUres(value, "warn"),
    };
    /*
      A MEGALLT SOROKAT CSAK A TERMEK-VETITES KIMENETE SZAMOLJA (barracuda, #2624, blokkolo): az ar-futtato (lent) ugyanezt a
      `kimenet`-et kapja, es ugyanilyen alaku `<cikkszam>: MEGÁLLT (<ok>)` sort ir (`ambiguous-price`, `own-price-missing`); az a
      `priceFailures`-ben mar szerepel, a `stopped` pedig a TERMEK-vetites megallt termekeit mondja. A szamolo ezert a termek-
      vetites SAJAT kimenet-objektumara kerul, nem a kozosre.
    */
    const termekKimenet = {
      ...kimenet,
      // a megallt termekek okfajtankent (a sor tovabbra is a naploba megy, valtozatlanul)
      stderr: (value: string) => {
        if (allapot.stopped) countStoppedLines(value, allapot.stopped);
        kimenet.stderr(value);
      },
    };
    if (esedekes.length) allapot.stopped = {};
    const kod = esedekes.length
      ? await this.runProjection(esedekes, termekKimenet)
      : 0;
    if (arUjra.length)
      this.naplo.log(
        `Medusa price projection: ${arUjra.length} termek ara ujraprobal ` +
          `(korabbi ar-kudarc utan)`,
      );

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
    // az inaktivált termék draftként megy ki, ára nem kell (és aktív változat
    // nélkül az ár-futás minden körben kudarcot írna rá)
    const arra = esedekes.filter((id) => !inaktivalt.includes(id));
    const kotesek = await this.kotottAzonositok([...arra, ...arUjra]);
    const arazhato = [...kotesek.keys()];
    const kotesNelkul = arra.length + arUjra.length - arazhato.length;
    if (kotesNelkul > 0)
      this.naplo.log(
        `Medusa price projection: ${kotesNelkul} termek Medusa kotes nelkul, ` +
          `az aruk nem ment ki`,
      );
    const kudarc = new Map<string, string[]>();
    /*
      A KIVÉTEL IS KUDARC (barracuda előzetes átnézése, acrobot 27710). Ha az
      ár-futás nem kóddal tér vissza, hanem dob (egy nem várt hiba a futtatóban,
      a feloldásban vagy a kiírásban), a rögzítés nélküle le sem futna: az ebben
      a körben először esedékes termékek nem kapnának kudarc-jelet, az
      újrapróbálás alattiak pedig visszalépés nélkül jönnének minden körben.
      Ezért minden árazható termék kudarcot kap; azt nem tudjuk, melyik ment ki
      a dobás előtt, és egy fölösleges újrapróba olcsóbb egy elmaradtnál. A
      naplóba csak a hiba fajtája megy: az üzenete termék-adatot hordozhat.
    */
    let arKod = 0;
    if (arazhato.length)
      try {
        arKod = await this.runPricing(arazhato, {
          ...kimenet,
          failed: (productId, reason, conflict) => {
            kudarc.set(productId, [...(kudarc.get(productId) ?? []), reason]);
            if (conflict)
              allapot.priceConflictRows = addPriceConflictShape(
                allapot.priceConflictRows,
                conflict,
              );
          },
        });
      } catch (error) {
        const fajta = error instanceof Error ? error.name : "UNKNOWN";
        this.naplo.error(
          `Medusa price projection: az ar-futas kivetellel allt le (${fajta})`,
        );
        for (const id of arazhato)
          kudarc.set(id, [
            ...(kudarc.get(id) ?? []),
            `az ar-futas kivetellel allt le: ${fajta}`,
          ]);
        arKod = 1;
      }
    /*
      A NEM-NULLA KÓD TERMÉK NÉLKÜL A FUTÁS EGÉSZÉNEK BUKÁSA (például a bolt
      hitelesítése): ekkor egyik ár sem ment ki, tehát mindegyik kudarc. Ha ezt
      sikerként rögzítenénk, épp az a hiba ismétlődne, amit ez a rész javít.
    */
    if (arKod !== 0 && kudarc.size === 0)
      for (const id of arazhato)
        kudarc.set(id, [`az ar-futas elbukott (kod ${arKod})`]);
    if (arazhato.length) allapot.priceFailures = priceFailureCounts(kudarc);
    for (const id of arazhato)
      await recordPriceAttempt(this.db as unknown as PriceSyncDatabase, {
        productId: id,
        medusaProductId: kotesek.get(id)!,
        startedAt: kezdet,
        failure: kudarc.get(id)?.join("; ") ?? null,
      });
    return kod === 0 && arKod === 0 ? "APPLIED" : "FAILED";
  }

  /**
   * AZ ÁTIRÁNYÍTÁS-LISTA EGY KÖRE, a termékek előtt, és a kör állapotától
   * függetlenül: a lista akkor is változhat, ha egy termék sem esedékes (kézi
   * szabály). A hibája csak napló: a termék-vetítést nem állítja meg, és a kör
   * kimenetét sem rontja, mert a lista a következő körben újra próbálkozik.
   */
  /**
   * A LANDING OLDALAK EGY KÖRE (SEO P1-14), az átirányítások után, ugyanazzal a
   * szabállyal: a hiba csak napló, a termék-vetítést nem állítja meg. Egy
   * visszatartott oldal (bolti pár nélküli kategória) figyelmeztetés.
   */
  private async landingKor(): Promise<void> {
    if (!projectLandingPagesInRound(this.environment)) return;
    try {
      const eredmeny = await this.runLandingPages();
      if (eredmeny.some((o) => o.status === "refused"))
        this.naplo.warn(describeLandingProjection(eredmeny));
      else if (eredmeny.some((o) => o.status !== "unchanged"))
        this.naplo.log(describeLandingProjection(eredmeny));
    } catch (error) {
      this.naplo.warn(
        `Landing oldalak: a kor nem futott le (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  /**
   * AZ ÉRKEZŐ ÁLLATOK EGY KÖRE (V2.6 S4b), a kezdőlap után, ugyanazzal a szabállyal: a hiba csak napló, a termék-vetítést
   * nem állítja meg. Kapcsolóval, alapból KI (a commerce modul, #719, előbb kerül ki).
   */
  private async erkezoAllatokKor(allapot: KorAllapot): Promise<void> {
    if (!projectLivestockArrivalsInRound(this.environment)) return;
    try {
      const eredmeny = await this.runLivestockArrivals();
      allapot.steps.arrivals = {
        failed: false,
        status: eredmeny.status,
        count: eredmeny.count,
        leftOut: eredmeny.leftOut ?? 0,
      };
      // a set over the shop's cap is a warning every round, changed or not (barracuda, #2354)
      if (eredmeny.leftOut)
        this.naplo.warn(describeLivestockArrivalsProjection(eredmeny));
      else if (eredmeny.status !== "unchanged")
        this.naplo.log(describeLivestockArrivalsProjection(eredmeny));
    } catch (error) {
      allapot.steps.arrivals = { failed: true };
      this.naplo.warn(
        `Erkezo allatok: a kor nem futott le (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  /**
   * A KEZDŐLAP TARTALMÁNAK EGY KÖRE, a landing oldalak után, ugyanazzal a
   * szabállyal: a hiba csak napló, a termék-vetítést nem állítja meg. A mentés
   * maga is kér egy kört, ez a tartalék, ha az elmaradt vagy elbukott.
   */
  private async kezdolapKor(): Promise<void> {
    try {
      if (!(await this.homepageOn())) return;
      const eredmeny = await this.runHomepageContent();
      if (
        (eredmeny.status !== "unchanged" && eredmeny.status !== "nothing") ||
        ("skippedHandles" in eredmeny && eredmeny.skippedHandles?.length)
      )
        this.naplo.log(describeHomepageProjection(eredmeny));
    } catch (error) {
      this.naplo.warn(
        `Kezdolap tartalom: a kor nem futott le (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  /**
   * A BOLTBAN MARADT FAJTA EGY KORE (kartya 4b30b373): a lista-lepesek szabalya szerint a hibaja csak naplo, a
   * termek-vetitest nem allitja meg. A kor naploja kiirja, MIT torolt; az elso lefutas az osszegzest is kiirja, hogy
   * a nulla torles ne nezzen ki ugy, mintha a lepes nem futott volna.
   */
  private async fajtaKor(allapot: KorAllapot): Promise<void> {
    if (
      !clearLeftoverKindInRound(this.environment) &&
      !clearLeftoverPickupInRound(this.environment)
    )
      return;
    try {
      const jelentes = await this.runLeftoverKinds();
      allapot.steps.leftoverKind = {
        failed: false,
        rows: jelentes.rows,
        carrying: jelentes.carrying,
        derivedPickup: jelentes.derivedPickup,
        cleared: jelentes.entries.filter((e) => e.action === "applied").length,
        unpaired: jelentes.unpaired,
      };
      if (jelentes.entries.length || this.fajtaElsoKor)
        this.naplo.log(describeLeftoverKinds(jelentes, true));
      this.fajtaElsoKor = false;
    } catch (error) {
      allapot.steps.leftoverKind = { failed: true };
      this.naplo.warn(
        `Boltban maradt fajta: a kor nem futott le (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  private async atiranyitasKor(): Promise<void> {
    if (!projectRedirectsInRound(this.environment)) return;
    try {
      const eredmeny = await this.runRedirects();
      if (eredmeny.status === "refused")
        this.naplo.warn(describeRedirectProjection(eredmeny));
      else if (eredmeny.status !== "unchanged")
        this.naplo.log(describeRedirectProjection(eredmeny));
    } catch (error) {
      this.naplo.warn(
        `Atiranyitasok: a kor nem futott le (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
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
    const tukor = await this.db.unasProductSnapshot.findMany({
      where: {
        OR: [{ saleStartsAt: ablak }, { saleEndsAt: ablak }],
        product: { isActive: true, webshopExcluded: false },
      },
      select: { productId: true, saleStartsAt: true, saleEndsAt: true },
    });
    /*
      A SAJÁT AKCIÓ HATÁRA IS (T4.1-D3, akció 2. szelet): az átvett termék akciója
      a változaton áll (`sellingSale*`), és ugyanúgy az óra szerint vált, írás
      nélkül. Csak ACROPORA gazdánál: a UNAS gazdájú termék árát a tükör adja, a
      saját akció mezői ott nem mennek ki (`resolvePriceSource`).
    */
    const sajat = await this.db.productVariant.findMany({
      where: {
        isActive: true,
        OR: [{ sellingSaleStartsAt: ablak }, { sellingSaleEndsAt: ablak }],
        product: {
          isActive: true,
          webshopExcluded: false,
          catalogAuthority: "ACROPORA",
        },
      },
      select: {
        productId: true,
        sellingSaleStartsAt: true,
        sellingSaleEndsAt: true,
      },
    });
    const sorok = [
      ...tukor,
      ...sajat.map((sor) => ({
        productId: sor.productId,
        saleStartsAt: sor.sellingSaleStartsAt,
        saleEndsAt: sor.sellingSaleEndsAt,
      })),
    ];
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

    return (
      sorok
        .filter((sor) => {
          if (!utoljara.has(sor.productId)) return false;
          const vetitve = utoljara.get(sor.productId) ?? null;
          const hatarok = [sor.saleStartsAt, sor.saleEndsAt].filter(
            (hatar): hatar is Date => hatar !== null && hatar <= most,
          );
          return hatarok.some((hatar) => vetitve === null || hatar > vetitve);
        })
        .map((sor) => sor.productId)
        // egy termék több változatának határa egy bejegyzés
        .filter((id, i, ids) => ids.indexOf(id) === i)
    );
  }

  /**
   * A TÉNY-VÁLTOZÁS IS ESEDÉKESSÉ TESZ (SEO P0 PR 8). Egy elfogadott tény (tömeg,
   * méret, termékismeret) nem írja a `Product` sort, és a tény-táblának nincs
   * helye a forrás-időbélyegek között: az új tény eddig csak a termék következő,
   * más okú változásával jutott ki. KÜLÖN LEKÉRDEZÉS, az akcióhatár-ág mintájára,
   * mert az esedékességi lekérdezés csak a legutóbb módosított termékeket olvassa.
   *
   * A döntés a kötés `lastSyncedAt`-je: ha a termék legutóbbi tény-változása
   * későbbi, esedékes. Egy vetítés után tehát újra nem az. Kötés nélküli termék
   * nem kerül be: azt az általános ág viszi (`NEVER_PROJECTED`).
   */
  private async tenyValtozasAzonositok(): Promise<string[]> {
    const most = this.now();
    /*
      A TERMEKISMERET KAPCSOLOJA (`MEDUSA_PROJECT_KNOWLEDGE`, alapbol KI; acrobot 41560): ha ki
      van kapcsolva, a termekismeret tenye nem tesz esedekessze, mert a vetites ugysem vinne ki
      oket, es egy jovahagyott S1-teny irasa igy nem indit koret. A NATIV CELU tenyek (tomeg,
      meret: a Medusa valtozat-mezoibe mennek, nem a termekismeretbe) a mai szabaly szerint
      maradnak esedekesseget okozok. Natív kulcs nelkul nincs mit nezni.
    */
    const nativ = projectKnowledgeEnabled(this.environment)
      ? null
      : await nativeFieldKeys(this.db);
    if (nativ && nativ.size === 0) return [];
    const sorok = await this.db.productKnowledgeFact.findMany({
      where: {
        updatedAt: { gt: new Date(most.getTime() - AKCIO_ABLAK_MS), lte: most },
        // egy automatikus tény nem megy ki, tehát vetítést sem indít
        acceptedByRule: null,
        ...(nativ ? { field: { in: [...nativ] } } : {}),
      },
      select: { productId: true, updatedAt: true },
    });
    if (!sorok.length) return [];
    const legutobbi = new Map<string, Date>();
    for (const sor of sorok) {
      const eddig = legutobbi.get(sor.productId);
      if (!eddig || sor.updatedAt > eddig)
        legutobbi.set(sor.productId, sor.updatedAt);
    }
    const kotesek = await this.db.externalReference.findMany({
      where: {
        ...MEDUSA_PRODUCT_REFERENCE,
        entityId: { in: [...legutobbi.keys()] },
      },
      select: { entityId: true, lastSyncedAt: true },
    });
    return kotesek
      .filter(
        (k) =>
          k.lastSyncedAt === null ||
          legutobbi.get(k.entityId)! > k.lastSyncedAt,
      )
      .map((k) => k.entityId);
  }

  /**
   * A MÁRKA VÁLTOZÁSA IS ESEDÉKESSÉ TESZI A TERMÉKEIT (t11, barracuda #1684).
   * A boltbeli márka-rekordot a termék-vetítés írja ki
   * (`MedusaBrandModuleService`), tehát egy átnevezés vagy a márka SEO-mezőinek
   * szerkesztése csak a márka valamelyik termékének következő, más okú
   * vetítésével jutott volna ki. Átnevezésnél ez rosszabb a késésnél: a 301
   * (`/hu/marka/régi` → `/hu/marka/új`) az átirányítás-körrel azonnal kimegy,
   * és addig egy 404-re visz. A márka-írás a `Product` sort nem érinti, ezért
   * KÜLÖN LEKÉRDEZÉS, a tény-változás mintájára.
   *
   * A döntés a kötés `lastSyncedAt`-je: ha a márka változása későbbi, a termék
   * esedékes; egy vetítés után már nem. Kötés nélküli termék nem kerül be.
   */
  private async markaValtozasAzonositok(): Promise<string[]> {
    const most = this.now();
    const markak = await this.db.brand.findMany({
      where: {
        updatedAt: { gt: new Date(most.getTime() - AKCIO_ABLAK_MS), lte: most },
      },
      select: { id: true, updatedAt: true },
    });
    if (!markak.length) return [];
    const valtozas = new Map(markak.map((m) => [m.id, m.updatedAt]));
    const termekek = await this.db.product.findMany({
      where: {
        brandId: { in: [...valtozas.keys()] },
        isActive: true,
        webshopExcluded: false,
      },
      select: { id: true, brandId: true },
    });
    if (!termekek.length) return [];
    const markaja = new Map(termekek.map((t) => [t.id, t.brandId]));
    const kotesek = await this.db.externalReference.findMany({
      where: {
        ...MEDUSA_PRODUCT_REFERENCE,
        entityId: { in: termekek.map((t) => t.id) },
      },
      select: { entityId: true, lastSyncedAt: true },
    });
    return kotesek
      .filter((k) => {
        const brandId = markaja.get(k.entityId);
        const mikor = brandId ? valtozas.get(brandId) : undefined;
        return (
          mikor !== undefined &&
          (k.lastSyncedAt === null || mikor > k.lastSyncedAt)
        );
      })
      .map((k) => k.entityId);
  }

  /**
   * A VETÍTÉS UTÁN INAKTIVÁLT TERMÉK IS ESEDÉKES (kártya ca422e92).
   *
   * Az általános esedékesség (`esedekesAzonositok`) csak aktív terméket olvas,
   * tehát egy termék, amit a legutóbbi vetítése UTÁN inaktiváltak, többé nem
   * került sorra: a boltban published maradt, vagy kifutott-jelölő nélküli
   * draft. Közben az átirányítás-lista (`productRedirectTarget`, #2323) a
   * régi címét a lapjára küldi, mert az OS szabálya szerint kifutott, és van
   * lapja -- a boltban viszont nincs (mérve 2026-11-09, 129 régi cím 404-en).
   *
   * CSAK A KÖTÖTT TERMÉK, és csak akkor, ha a változása későbbi a kötés
   * `lastSyncedAt`-jénél. Kötés nélküli inaktív termék soha nem esedékes: a
   * boltban nincs mit visszavonni, és a "még nem vetített" ág különben minden
   * körben előre hozná. A kiinduló halmaz a kötések listája, nem a legutóbb
   * módosított termékek ablaka: a régi inaktiválások is sorra kerülnek.
   *
   * A webshopból KIZÁRT termék nincs itt, és nem véletlenül: a jelölő csak
   * létrehozáskor íródik (beszerzési számla, árajánlat), a futtató a kizárt
   * terméket kötés nélkül nem vetíti, tehát kötött kizárt termék ma nem
   * keletkezhet.
   */
  private async inaktivaltAzonositok(
    limit: number,
    arvak: ReadonlySet<string> | null = null,
  ): Promise<string[]> {
    const kotesek = await this.db.externalReference.findMany({
      where: MEDUSA_PRODUCT_REFERENCE,
      // stabil sorrend: a forgó kezdet (lent) csak így jelent minden körben ugyanazt a helyet
      orderBy: { entityId: "asc" },
      select: { entityId: true, lastSyncedAt: true },
    });
    this.inaktivEsedekesOsszesen = 0;
    if (!kotesek.length) return [];
    /*
      SZELETENKÉNT (barracuda, #2332 review, 1. kérdés): egy felső határ nélküli
      `in`-lista a Postgres kötött-paraméter határán (32767) elhasal (#2019). Ma
      kb. 1500 kötés áll a teszt boltban; a szelet a növekedést is elviszi.
    */
    const valtozas = new Map<string, Date>();
    for (let i = 0; i < kotesek.length; i += KOTES_SZELET) {
      const termekek = await this.db.product.findMany({
        where: {
          id: {
            in: kotesek.slice(i, i + KOTES_SZELET).map((k) => k.entityId),
          },
          /*
            KIFUTOTT AZ IS, AMI AKTÍV, DE NEM WEBSHOPOS (ca422e92, 2026-11-09 este): a
            kifutott jelölőt (`isDiscontinued`) és az átirányítás-lista „lap” döntését
            (`productRedirectTarget`) az inaktív VAGY nem webshopos termék kapja. Csak az
            inaktívat nézve egy aktív, nem webshopos termék 301-et kapott a lapjára, a
            jelölőt viszont soha (a 129 régi cím: a `health/medusa-projection` első
            körében `inactiveDueTotal: 0`).
          */
          OR: [{ isActive: false }, { webshopSellable: false }],
          webshopExcluded: false,
        },
        select: {
          id: true,
          isActive: true,
          webshopSellable: true,
          updatedAt: true,
        },
      });
      // a szűrés a kódban is megvan: egy tágabb válasz se tegyen értékesíthető terméket ide
      for (const t of termekek)
        if (!t.isActive || !t.webshopSellable) valtozas.set(t.id, t.updatedAt);
    }
    /*
      A JELÖLŐ ELŐTT VETÍTETT INAKTÍV TERMÉK IS (ca422e92, acrobot mérése 2026-11-09 19:00):
      a 129 régi cím termékeit a vetítés már inaktívként vitte ki (draft), de még a
      kifutott-jelölő (V4.2, #2148, 11-04) előtt, tehát jelölő nélkül; a változásuk
      régebbi a kötésnél, és a fenti feltétel rájuk nem áll. Egyszer újra esedékesek:
      utána a kötés a pont után áll.
    */
    const esedekes = kotesek
      .filter((k) => !arvak?.has(k.entityId))
      .filter((k) => {
        const mikor = valtozas.get(k.entityId);
        return (
          mikor !== undefined &&
          (k.lastSyncedAt === null ||
            mikor > k.lastSyncedAt ||
            k.lastSyncedAt < KIFUTOTT_JELOLO_OTA)
        );
      })
      .map((k) => k.entityId);
    /*
      FORGÓ KEZDET (barracuda, #2332 review, 2. kérdés): egy inaktivált termék,
      ami MÁS okból megáll (pl. ellentmondó változat-opciók), nem lépteti a
      `lastSyncedAt`-et, tehát minden körben esedékes marad. Rögzített kezdettel
      a lista elején álló, beragadt termékek elfoglalnák a kör maradék helyeit, és
      a mögöttük állók soha nem kerülnének sorra. A kezdet annyit lép, ahányat a
      kör ténylegesen vitt (`runOnce`), tehát a sor körbejár, és mindenki sorra kerül.
    */
    this.inaktivEsedekesOsszesen = esedekes.length;
    if (!esedekes.length) return [];
    const kezdet = this.inaktivEltolas % esedekes.length;
    this.inaktivEltolas = kezdet;
    return [...esedekes.slice(kezdet), ...esedekes.slice(0, kezdet)].slice(
      0,
      limit,
    );
  }

  /**
   * A JELOLT ARVA KOTESEK (task t-20261116-arva-kotes, acrobot 53748): azok a Medusa termek-kotesek, amelyeken a vetites a
   * `medusaOrphan` jelet hagyta (a bolti termek 404-et adott). A kotes metaadatat KODBAN szuri, nem JSON-ut szurovel: egy ilyen
   * Prisma-szuro helyi adatbazis nelkul nem merheto, es ~1500 sor egyszeru olvasasa olcso. Ha az olvasas elbukik, `null`: a kor
   * semmit nem hagy ki (egy hianyzo szuro csak egy felesleges probalkozas, egy hibas szuro eltuntetne a termeket).
   */
  private async arvaKotesek(): Promise<Set<string> | null> {
    try {
      const sorok = await this.db.externalReference.findMany({
        where: MEDUSA_PRODUCT_REFERENCE,
        select: { entityId: true, metadata: true },
      });
      const arvak = new Set<string>();
      for (const sor of sorok) {
        const meta = sor.metadata as Record<string, unknown> | null | undefined;
        const jel = meta?.[MEDUSA_ORPHAN_METADATA_KEY];
        if (typeof jel === "object" && jel !== null) arvak.add(sor.entityId);
      }
      return arvak;
    } catch {
      return null;
    }
  }

  /**
   * A KIPRÓBÁLT-JEGYZET TISZTÍTÁSA: csak az marad, aminek a kötése `lastSyncedAt`-je a kiválasztás óta NEM lépett. A lépett
   * termék a lista végére került, az ablakon kívül, ezért az ablakból nem is tisztulna ki; egy lekérdezés a jegyzet
   * azonosítóira (szeletenként) megmondja, melyik lépett. A hiányzó kötés (törölt termék) is kiesik.
   */
  private async frissitesJegyzetTisztit(): Promise<void> {
    if (!this.frissitesProbalt.size) return;
    const azonositok = [...this.frissitesProbalt.keys()];
    const mostani = new Map<string, number | null>();
    for (let i = 0; i < azonositok.length; i += KOTES_SZELET) {
      const sorok = await this.db.externalReference.findMany({
        where: {
          ...MEDUSA_PRODUCT_REFERENCE,
          entityId: { in: azonositok.slice(i, i + KOTES_SZELET) },
        },
        select: { entityId: true, lastSyncedAt: true },
      });
      for (const sor of sorok)
        mostani.set(sor.entityId, sor.lastSyncedAt?.getTime() ?? null);
    }
    for (const [id, mikor] of this.frissitesProbalt)
      if (mostani.get(id) !== mikor) this.frissitesProbalt.delete(id);
  }

  /**
   * A LASSU FRISSITESI FORGAS JELOLTJEI (kartya d8b512cb): a legregebben vetitett, de NEM esedekes termekek.
   *
   * CSAK A KOTOTT, MAR VETITETT, AKTIV, WEBSHOPOS, NEM KIZART TERMEK. A soha nem vetitett (`lastSyncedAt` nincs) az
   * altalanos esedekessegnel megy ki; az inaktivalt es a nem webshopos az `inaktivaltAzonositok` dolga; a kizart soha
   * nem vetitodik. A szures a kodban is megvan: egy tagabb valasz se vigyen a forgasba olyan termeket, amit a futtato
   * megtagad.
   *
   * A KIVALASZTAS NEM FORGO KEZDET, HANEM "KIPROBALT" JELOLES. A kotes `lastSyncedAt`-jet csak egy sikeres vetites
   * lepteti, es a vetites utan a termek a lista VEGERE kerul: a forgo kezdet itt a legregebbi termekeket hagyna ki.
   * Egy termek viszont, amelyik megall (pl. ellentmondo valtozat-opciok), nem lep, tehat minden korben az elen
   * maradna, es kiszoritana a tobbit: az ilyet a `frissitesProbalt` felismeri (a `lastSyncedAt` a legutobbi
   * kivalasztas ota ugyanaz), es a sor vegere teszi.
   */
  private async frissitesAzonositok(
    mar: ReadonlySet<string>,
    arvak: ReadonlySet<string> | null = null,
  ): Promise<string[]> {
    this.frissitesValasztott = new Map();
    const config = projectionRefreshConfig(this.environment);
    if (!config.enabled) return [];
    await this.frissitesJegyzetTisztit();
    /*
      AZ ABLAK A BERAGADTAKKAL IS SZÉLESEDIK (barracuda, #2623, blokkoló): a beragadt termék `lastSyncedAt`-je nem lép, tehát
      örökre a legrégebbiek között, az ablak ELEJÉN marad. Ha ezekből `perRound * OVERSCAN` vagy több áll ott, az ablakban csak
      beragadt van, a sor végére tétel nem talál mást, és a mögöttük állók soha nem kerülnek sorra, miközben a jelentés
      `taken.refresh = perRound`-ot mutat. A jegyzet (`frissitesProbalt`) a tisztítás után csak a ténylegesen beragadtakat (és az
      előző kör választását) tartalmazza, tehát az ablak a katalógus méreténél nem lehet szélesebb.
    */
    // az esedékes termékek a legrégebben vetítettek között is állhatnak: az ablak annyival szélesebb
    const kotesek = await this.db.externalReference.findMany({
      where: { ...MEDUSA_PRODUCT_REFERENCE, lastSyncedAt: { not: null } },
      orderBy: [{ lastSyncedAt: "asc" }, { entityId: "asc" }],
      take: config.perRound * OVERSCAN + mar.size + this.frissitesProbalt.size,
      select: { entityId: true, lastSyncedAt: true },
    });
    // a rendezés a kódban is megvan: a lekérdezés az ablakot jelöli ki, a sorrend viszont egy tágabb válasznál se múlhat rajta
    const jeloltek = kotesek
      .filter(
        (k) =>
          k.lastSyncedAt !== null &&
          !mar.has(k.entityId) &&
          !arvak?.has(k.entityId),
      )
      .sort(
        (a, b) =>
          a.lastSyncedAt!.getTime() - b.lastSyncedAt!.getTime() ||
          (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0),
      );
    if (!jeloltek.length) return [];
    const megfelel = new Set<string>();
    for (let i = 0; i < jeloltek.length; i += KOTES_SZELET) {
      const termekek = await this.db.product.findMany({
        where: {
          id: {
            in: jeloltek.slice(i, i + KOTES_SZELET).map((k) => k.entityId),
          },
          isActive: true,
          webshopSellable: true,
          webshopExcluded: false,
        },
        select: {
          id: true,
          isActive: true,
          webshopSellable: true,
          webshopExcluded: true,
        },
      });
      for (const t of termekek)
        if (t.isActive && t.webshopSellable && !t.webshopExcluded)
          megfelel.add(t.id);
    }
    const sorrendben = jeloltek.filter((k) => megfelel.has(k.entityId));
    const megallt = (k: (typeof sorrendben)[number]) =>
      this.frissitesProbalt.get(k.entityId) === k.lastSyncedAt!.getTime();
    // a kipróbált, de nem lépett termékek a végére; egyébként a régi sorrend marad
    const valasztott = [
      ...sorrendben.filter((k) => !megallt(k)),
      ...sorrendben.filter(megallt),
    ].slice(0, config.perRound);
    this.frissitesValasztott = new Map(
      valasztott.map((k) => [k.entityId, k.lastSyncedAt!.getTime()]),
    );
    return valasztott.map((k) => k.entityId);
  }

  /**
   * AZ ÚJRAPRÓBÁLHATÓ ÁR-KUDARCOK (550b80d1): aktív, webshopos, nem kihagyott (`webshopExcluded`), létező és kötött
   * termék, a bemenet sorrendjében; a kihagyott a termék-vetítésben sem esedékes, tehát árat sem kap. A
   * lekérdezés szeletenként megy (`KOTES_SZELET`), és a szűrés a kódban is megvan: egy tágabb válasz se vigyen
   * inaktivált terméket az ár-futásba.
   */
  private async arazhatoUjra(jeloltek: string[]): Promise<string[]> {
    if (!jeloltek.length) return [];
    const aktiv = new Set<string>();
    for (let i = 0; i < jeloltek.length; i += KOTES_SZELET) {
      const termekek = await this.db.product.findMany({
        where: {
          id: { in: jeloltek.slice(i, i + KOTES_SZELET) },
          isActive: true,
          webshopSellable: true,
          webshopExcluded: false,
        },
        select: {
          id: true,
          isActive: true,
          webshopSellable: true,
          webshopExcluded: true,
        },
      });
      for (const t of termekek as {
        id: string;
        isActive: boolean;
        webshopSellable: boolean;
        webshopExcluded?: boolean;
      }[])
        if (t.isActive && t.webshopSellable && !t.webshopExcluded)
          aktiv.add(t.id);
    }
    const kotott = await this.kotottAzonositok(
      jeloltek.filter((id) => aktiv.has(id)),
    );
    return jeloltek.filter((id) => kotott.has(id));
  }

  /**
   * Az esedékes termékek közül azok, amelyeknek VAN Medusa kötése, a kör
   * sorrendjében. A metszet a kódban is megvan, nem csak a lekérdezésben:
   * egy tágabb válasz se tegyen ár-vetítésbe olyan terméket, ami nem esedékes.
   */
  private async kotottAzonositok(
    esedekes: string[],
  ): Promise<Map<string, string>> {
    const kotesek = await this.db.externalReference.findMany({
      where: { ...MEDUSA_PRODUCT_REFERENCE, entityId: { in: esedekes } },
      select: { entityId: true, externalId: true },
    });
    const kotott = new Map(
      kotesek.map((sor) => [sor.entityId, sor.externalId]),
    );
    return new Map(
      esedekes
        .filter((id) => kotott.has(id))
        .map((id) => [id, kotott.get(id)!]),
    );
  }

  /**
   * KET LEKERDEZES, ES A SORREND SZAMIT: eloszor a termekek a forras-
   * idobelyegekkel, aztan a MAR LEKEPEZETT termekek utolso vetitesi ideje.
   * Forditva a masodik lekerdezes olyan azonositokra kerdezne, amiket az elso
   * meg nem ismer.
   *
   * AMIT A JEL NEM LAT, es a `medusa-projection-due.ts` fejleceben tetelesen
   * all: a kod valtozasat es a bolt oldali valtozast. A kategoria- es
   * kep-hozzarendelesnek nincs sajat idobelyege, de minden iroja a `Product`
   * sort is mozditja (visszamerve 2026-11-10, kartya 6e05f8a4).
   *
   * A KAPCSOLATOK 2026-09-08-IG UGYANEBBE A LISTABA TARTOZTAK, ES MOSTANTOL NEM.
   * A `ProductRelation` tablan addig nem volt idobelyeg, tehat egy
   * kapcsolat-valtozas SOHA nem tette esedekesse a terméket: a kapcsolatok
   * kimentek az adatbazisba, es a boltba nem jutottak el. Egy egesz estet vitt
   * el a kerdes, hogy "megallt-e a vetites" -- nem allt meg, csak nem volt MIN
   * eszrevennie.
   */
  private async esedekesAzonositok(
    limit: number,
    arvak: ReadonlySet<string> | null = null,
  ): Promise<string[]> {
    const ablak = limit * OVERSCAN;
    const esedekes: string[] = [];
    /*
      LAPOZVA, NEM EGY RÖGZÍTETT ABLAKBÓL (kártya 550b80d1, nautilus 27350; mérve 2026-11-15 a stage-en: a
      vetítő körei nulla jelölttel futottak, miközben a 11-14-i teljes futás után 8 vetített termék leírása
      a Medusában régi maradt). Eddig a lekérdezés a legutóbb módosított `limit * OVERSCAN` termék közül
      választott, és ha az ablak minden terméke naprakész volt, a kör üresen ért véget: a mögötte álló
      esedékes termék SOHA nem került be az ablakba. Egy tömeges módosítás (teljes UNAS-futás) pont ezt
      csinálja: az ablakot a saját, már kivitt termékeivel tölti meg.
      Most az ablakok egymás után jönnek (a sorrend változatlan: `updatedAt` csökkenően, `id` növekvően,
      tehát a lapozás stabil), amíg össze nem gyűlik a `limit` esedékes termék, vagy el nem fogytak a
      termékek. A felső korlát (`MAX_OLDAL`) védelem, nem cél: az aktív katalógus ma kb. 1900 termék.
    */
    for (let oldal = 0; oldal < MAX_OLDAL; oldal += 1) {
      const termekek = await this.db.product.findMany({
        // A kihagyott termek (webshopExcluded, 2026-09-29) soha nem esedekes:
        // kulonben orokre "meg nem vetitett" maradna, es minden kor elore hozna.
        where: { isActive: true, webshopExcluded: false },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: oldal * ablak,
        take: ablak,
        select: {
          id: true,
          updatedAt: true,
          variants: { select: { updatedAt: true } },
          unasSnapshot: { select: { updatedAt: true } },
          /*
            CSAK A UNAS-SOR (SEO P0 PR 5): a WEBSHOP-sor slugját a PR 7 előtt a
            vetítés nem viszi ki, tehát a változása nem tesz esedékessé. Szűrés
            nélkül a slug-backfill 1909 új sora az egész katalógust egyszerre
            esedékessé tenné, egy semmit nem változtató körre. A PR 7 veszi fel.
          */
          channelListings: {
            where: { channel: "UNAS" },
            select: { updatedAt: true },
          },
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
          /**
           * AZ ERKEZESEK IDOBELYEGE (V2.6 S3a): egy erkezes valtozasa (uj sor, allapot, nap, elojegyezhetoseg, a termekhez
           * kotes) a termek `livestock_arrival` kulcsat valtoztatja. AZ IRAS EMELLETT A TERMEK `updatedAt`-JET IS MOZGATJA
           * (`LivestockArrivalsRepository`): ez a lista csak a legutobb modositott termekek ablakat olvassa (`OVERSCAN`),
           * tehat egy reg modositott termek, aminek CSAK az erkezese valtozott, kimaradna, ha a termek sora nem mozdulna.
           * Itt a relacio azert is all, hogy a jel a teljes bemenetet lassa (ugyanaz a ket oldal, mint a kapcsolatoknal).
           */
          livestockArrivals: { select: { updatedAt: true } },
        },
      });
      if (!termekek.length) break;

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

      for (const termek of termekek) {
        // a jelolt arva kotes nem esedekes: a 404 emberi dontest ker, es a keretet sem szabad foglalnia
        if (arvak?.has(termek.id)) continue;
        const dontes = decideProjectionDue({
          lastProjectedAt: utoljara.get(termek.id) ?? null,
          sourceTimestamps: [
            termek.updatedAt,
            ...termek.variants.map((valtozat) => valtozat.updatedAt),
            termek.unasSnapshot?.updatedAt,
            ...termek.channelListings.map((sor) => sor.updatedAt),
            ...termek.sourceRelations.map((sor) => sor.updatedAt),
            ...termek.livestockArrivals.map((sor) => sor.updatedAt),
          ],
        });
        if (dontes.due) esedekes.push(termek.id);
        if (esedekes.length >= limit) return esedekes;
      }
      // az utolsó (rövid) lap után nincs több termék
      if (termekek.length < ablak) break;
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
    this.kovetkezoKor = new Date(this.now().getTime() + delayMs);
    this.timer = setTimeout(() => {
      this.kovetkezoKor = null;
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
/** Az általános esedékesség lapozásának felső korlátja (ablakok száma): védelem egy hibás lapozás ellen, nem a katalógus mérete. */
const MAX_OLDAL = 50;
/** Az inaktivált termékek lekérdezésének szelete: messze a Postgres kötött-paraméter határa (32767) alatt. */
const KOTES_SZELET = 1000;
/**
 * A KIFUTOTT-JELÖLŐ VERZIÓJA, DÁTUMKÉNT (ca422e92): az ennél korábban vetített inaktív
 * termék a jelölő (V4.2, #2148, 2026-11-04 a mainen) előtti szabállyal ment ki. A pont
 * szándékosan későbbi a beolvadásnál: a teszt telepítésének ideje nincs mérve, és egy
 * későbbi pont csak egy fölösleges újravetítésbe kerül termékenként, egy korábbi viszont
 * jelölő nélkül hagyna terméket.
 */
const KIFUTOTT_JELOLO_OTA = new Date("2026-11-09T00:00:00.000Z");
/**
 * Az akciós határ keresésének visszatekintő ablaka. Csak a keresést szűkíti;
 * egy hétnél hosszabban álló ütemező után a régebbi határt a következő
 * forrás-változás viszi ki.
 */
const AKCIO_ABLAK_MS = 7 * 24 * 60 * 60 * 1000;
