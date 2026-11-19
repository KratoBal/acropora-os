import type { BrandImportPlan } from "./medusa-brand-plan.js";
import type { BrandImportReport } from "./medusa-brand-import.service.js";

/**
 * A MARKA-GYUJTEMENYEK BIZTOSITASA A VETITESI KORBEN (kartya ec82b629, acrobot 2026-11-19 10:11).
 *
 * A markaoldal a termekeit a Medusa gyujtemenyebol listazza, a gyujtemeny letrehozasa viszont eddig egy KEZZEL inditott
 * parancs volt (`medusa:brands --apply`). Egy marka, ami a parancs utan keletkezett, gyujtemeny nelkul maradt: a termekei
 * nem kaptak `collection_id`-t (a vetites csak "unmapped"-nek latja), es a markaoldal 404 lett. Merve a teszt kirakaton
 * 2026-11-19-en: mind a 105 marka aktiv es termekes, 45 gyujtemeny nelkul, mind a 2026-11-14-i (a parancs utolso futasa
 * elotti nap) keletkezesu. Ez a lepes a kezi parancs helyett fut a kor elejen.
 *
 * MIT TESZ: a meglevo terv (`MedusaBrandImportService.plan`) szerint LETREHOZZA a hianyzo gyujtemenyeket es leképezi
 * oket, a mar allo, de leképezetlen gyujtemenyeket csak leképezi, az elavult leképezest ujra letrehozza. Mas semmit:
 * nem torol, nem ir at. Ha a terv ütközést vagy csonkolt listát talal, a terv szerint az érintett marka érintetlen marad
 * (a `run` ezt maga tartja), a lepes ELLENBEN jelenti: az ütközés napló-figyelmeztetes, a csonkolt lista megtagadas.
 *
 * MIERT ERINTI MEG A MARKAT: a vetites a marka valtozasat a `Brand.updatedAt`-bol latja (a markak termekei esedekesse
 * valnak, ha a marka ujabb a termek koteseenel), a leképezés letrejottet viszont nem. A letrehozott (vagy leképezett)
 * markak `updatedAt`-ja ezert a lepes vegen "most" lesz: a SAJAT marka-valtozas forras a termekeket ugyanebben a korben
 * esedekesse teszi, es azok megkapjak a `collection_id`-t. A megerintes a leképezes UTAN tortenik: ha a gyujtemeny
 * letrehozasa elbukik, a marka nem lesz esedekes egy meg nem letezo gyujtemenyre.
 *
 * KAPCSOLOVAL, ALAPBOL KI, ugyanugy, mint a tobbi lista-lepes: a lepes a boltba IR, es az iras joga nem engedely.
 */
export const ensureBrandCollectionsInRound = (
  env: NodeJS.ProcessEnv,
): boolean => env.MEDUSA_ENSURE_BRAND_COLLECTIONS === "true";

/**
 * A TERV SZAMAI (a kor allapotaba, kartya ec82b629 merhetove tetele): a terv hat halmazanak merete. A stage naploja a flottanak
 * nem olvashato, a lepes eredmenye pedig CSAK naplo-sor volt, tehat az, hogy a terv a hianyzo gyujtemenyeket egyaltalan latja-e
 * (`create`), nem volt merheto. Csak szamok, marka-azonosito nelkul.
 */
export interface BrandPlanCounts {
  create: number;
  mapOnly: number;
  staleMapping: number;
  skip: number;
  conflict: number;
  skipArchived: number;
}

export const brandPlanCounts = (plan: BrandImportPlan): BrandPlanCounts => ({
  create: plan.create.length,
  mapOnly: plan.mapOnly.length,
  staleMapping: plan.staleMapping.length,
  skip: plan.skip.length,
  conflict: plan.conflict.length,
  skipArchived: plan.skipArchived.length,
});

export type BrandCollectionsOutcome =
  | { status: "unchanged"; planned: BrandPlanCounts }
  | {
      status: "applied";
      /** a terv szamai a FUTAS ELOTT: mit akart letrehozni, mit csak leképezni */
      planned: BrandPlanCounts;
      created: number;
      linkedOnly: number;
      relinked: number;
      /** hany marka `updatedAt`-jat erintettuk meg */
      touched: number;
      conflicts: string[];
    }
  | { status: "refused"; reason: string };

export interface BrandCollectionsDeps {
  /** A terv, iras nelkul. A csonkolt listanal a megtagadas hibaja dobodik: `refusedReason` ismeri fel. */
  plan(): Promise<BrandImportPlan>;
  /** A tenyleges betoltes (a `MedusaBrandImportService.run`). */
  apply(): Promise<BrandImportReport>;
  /** Az adott markak kozul azok, amelyeknek a leképezése MOST megvan (egy felig lefutott betoltes utan is). */
  mappedAmong(ids: string[]): Promise<string[]>;
  /** Az adott markak `updatedAt`-jat a `now`-ra teszi; a megerintettek szamat adja. */
  touchBrands(ids: string[], now: Date): Promise<number>;
  now(): Date;
  /** A megtagadas oka, ha a hiba a betoltes megtagadasa (csonkolt lista), kulonben `null`. */
  refusedReason(error: unknown): string | null;
}

/** Hol valtozik a kep: ami a terv szerint letrejon vagy atkotodik. */
const changedBrandIds = (plan: BrandImportPlan): string[] => [
  ...new Set([
    ...plan.create.map((c) => c.ourId),
    ...plan.mapOnly.map((m) => m.ourId),
    ...plan.staleMapping,
  ]),
];

export async function ensureBrandCollections(
  deps: BrandCollectionsDeps,
): Promise<BrandCollectionsOutcome> {
  let plan: BrandImportPlan;
  try {
    plan = await deps.plan();
  } catch (error) {
    const reason = deps.refusedReason(error);
    if (reason !== null) return { status: "refused", reason };
    throw error;
  }
  const changing = changedBrandIds(plan);
  const planned = brandPlanCounts(plan);
  if (!changing.length) {
    // egy ütközés magában nem ír semmit, de látszania kell: minden kör jelezze
    return plan.conflict.length
      ? {
          status: "applied",
          planned,
          created: 0,
          linkedOnly: 0,
          relinked: 0,
          touched: 0,
          conflicts: plan.conflict.map((c) => c.ourId),
        }
      : { status: "unchanged", planned };
  }
  // A MEGERINTES A LEKEPEZES UTAN, ES CSAK AZOKAT, AMIKNEK MAR VAN: egy felig lefutott betoltes (a 20. gyujtemeny HTTP-hibaja)
  // a mar leképezett markakat a kovetkezo korben "mar all"-nak latna, es a termekeik sosem lennenek esedekesek. Ezert a
  // megerintes a hibaagon is lefut (a hiba utana is tovabbmegy), de a meg le nem képezett marka nem lesz esedekes.
  let report: BrandImportReport;
  try {
    report = await deps.apply();
  } catch (error) {
    try {
      await deps.touchBrands(await deps.mappedAmong(changing), deps.now());
    } catch {
      // a megerintes hibaja nem fedi el a betoltes hibajat
    }
    throw error;
  }
  const touched = await deps.touchBrands(
    await deps.mappedAmong(changing),
    deps.now(),
  );
  return {
    status: "applied",
    planned,
    created: report.created,
    linkedOnly: report.linkedOnly,
    relinked: report.relinked,
    touched,
    conflicts: report.conflicts,
  };
}

export const describeBrandCollections = (
  outcome: BrandCollectionsOutcome,
): string => {
  if (outcome.status === "unchanged")
    return "Márka-gyűjtemények: nincs teendő.";
  if (outcome.status === "refused")
    return `Márka-gyűjtemények: a lépés megállt (${outcome.reason}).`;
  const sorok = [
    `Márka-gyűjtemények: ${outcome.created} létrehozva`,
    `${outcome.linkedOnly} csak leképezve`,
    `${outcome.relinked} újra leképezve`,
    `${outcome.touched} márka megérintve (a termékeik esedékesek)`,
  ];
  if (outcome.conflicts.length)
    sorok.push(`ÜTKÖZÉS, érintetlen marad: ${outcome.conflicts.join(", ")}`);
  return sorok.join(", ") + ".";
};

/**
 * A LEPES A KOR ALLAPOTABAN (`lastRound.steps.brandCollections`, kartya ec82b629, acrobot 13:10): a lepes eredmenye eddig csak
 * naplo-sor volt, a teszt gep naplojat a flotta nem olvassa, ezert harom dolog nem kulonbozott: a kapcsolo nem all (vagy rossz
 * alakban all), a lepes lefutott es nem talalt teendot, vagy lefutott es megallt. Most mind a harom mas ertek:
 *  - `enabled: false`: a kapcsolo NEM pontosan `true`. `switchPresent` mondja meg, hogy az env-ben egyaltalan van-e, a
 *    `switchLooksTrue`, hogy rossz alakban all-e (`True`, `"true"` idezojellel, szokozzel): a nyers ertek nem kerul ki, csak
 *    ez a ket jel;
 *  - `enabled: true, failed: true`: a lepes dobott (a hiba rovid szovege, azonosito nelkul);
 *  - `enabled: true, failed: false`: lefutott, a `status` es a szamok (terv, letrehozott, leképezett, megerintett).
 */
export type BrandCollectionsStep =
  | { enabled: false; switchPresent: boolean; switchLooksTrue: boolean }
  | { enabled: true; failed: true; error: string }
  | {
      enabled: true;
      failed: false;
      status: BrandCollectionsOutcome["status"];
      /** null: a terv nem allt elo (megtagadas) */
      planned: BrandPlanCounts | null;
      created: number;
      linkedOnly: number;
      relinked: number;
      touched: number;
      conflicts: number;
      reason: string | null;
    };

const STEP_ERROR_MAX = 160;

/** A kikapcsolt lepes jele: a nyers ertek nem kerul ki, csak az, hogy van-e, es hogy `true`-nak latszik-e. */
export function brandCollectionsOffStep(
  env: NodeJS.ProcessEnv,
): BrandCollectionsStep {
  const raw = env.MEDUSA_ENSURE_BRAND_COLLECTIONS;
  return {
    enabled: false,
    switchPresent: raw !== undefined,
    switchLooksTrue: raw !== undefined && /^\W*true\W*$/i.test(raw),
  };
}

export function brandCollectionsFailedStep(
  error: unknown,
): BrandCollectionsStep {
  const text = error instanceof Error ? error.message : String(error);
  return {
    enabled: true,
    failed: true,
    error: text.replace(/\s+/g, " ").trim().slice(0, STEP_ERROR_MAX),
  };
}

export function brandCollectionsStep(
  outcome: BrandCollectionsOutcome,
): BrandCollectionsStep {
  if (outcome.status === "refused")
    return {
      enabled: true,
      failed: false,
      status: "refused",
      planned: null,
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      touched: 0,
      conflicts: 0,
      reason: outcome.reason.slice(0, STEP_ERROR_MAX),
    };
  if (outcome.status === "unchanged")
    return {
      enabled: true,
      failed: false,
      status: "unchanged",
      planned: outcome.planned,
      created: 0,
      linkedOnly: 0,
      relinked: 0,
      touched: 0,
      conflicts: 0,
      reason: null,
    };
  return {
    enabled: true,
    failed: false,
    status: "applied",
    planned: outcome.planned,
    created: outcome.created,
    linkedOnly: outcome.linkedOnly,
    relinked: outcome.relinked,
    touched: outcome.touched,
    conflicts: outcome.conflicts.length,
    reason: null,
  };
}
