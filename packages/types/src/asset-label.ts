/**
 * ELŐRE NYOMTATOTT MATRICA KÓDJA.
 *
 * A kód alakja Balázs döntése (2026-09-02, a `42056ab0` kártya): EGY BETŰ ÉS
 * NÉGY SZÁM, például `V2196`. Nem itt találjuk ki, és nem is bővítjük.
 *
 * MIÉRT ÁLL EZ A KÖZÖS CSOMAGBAN, HOLOTT MA CSAK AZ API HASZNÁLJA. A telefon
 * fogja beolvasni a matricát, és ott ugyanennek az alaknak kell állnia. Ha a
 * minta az API-ban lakna, a mobil oldali beolvasás egy MÁSODIK példányt írna
 * belőle -- és a két példány pontosan ott csúszna el, ahol senki nem nézi.
 *
 * A MINTA NEM AZONOS A TÁBLA MEGKÖTÉSÉVEL, ÉS EZ SZÁNDÉKOS. Az adatbázisban
 * `^[A-Z][0-9]{4}$` áll (`AssetLabel_code_shape_check`), tehát a TÁROLT alak
 * csak nagybetűs lehet. Itt viszont a kisbetűt is elfogadjuk és felfelé
 * normalizáljuk: egy leolvasó, ami kisbetűt ad vissza, ne bukjon el azon, amit
 * az ember ugyanannak a matricának lát. A kettő nem ellentmondás: a bemenet
 * megengedőbb, a tárolt alak egyféle.
 */
const ASSET_LABEL_CODE_PATTERN = /^[A-Za-z][0-9]{4}$/;

/** A tárolt (normalizált) alak mintája. A tábla `CHECK` megkötése ez. */
export const ASSET_LABEL_CODE_STORED_PATTERN = /^[A-Z][0-9]{4}$/;

/**
 * A beolvasott vagy begépelt kód tárolható alakja, vagy `null`, ha nem az.
 *
 * A `null` NEM hibaüzenet: a hívó dolga eldönteni, mit mond róla. Egy dobott
 * kivétel itt azt jelentené, hogy minden hívóhelynek ugyanaz a szövege, és a
 * felvitel meg a készlet-kiadás nem ugyanazt akarja mondani.
 */
export function normalizeAssetLabelCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!ASSET_LABEL_CODE_PATTERN.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

/** Egy matrica a készletben. `assetId` `null`, amíg szabad. */
export interface AssetLabel {
  id: string;
  code: string;
  issuedAt: string;
  assetId: string | null;
  assignedAt: string | null;
}

/** A készlet-kiadás eredménye. */
export interface AssetLabelIssueResult {
  /** Az ebben a körben létrehozott kódok, kiadási sorrendben. */
  issued: string[];
  /**
   * Amit KÉRTEK, de már létezett, tehát nem jött létre újra.
   *
   * Nem hiba, és ezért nem is kivétel: egy matricaív újranyomtatásakor a
   * kiadás megismételhető anélkül, hogy a meglévő sorokat elveszítenénk. De
   * LÁTSZANIA kell, különben a hívó azt hinné, hogy annyi új matricát kapott,
   * amennyit kért.
   */
  alreadyIssued: string[];
}

/**
 * KOTELEZO-E A MATRICA AZ ESZKOZ FELVITELEKOR.
 *
 * EGY HELYEN ALL, SZANDEKOSAN. Ha egyszer megfordul, EZ AZ EGY SOR valtozik --
 * nem a szerver validacioja, nem a telefon urlapja, es nem a ket hibauzenet
 * kulon-kulon. A kerdes Balazsnal all (acrobot tette fel 2026-09-02 este):
 * kotelezo legyen-e, vagy lehessen utolag potolni.
 *
 * A MAI ERTEK A MEGENGEDO, es ez NEM dontes helyette: ez az az allapot, ami a
 * mai szerver-viselkedessel egyezik (a `labelCode` opcionalis a felvitelnel).
 * Amig a valasz meg nem jott, a megengedo ertek az, ami SEMMIT nem zar ki.
 */
export const ASSET_LABEL_REQUIRED_ON_CREATE = false;

/**
 * MI A BAJ A FELVITELKOR MEGADOTT MATRICAKODDAL, vagy `null`, ha semmi.
 *
 * A KET SZABALY EGYUTT ALL ITT: hogy KELL-E, es hogy JO-E AZ ALAKJA. Ha kulon
 * allnanak, a telefon es a szerver ket kulonbozo pillanatban vennek at a
 * valtozast -- es a felhasznalo azt latna, hogy az urlap atengedi, a mentes meg
 * elutasitja.
 */
export function assetLabelCreateProblem(
  raw: string | undefined,
): "missing" | "malformed" | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return ASSET_LABEL_REQUIRED_ON_CREATE ? "missing" : null;
  return normalizeAssetLabelCode(trimmed) === null ? "malformed" : null;
}
