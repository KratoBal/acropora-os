/**
 * A MAGYAR DÁTUMMEZŐ TISZTA FÜGGVÉNYEI (UI-áttekintés, 3. csomag, 2026-11-03).
 *
 * A natív `<input type="date">` a BÖNGÉSZŐ nyelvén ír (`mm/dd/yyyy`, "November 2026"), és a
 * `lang` attribútum ezt nem írja felül, ezért a mező szövegét mi rajzoljuk: `2026. 11. 03.`.
 * Kifelé (a hívónak) MARAD az ISO alak (`2026-11-03`), tehát a hívók nem változnak.
 */

/** Az ISO dátum magyar alakja: `2026-11-03` -> `2026. 11. 03.`; érvénytelenre üres. */
export function isoToHu(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "";
  const [, year = "", month = "", day = ""] = m;
  return validDay(year, month, day) ? `${year}. ${month}. ${day}.` : "";
}

/** A naptár szerint létező nap-e (a február 30. nem az). */
function validDay(year: string, month: string, day: string): boolean {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** A beírt szövegből a számjegyek, legfeljebb nyolc (ÉÉÉÉHHNN). */
export function digitsOf(text: string): string {
  return text.replace(/\D/g, "").slice(0, 8);
}

/**
 * A számjegyek magyar alakja, FOLYAMATOSAN (gépelés közben): `2026` -> `2026`, `20261` ->
 * `2026. 1`, `202611` -> `2026. 11`, `2026110` -> `2026. 11. 0`, `20261103` -> `2026. 11. 03.`.
 * A záró pont csak a teljes napnál áll ki, hogy a törlés ne akadjon el rajta.
 */
export function digitsToHu(digits: string): string {
  const d = digits.slice(0, 8);
  const year = d.slice(0, 4);
  const month = d.slice(4, 6);
  const day = d.slice(6, 8);
  let out = year;
  if (month) out += `. ${month}`;
  if (day) out += `. ${day}`;
  if (day.length === 2) out += ".";
  return out;
}

/**
 * A beírt szöveg ISO dátuma, ha TELJES és létező nap; különben `null`. Az ISO (`2026-11-03`),
 * a pontos (`2026.11.03`) és a magyar (`2026. 11. 03.`) beillesztés is ugyanazt adja.
 */
export function huToIso(text: string): string | null {
  const d = digitsOf(text);
  if (d.length !== 8) return null;
  const [y, m, day] = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8)];
  return validDay(y, m, day) ? `${y}-${m}-${day}` : null;
}

/** Az ISO dátum a megadott (ISO) korlátokon belül van-e; a hiányzó korlát nem korlát. */
export function inRange(iso: string, min?: string, max?: string): boolean {
  return (!min || iso >= min) && (!max || iso <= max);
}

/**
 * A következő szöveg egy módosítás után. Ha a felhasználó csak elválasztót törölt (a számjegyek
 * ugyanazok maradtak, a szöveg rövidebb), a legutolsó számjegyet is elvesszük: különben a
 * visszaformázás visszaírná a pontot, és a törlés elakadna.
 */
export function nextText(previous: string, typed: string): string {
  let digits = digitsOf(typed);
  if (typed.length < previous.length && digits === digitsOf(previous)) {
    digits = digits.slice(0, -1);
  }
  return digitsToHu(digits);
}
