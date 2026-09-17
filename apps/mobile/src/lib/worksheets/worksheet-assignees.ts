/**
 * A LAP FELELŐSEINEK SZERKESZTÉSE -- a döntések, a képernyőn kívül.
 *
 * Ebben az appban nincs komponens-teszt eszköz: ami a képernyő törzsében marad,
 * azt csak kézzel, telefonon lehet kipróbálni. Ezért a kiválasztás szabályai,
 * a „változott-e" kérdés és a mondatok itt állnak, ahol mérhetők.
 *
 * === A BEKÜLDÖTT NÉVSOR A TELJES ÁLLAPOT, NEM EGY HOZZÁADÁS ===
 *
 * A szerver `PUT`-ot vesz, és a saját kommentje mondja ki: a lista a lap
 * felelőseinek TELJES állapota. Ennek KÉT következménye van, és mind a kettőt
 * a felületnek kell viselnie:
 *
 *   a mentés MINDIG a teljes listát küldi, akkor is, ha egy nevet vettünk le;
 *   ha két szerelő EGYSZERRE szerkeszt, a később mentő felülírja a másikat.
 *
 * A második ma a weben is így van, tehát nem a telefon vezeti be -- de a
 * képernyő NE úgy nézzen ki, mintha hozzáadna. Ezért van a mentés-gomb felirata
 * és a lista együtt: ami a listán áll, az lesz a lap teljes névsora.
 *
 * === A KIOSZTÁS LEZÁRT LAPON IS MEGY ===
 *
 * A szerver nem köti állapothoz, és ez szándékos: a kiosztás munkaszervezés,
 * nem a dokumentum tartalma. Egy tévesen kiosztott lapot a lezárás pillanatában
 * sem szabad javíthatatlanul otthagyni. A képernyő ezért NEM tesz rá
 * piszkozat-feltételt -- az olyat tiltana, amit a szerver megenged.
 */

/**
 * A KIJELÖLÉS VÁLTÁSA.
 *
 * A SORREND SZÁMÍT, ÉS EZÉRT NEM HALMAZ: az újonnan kijelölt név a lista
 * VÉGÉRE kerül, tehát a felhasználó látja, mit adott hozzá utoljára. Egy
 * halmaz ezt elvenné, és a lista minden koppintásra átrendeződne.
 */
export function toggleWorksheetAssignee(
  selected: readonly string[],
  userId: string,
): string[] {
  return selected.includes(userId)
    ? selected.filter((id) => id !== userId)
    : [...selected, userId];
}

/**
 * VÁLTOZOTT-E A NÉVSOR A MENTETT ÁLLAPOTHOZ KÉPEST.
 *
 * A SORREND NEM SZÁMÍT, A TARTALOM IGEN: a szerver halmazként tárolja, tehát
 * két ugyanazokból álló, másképp rendezett lista UGYANAZ a lap-állapot. Ha a
 * sorrendet is nézné, a gomb aktív maradna egy olyan „mentés" után, ami semmit
 * nem változtat -- és a szerelő azt hinné, nem ment el.
 *
 * ISMÉTLŐDÉSSEL IS HELYES: a `size` összevetése azt is megfogja, ha az egyik
 * oldalon ugyanaz az azonosító kétszer áll. Egy sima hossz-összehasonlítás
 * ott hamis „változott"-at adna.
 */
export function worksheetAssigneesChanged(
  selected: readonly string[],
  current: readonly string[],
): boolean {
  const a = new Set(selected);
  const b = new Set(current);
  if (a.size !== b.size) return true;
  for (const id of a) if (!b.has(id)) return true;
  return false;
}

/**
 * MIT MOND A LAP A VÁLASZTÓRÓL -- vagy `null`, ha nincs mit.
 *
 * MIND A HÁROM ÜRES-ESET KÜLÖN MONDAT, mert a teendőjük más:
 *
 *   `loading`  a lista még jön. Aki ezt nem mondja ki, azt kockáztatja, hogy a
 *              szerelő egy üres dobozt „nincs kit választani"-nak olvas.
 *   `error`    a lekérdezés elbukott. Ez NEM ugyanaz, mint az üres lista, és a
 *              kettőt egy mondatba vonni azt állítaná, hogy nincs kolléga --
 *              holott csak nem tudjuk, van-e.
 *   üres lista tényleg nincs kit választani. Ez a partner-hatókörű
 *              felhasználónál normál működés, nem hiba.
 */
export function describeAssignableUsers(input: {
  loading: boolean;
  error: boolean;
  count: number;
}): string | null {
  if (input.error)
    return "A kollégák listája most nem tölthető be, ezért a kiosztás nem szerkeszthető. Próbáld újra később.";
  if (input.loading) return "A kollégák listája töltődik...";
  if (input.count === 0)
    return "Nincs olyan kolléga, akire ez a lap kiosztható lenne.";
  return null;
}

/**
 * MIÉRT NEM SZERKESZTHETŐ, AKI CSAK NÉZHETI -- vagy `null`, ha szerkesztheti.
 *
 * A NEVEKET AKKOR IS LÁTJA: a megnézés `service.view` alatt áll, az átírás
 * `service.manage` alatt. Aki csak nézhet, annak a névsor MUNKAUTASÍTÁS, és
 * elvenni tőle azért, mert nem írhatja át, két külön dolgot mosna egybe.
 *
 * ÉS A HIÁNYZÓ GOMB OKÁT KI KELL MONDANI: egy gomb, ami egyszerűen nincs ott,
 * ugyanúgy néz ki, mint egy elromlott -- a szerelő a helyszínen nem tudja
 * eldönteni, melyikről van szó, és keresni fogja.
 */
export function describeAssigneeReadOnly(canManage: boolean): string | null {
  return canManage
    ? null
    : "A kiosztást az iroda írja át: a te jogosultságoddal a felelősök csak látszanak.";
}
