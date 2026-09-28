/**
 * AZ ESZKOZ-KATEGORIA VETULETE (P-004), A JEV V0 OFFLINE KIERTEKELOHOZ.
 *
 * Szerzodes: KratoBal/acropora-os #1199, ACD-002 (CH-002, P-004), ACD-003
 * amendment, ACD-003 Q-004 B. Balazs PD-001 ACCEPT (nem szemelyes adat,
 * nincs partnerazonosito) es PD-002 ACCEPT (V0, offline).
 *
 * === EZ A FUGGVENY NEM EL AZ API-BAN ===
 *
 * Nincs eles hivasi ut: az API nem importalja ezt a csomagot. A V0 offline
 * kiertekelo hasznalja, a V1 (kulon jovahagyassal) ugyanezt fogja.
 *
 * === AMI KIMEGY, ES AMI NEM ===
 *
 *   ki:     name (helyszin-elotag es sorszam nelkul), manufacturer, model,
 *           kind, performance, performance_unit, power_consumption,
 *           parent_category (a SZULO ESZKOZ KATEGORIAJANAK neve)
 *   nem:    description (szabad szoveg), serialNumber, partnerInternalCode,
 *           inventoryNumber, electricalCode (partnerkod), notes,
 *           function (ugyanazon az urlapon tolti az ember, a valasz resze lenne)
 *
 * A KULCSOK snake_case-ek: a cph1 szabalya [a-z0-9_] kulcsot ker (P-002), es a
 * P-004 peldajanak camelCase alakja ezzel utkozott. A szabaly a szerzodes;
 * acrobot 2026-09-28 12:21-kor egyetertett.
 *
 * URES VAGY HIANYZO MEZO KIMARAD, nem `null`: a vetuletben a hiany azt
 * jelenti, hogy nincs adat, es a cph1 a `null`-t kulon ertekkent kezelne.
 */
import { Cph1Decimal, canonicalDecimal } from "./cph1.js";

export const ASSET_CATEGORY_SCHEMA = "service-assets.asset-category@1";

/** A vetito bemenete: az eszkoz sora es a hozza tartozo, mar feloldott nevek. */
export interface AssetCategoryProjectionInput {
  readonly name: string;
  readonly manufacturer?: string | null;
  readonly model?: string | null;
  readonly kind?: string | null;
  /** `Decimal.toFixed()` alak, vagy `null`. */
  readonly performance?: string | null;
  /** A teljesitmeny mertekegysegenek neve (`UnitOfMeasure.name`). */
  readonly performanceUnit?: string | null;
  /** `Decimal.toFixed()` alak, vagy `null`. */
  readonly powerConsumption?: string | null;
  /** A SZULO ESZKOZ kategoriajanak neve -- nem a szulo neve. */
  readonly parentCategory?: string | null;
  /**
   * AZ ESZKOZ SAJAT RESZLEG-UTVONALA, a gyokertol a sajat reszlegig, kodokkal
   * (pl. `["FAN", "AKV", "A11"]`). A BEMENET resze, a KIMENETE nem: csak az
   * elotag levagasahoz kell. acrobot merese (eles DB, 2026-09-28): a nev
   * elotagja ennek az utvonalnak egy VEGSZELETE (`AKV/A11`), es a
   * `departmentId` minden eszkozon ki van toltve.
   */
  readonly departmentPath?: readonly string[];
}

/** Melyik szabaly vagta le az elotagot -- a kiertekelo ezt riportolja. */
export type PrefixRule = "department" | "pattern" | "none";

export interface AssetCategoryProjection {
  readonly schema: typeof ASSET_CATEGORY_SCHEMA;
  readonly data: {
    readonly name?: string;
    readonly manufacturer?: string;
    readonly model?: string;
    readonly kind?: string;
    readonly performance?: Cph1Decimal;
    readonly performance_unit?: string;
    readonly power_consumption?: Cph1Decimal;
    readonly parent_category?: string;
  };
}

/**
 * A TARTALEK MINTA, ha a reszleg-utvonal nem egyezik (acrobot merese, 394 nev,
 * maradek nelkul): egy- vagy tobbszegmensu kod (`BIO/LSS07`, `AKV/FRE/A19`),
 * vagy a szegmens nelkuli `CAP`. Nagybetus elso szo magaban NEM elotag: az
 * `UV` es a `GHL` technika illetve gyarto, es a minta per jel nelkul nem
 * illeszkedik rajuk.
 */
const ELOTAG_MINTA =
  /^(?:[A-ZÁÉÍÓÖŐÚÜŰ]{2,5}(?:\/[A-Z0-9ÁÉÍÓÖŐÚÜŰ]{1,8})+|CAP)(?:\s+|$)/u;

/** A zaro sorszam (`I.`, `II.`, `VI.`): ismetlesjel, nem az eszkoz neve. */
const SORSZAM = /\s+[IVXLC]+\.$/u;

export function stripAssetNamePrefix(
  name: string,
  departmentPath: readonly string[] = [],
): { readonly name: string; readonly rule: PrefixRule } {
  const nev = name.trim();
  /*
    A LEGHOSSZABB VEGSZELET ELOSZOR: az `AKV/A11` elobb, mint az `A11`, kulonben
    a rovidebb egyezes a hosszabb elso szegmenset a nevben hagyna.
  */
  for (let i = 0; i < departmentPath.length; i++) {
    const elotag = departmentPath.slice(i).join("/");
    if (!elotag) continue;
    /* SZOHATAR: a kod utan szokoz vagy a nev vege (a csak kodbol allo nev ures lesz). */
    const utana = nev.charAt(elotag.length);
    if (nev.startsWith(elotag) && (utana === "" || /\s/u.test(utana)))
      return { name: nev.slice(elotag.length).trim(), rule: "department" };
  }
  const talalat = ELOTAG_MINTA.exec(nev);
  if (talalat)
    return { name: nev.slice(talalat[0].length).trim(), rule: "pattern" };
  return { name: nev, rule: "none" };
}

export function assetDisplayName(input: string): string {
  return input.replace(SORSZAM, "").trim();
}

function szoveg(ertek: string | null | undefined): string | undefined {
  const s = ertek?.trim();
  return s ? s : undefined;
}

function decimalis(ertek: string | null | undefined): Cph1Decimal | undefined {
  const s = ertek?.trim();
  return s ? new Cph1Decimal(canonicalDecimal(s)) : undefined;
}

export function projectAssetCategory(input: AssetCategoryProjectionInput): {
  readonly projection: AssetCategoryProjection;
  readonly prefixRule: PrefixRule;
} {
  const levagott = stripAssetNamePrefix(input.name, input.departmentPath);
  const nyers = {
    name: szoveg(assetDisplayName(levagott.name)),
    manufacturer: szoveg(input.manufacturer),
    model: szoveg(input.model),
    kind: szoveg(input.kind),
    performance: decimalis(input.performance),
    performance_unit: szoveg(input.performanceUnit),
    power_consumption: decimalis(input.powerConsumption),
    parent_category: szoveg(input.parentCategory),
  };
  const data = Object.fromEntries(
    Object.entries(nyers).filter(([, ertek]) => ertek !== undefined),
  ) as AssetCategoryProjection["data"];
  return {
    projection: { schema: ASSET_CATEGORY_SCHEMA, data },
    prefixRule: levagott.rule,
  };
}
