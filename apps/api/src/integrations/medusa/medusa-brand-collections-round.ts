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
export const ensureBrandCollectionsInRound = (env: NodeJS.ProcessEnv): boolean =>
  env.MEDUSA_ENSURE_BRAND_COLLECTIONS === "true";

export type BrandCollectionsOutcome =
  | { status: "unchanged" }
  | {
      status: "applied";
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
  if (!changing.length) {
    // egy ütközés magában nem ír semmit, de látszania kell: minden kör jelezze
    return plan.conflict.length
      ? {
          status: "applied",
          created: 0,
          linkedOnly: 0,
          relinked: 0,
          touched: 0,
          conflicts: plan.conflict.map((c) => c.ourId),
        }
      : { status: "unchanged" };
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
  const touched = await deps.touchBrands(await deps.mappedAmong(changing), deps.now());
  return {
    status: "applied",
    created: report.created,
    linkedOnly: report.linkedOnly,
    relinked: report.relinked,
    touched,
    conflicts: report.conflicts,
  };
}

export const describeBrandCollections = (outcome: BrandCollectionsOutcome): string => {
  if (outcome.status === "unchanged") return "Márka-gyűjtemények: nincs teendő.";
  if (outcome.status === "refused") return `Márka-gyűjtemények: a lépés megállt (${outcome.reason}).`;
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
