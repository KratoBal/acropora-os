/**
 * SIMA SZOVEGBOL FORMAZOTT SZOVEG -- A MEGLEVO SABLONOK ATVITELEHEZ.
 *
 * A mai sablonok szovegesek. Adat-migracio NINCS: a szerkeszto betolteskor
 * alakitja at a szoveget, es a level csak akkor lesz HTML, amikor valaki az uj
 * szerkesztoben ment. Ez a fuggveny az atalakitas.
 *
 * A `richHtmlToText` forditottja: az ures sor mentén bekezdes, az egyes
 * sortores `<br>`. A ketto oda-vissza utja a szoveget karakterre visszaadja
 * (allitas all ra), KET kivetellel, mert a HTML-ben ezek nem hordoznak
 * szoveget:
 *   harom vagy tobb sortores egymas utan   ->  egy ures sor
 *   tobb szokoz egymas utan                ->  egy szokoz (a bongeszo is igy mutatja)
 * A mai hat alapertelmezett sablonban egyik sem fordul elo.
 */
import { RICH_TEXT_VARIABLE_NAME } from "./schema.js";

export function escapeHtml(szoveg: string): string {
  return szoveg
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PlainTextToRichHtmlOptions {
  /**
   * Azok a nevek, amelyeknek `{{nev}}` alakja VALTOZO-CSOMOPONT lesz. Ami nincs
   * a listaban, sima szoveg marad -- igy egy elgepelt nev latszik a
   * szerkesztoben, es a sablon-ellenorzes megnevezi.
   */
  readonly variables?: readonly string[];
}

const HELY = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function plainTextToRichHtml(
  text: string,
  options: PlainTextToRichHtmlOptions = {},
): string {
  const ismert = new Set(
    (options.variables ?? []).filter((n) => RICH_TEXT_VARIABLE_NAME.test(n)),
  );
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((bekezdes) => bekezdes.replace(/^\n+|\n+$/g, ""))
    .filter((bekezdes) => bekezdes.trim().length > 0)
    .map(
      (bekezdes) =>
        `<p>${escapeHtml(bekezdes)
          .replace(HELY, (egesz, nev: string) =>
            ismert.has(nev)
              ? `<span data-variable="${nev}">{{${nev}}}</span>`
              : egesz,
          )
          .replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}
