import { normalizeBrandName } from "./brands.repository.js";

/**
 * KET MARKA OSSZEVONASA -- A TERV, ADATBAZIS NELKUL.
 *
 * === MIERT LETEZIK EGYALTALAN ===
 *
 * A teszt gepen 2026-09-07-en az `aquamedic` kulcs EGYSZERRE volt az "AquaMedic"
 * marka NEVE es az "Aqua Medic" marka ALIASA. Ilyen allapotban minden
 * marka-illesztes talalgatas, es a betolto ezert meg tervet sem ad.
 *
 * === ES MIERT NEM ELEG AZ ARCHIVALAS, HOLOTT AZ A KEZENFEKVO ===
 *
 * Merve, harom okbol:
 *   1. NEM MOZDIT TERMEKET -- a sorok az archivalt markan maradnanak, csendben.
 *   2. NEM SZABADITJA FEL A NEVET -- a `Brand.normalizedName` GLOBALISAN egyedi,
 *      nem reszleges index, tehat az archivalt marka tovabbra is birtokolja.
 *   3. A ket parancsunk MASKENT latja a vilagot: a visszatoltes `isActive: true`
 *      szurovel olvas (az archivaltat nem latja), a torzs-betolto szures nelkul
 *      (latja). Vagyis az orzo az archivalas UTAN is megallna.
 */
export interface BrandSide {
  id: string;
  name: string;
  normalizedName: string;
  aliases: { id: string; alias: string; normalizedAlias: string }[];
  productCount: number;
  isActive: boolean;
}

export interface BrandMergePlan {
  from: { id: string; name: string; productCount: number };
  into: { id: string; name: string; productCount: number };
  /** Ennyi termek `brandId` mezoje mozdul. */
  moveProducts: number;
  /** Aliasok, amik a celra kerulnek (a forrasrol). */
  moveAliases: { id: string; alias: string }[];
  /** Aliasok, amik NEM mozdulnak, es miert. */
  keptAliases: { alias: string; reason: string }[];
  /**
   * A forras NEVE aliaskent a celra. `null`, ha a cel MAR viseli ezt a kulcsot
   * (nevkent vagy aliaskent) -- ilyenkor nincs mit felvinni, es ez nem hiba.
   */
  nameAsAlias: string | null;
  /**
   * A FORRAS UJ NEVE, ES EZ A LEPES NEM VOLT A KERESBEN -- ezert all itt kulon.
   *
   * Az archivalas NEM szabaditja fel a nevet (lasd fent). Amig a forras
   * birtokolja az `aquamedic` kulcsot, addig az ugyanaz a kulcs marad, ami a
   * celon ALIASKENT all -- vagyis az osszevonas UTAN is pontosan az az
   * allapot allna fenn, amiert az osszevonast csinaljuk.
   *
   * Ezert a forras nevet nyugdijazzuk. NEM torlunk sort: egy archivalt, atnevezett
   * marka visszakeresheto, egy torolt nem -- es a torles idegen kulcsokba futna.
   */
  retiredName: string;
  /** Amiert a terv NEM hajthato vegre. Ha nem ures, a parancs meg sem probalja. */
  refusals: string[];
}

export function planBrandMerge(
  from: BrandSide,
  into: BrandSide,
): BrandMergePlan {
  const refusals: string[] = [];
  if (from.id === into.id) refusals.push("a forrás és a cél ugyanaz a márka");
  if (!into.isActive) refusals.push(`a cél márka archivált: "${into.name}"`);

  const celKulcsai = new Set([
    into.normalizedName,
    ...into.aliases.map((a) => a.normalizedAlias),
  ]);

  const moveAliases: BrandMergePlan["moveAliases"] = [];
  const keptAliases: BrandMergePlan["keptAliases"] = [];
  for (const alias of from.aliases) {
    if (celKulcsai.has(alias.normalizedAlias)) {
      keptAliases.push({
        alias: alias.alias,
        reason: "a célon már áll ez a kulcs",
      });
      continue;
    }
    celKulcsai.add(alias.normalizedAlias);
    moveAliases.push({ id: alias.id, alias: alias.alias });
  }

  const nameAsAlias = celKulcsai.has(from.normalizedName) ? null : from.name;
  if (nameAsAlias) celKulcsai.add(from.normalizedName);

  /**
   * A NYUGDIJAZOTT NEV ALAKJA: a HATARA szamit, nem a szepsege. Tartalmazza az
   * eredeti nevet (visszakereshetoseg) es a celt (miert tunt el), es a
   * normalizalt alakja NEM egyezhet semmivel, ami a celon all.
   */
  const retiredName = `${from.name} (összevonva: ${into.name})`;
  if (celKulcsai.has(normalizeBrandName(retiredName)))
    refusals.push(
      `a nyugdíjazott név kulcsa ütközne a célon: "${retiredName}"`,
    );

  return {
    from: { id: from.id, name: from.name, productCount: from.productCount },
    into: { id: into.id, name: into.name, productCount: into.productCount },
    moveProducts: from.productCount,
    moveAliases,
    keptAliases,
    nameAsAlias,
    retiredName,
    refusals,
  };
}

export function describeBrandMergePlan(plan: BrandMergePlan): string {
  const sorok = [
    `Forrás: "${plan.from.name}" -- ${plan.from.productCount} termék`,
    `Cél:    "${plan.into.name}" -- ${plan.into.productCount} termék`,
    "",
    /**
     * A KET TERMEKSZAM EGYUTT MONDJA MEG, HOGY JO IRANYBA MEGYUNK-E.
     *
     * Egy "9 termék mozdul" sor onmagaban akkor is helyesnek latszik, ha
     * forditva hivtuk. A ket oldal egymas mellett viszont azonnal mutatja: a
     * nulla termeku markarol a kilencre mozgatni majdnem biztosan teves irany.
     */
    `Mozduló termék: ${plan.moveProducts}`,
    `Átkerülő alias: ${plan.moveAliases.length}`,
    `Helyben maradó alias: ${plan.keptAliases.length}`,
    `A forrás neve aliasként: ${plan.nameAsAlias ?? "(a célon már áll)"}`,
    `A forrás új neve: "${plan.retiredName}"`,
  ];

  if (plan.moveAliases.length) {
    sorok.push("", "ÁTKERÜLŐ ALIASOK:");
    for (const a of plan.moveAliases) sorok.push(`  "${a.alias}"`);
  }
  if (plan.keptAliases.length) {
    sorok.push("", "NEM MOZDUL, és MIÉRT:");
    for (const a of plan.keptAliases)
      sorok.push(`  "${a.alias}" -- ${a.reason}`);
  }
  if (plan.refusals.length) {
    sorok.push("", "A TERV NEM HAJTHATÓ VÉGRE:");
    for (const r of plan.refusals) sorok.push(`  ${r}`);
  }
  return sorok.join("\n") + "\n";
}
