import {
  AMBIGUOUS_BRAND_ALIASES,
  GENERIC_BRAND_TERMS,
} from "./brand-resolution/brand-dictionary.js";
import { normalizeBrandName } from "../../brands/brands.repository.js";

/**
 * A TAROLT PILLANATKEP `brand` PARAMETEREBOL MARKA A TERMEKRE -- A TERV.
 *
 * === MIERT LEHETSEGES UJ LEHIVAS NELKUL ===
 *
 * Az API-kliens a `brand` parametert MAR kiolvassa (`unas-api.client.ts`), es a
 * szinkron a PARAMETEREKET eltarolja a pillanatkepbe. A markanev tehat nalunk
 * van, 1894 pillanatkepben -- csak a `Product.brandId` mezobe nem irja be senki.
 *
 * === MIERT NEM IR EZ A MODUL SEMMIT ===
 *
 * Tiszta fuggveny: bemenet a sorok es a MA letezo markak, kimenet a TERV. Az
 * iras a hivo dolga, es kulon kapcsolora. Igy a terv adatbazis nelkul merheto,
 * es a hivo ugyanazt a tervet tudja kiirni, amit vegrehajtana.
 */

/** Egy termek es a pillanatkepeben allo nyers markanev. */
export interface BrandBackfillRow {
  productId: string;
  /** A `parameters` tombbol kiolvasott `brand` ertek, nyersen. */
  brandValue: string;
  /** A termeken MA allo marka, ha van. */
  currentBrandId: string | null;
}

/** Egy MA letezo marka-rekord, a parositashoz szukseges mezokkel. */
export interface ExistingBrand {
  id: string;
  /** A `Brand.normalizedName` oszlop erteke. */
  normalizedName: string;
  /** A `BrandAlias.normalizedAlias` ertekek. */
  normalizedAliases: readonly string[];
}

export interface BrandBackfillPlan {
  /** Termek -> marka, amit a vegrehajtas beirna. */
  assign: { productId: string; brandId: string; brandValue: string }[];
  /** Ertekek, amikhez MA nincs marka-rekord, es letre KELLENE hozni. */
  createBrands: { name: string; products: number; sourceValues: string[] }[];
  /**
   * Amit SZANDEKOSAN nem irunk be, es amit a kimenetnek meg kell neveznie.
   * A csendes rossz marka a legrosszabb kimenetel: inkabb ne alljon ott semmi.
   */
  refused: { brandValue: string; products: number; reason: string }[];
  /** Akin MAR all marka: nem nyulunk hozza. */
  alreadySet: number;
}

/**
 * A `brand` PARAMETER KIOLVASASA A TAROLT TOMBBOL.
 *
 * UGYANAZZAL AZ OSSZEHASONLITASSAL, amit a kliens hasznal
 * (`localeCompare`, `sensitivity: "base"`): ekezet- es kisbetu-fuggetlen. Ha itt
 * mas alakot hasznalnank, a parancs MAS sorokat latna, mint a szinkron -- es a
 * kulonbseg csendes lenne.
 */
export function brandValueFromParameters(parameters: unknown): string | null {
  if (!Array.isArray(parameters)) return null;
  for (const sor of parameters) {
    if (!sor || typeof sor !== "object") continue;
    const { name, value } = sor as { name?: unknown; value?: unknown };
    if (typeof name !== "string" || typeof value !== "string") continue;
    if (name.localeCompare("brand", "hu", { sensitivity: "base" }) !== 0)
      continue;
    const trimmelt = value.trim();
    return trimmelt ? trimmelt : null;
  }
  return null;
}

/**
 * AMIT NEM SZABAD MARKAKENT FELVENNI, ES MIERT KULON LISTA.
 *
 * A szotar ket halmazt tart: a KETERTELMU roviditeseket (`ai`, `dd`, `kz`) es az
 * ALTALANOS szavakat. Egy ilyen ertekbol marka-rekordot csinalni azt jelentene,
 * hogy a talalgatast rekordba egetjuk -- es a kovetkezo olvaso mar nem latna,
 * hogy talalgatas volt.
 *
 * A visszautasitas HANGOS: a tetel a kimeneten all, nevvel es darabszammal. A
 * beiras lenne a nema.
 */
function refusalReason(brandValue: string): string | null {
  const normalizalt = normalizeBrandName(brandValue);
  if (!normalizalt) return "a normalizált alak üres";
  if (AMBIGUOUS_BRAND_ALIASES.has(normalizalt))
    return "kétértelmű rövidítés a szótár szerint";
  if (GENERIC_BRAND_TERMS.has(normalizalt))
    return "általános szó, nem márkanév a szótár szerint";
  return null;
}

/**
 * A TERV. Nem ir, nem dont ember helyett: megmondja, mi tortenne.
 *
 * A PAROSITAS A `normalizedName` ES A `normalizedAlias` ERTEKEKRE MEGY, mert a
 * `Brand` tabla ezeket tarolja -- ugyanazzal a normalizaloval, amit a tabla
 * hasznal (`brands.repository.ts`). Egy masik normalizalo itt CSENDBEN mas
 * halmazt parositana.
 */
export function planBrandBackfill(
  rows: readonly BrandBackfillRow[],
  brands: readonly ExistingBrand[],
): BrandBackfillPlan {
  const index = new Map<string, string>();
  for (const brand of brands) {
    index.set(brand.normalizedName, brand.id);
    for (const alias of brand.normalizedAliases) index.set(alias, brand.id);
  }

  const assign: BrandBackfillPlan["assign"] = [];
  const letrehozando = new Map<
    string,
    { name: string; products: number; alakok: Set<string> }
  >();
  const visszautasitva = new Map<
    string,
    { products: number; reason: string }
  >();
  let alreadySet = 0;

  for (const row of rows) {
    if (row.currentBrandId) {
      alreadySet += 1;
      continue;
    }

    const ok = refusalReason(row.brandValue);
    if (ok) {
      const eddigi = visszautasitva.get(row.brandValue);
      visszautasitva.set(row.brandValue, {
        products: (eddigi?.products ?? 0) + 1,
        reason: ok,
      });
      continue;
    }

    const brandId = index.get(normalizeBrandName(row.brandValue));
    if (brandId) {
      assign.push({
        productId: row.productId,
        brandId,
        brandValue: row.brandValue,
      });
      continue;
    }

    /**
     * A CSOPORTOSITAS A NORMALIZALT ALAKRA MEGY, NEM A NYERSRE -- ES EZT EGY
     * MERES HOZTA ELO, NEM ELOVIGYAZATOSSAG.
     *
     * A 683 termek 49 nyers marka-erteket hordoz, de csak 48 KULONBOZO
     * normalizalt alakot: az `OASE` (13 termek) es az `Oase` (6 termek)
     * ugyanaz a marka. Nyers ertek szerint csoportositva a terv KET rekordot
     * hozna letre ugyanazzal a `normalizedName` ertekkel -- a masodik a tarolo
     * azonossag-orzojen hasalna el, MENET KOZBEN, amikor az elso termekek mar
     * megkaptak a markat.
     */
    const kulcs = normalizeBrandName(row.brandValue);
    const eddigi = letrehozando.get(kulcs);
    letrehozando.set(kulcs, {
      name: eddigi?.name ?? row.brandValue,
      products: (eddigi?.products ?? 0) + 1,
      alakok: new Set([...(eddigi?.alakok ?? []), row.brandValue]),
    });
  }

  const szamSzerint = <T extends { products: number }>(a: T, b: T) =>
    b.products - a.products;

  return {
    assign,
    createBrands: [...letrehozando.values()]
      .map((tetel) => ({
        name: tetel.name,
        products: tetel.products,
        sourceValues: [...tetel.alakok].sort(),
      }))
      .sort(szamSzerint),
    refused: [...visszautasitva.entries()]
      .map(([brandValue, adat]) => ({ brandValue, ...adat }))
      .sort(szamSzerint),
    alreadySet,
  };
}

/**
 * A TERV SZOVEGE, ES AMIT KI KELL MONDANIA.
 *
 * A kimenet nem csak azt mondja meg, mi TORTENNE, hanem azt is, MI MARAD KI --
 * ugyanaz a szabaly, amit a termek-vetites kimenetere ma reggel vezettunk be: a
 * siker ne olvasodjon tobbnek, mint ami.
 */
export function describeBrandBackfillPlan(plan: BrandBackfillPlan): string {
  const sorok = [
    `Márkát kapna: ${plan.assign.length} termék`,
    `Létrehozandó márka-rekord: ${plan.createBrands.length}`,
    `Már van márkája, érintetlen: ${plan.alreadySet}`,
    `Visszautasítva (NEM írunk be semmit): ${plan.refused.length} érték`,
  ];

  if (plan.createBrands.length) {
    sorok.push("", "Létrehozandó márkák (érték, termékszám):");
    for (const b of plan.createBrands)
      sorok.push(
        `  ${b.name} -- ${b.products} termék` +
          (b.sourceValues.length > 1
            ? ` (a forrásban ${b.sourceValues.length} írásmóddal: ${b.sourceValues.join(", ")})`
            : ""),
      );
  }

  if (plan.refused.length) {
    sorok.push("", "Visszautasítva, és MIÉRT:");
    for (const r of plan.refused)
      sorok.push(`  ${r.brandValue} -- ${r.products} termék -- ${r.reason}`);
  }

  const erintett =
    plan.assign.length +
    plan.createBrands.reduce((sum, b) => sum + b.products, 0);
  sorok.push(
    "",
    `AMI EBBŐL KIMARAD: ${plan.refused.reduce((sum, r) => sum + r.products, 0)} ` +
      `termék márka nélkül marad, mert az értékéből nem csinálunk rekordot. ` +
      `Ezek NEM hibák: a szótár szerint kétértelmű vagy általános szavak, és ` +
      `egy találgatásból beírt márka rosszabb, mint az üres mező.`,
    `Ez a parancs CSAK a márkát írja: se kategóriát, se árat, se készletet.`,
    `Érintett termék összesen: ${erintett}.`,
  );
  return sorok.join("\n") + "\n";
}
