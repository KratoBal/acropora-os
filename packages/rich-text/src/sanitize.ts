/**
 * A FORMAZOTT SZOVEG TISZTITASA -- UGYANAZ A FUGGVENY A SZERVEREN ES AZ
 * ELONEZETBEN.
 *
 * A js-xss (`xss`) tiszta JS, DOM nelkul fut, tehat a szerver mentes- es
 * kuldes-aga ugyanazt a kodot futtatja, amit a felulet elonezete. Ket kulon
 * tisztito azt jelentene, hogy az elonezet mast mutat, mint ami kimegy.
 *
 * === AZ ALAPBEALLITAS KET DOLGOT CSENDBEN ELVENNE (mert, xss@1.0.15) ===
 *
 *   <a href="{{jegy_linkje}}">        ->  <a href>   a link-valtozo eltunik
 *   <span data-variable="a">          ->  <span>     a valtozo jelolese eltunik
 *
 * Mindketto ervenyes, olvashato kimenetet ad, tehat semmi nem szolna. Ezert
 * sajat attributum-kezelo all itt, es NEM az alapertelmezett `safeAttrValue`.
 */
/*
  NEVES IMPORT, ES CSAK EZ AZ EGY. Az `xss` CommonJS csomag; a Node ESM-betoltoje
  a `FilterXSS` nevet felismeri, az `escapeAttrValue`-t NEM (mert: "Named
  export 'escapeAttrValue' not found"), az alapertelmezett export tipusa pedig
  egy fuggveny, amin a tipusok nem ismerik a tobbit. Az attributum-escape ezert
  itt all, sajat kezzel.
*/
import { FilterXSS } from "xss";

import {
  RICH_TEXT_ALLOWED_TAGS,
  RICH_TEXT_HREF_SCHEMES,
  RICH_TEXT_VARIABLE_NAME,
} from "./schema.js";

export interface SanitizeRichHtmlOptions {
  /**
   * A `href`-ben megengedett HELYORZOK neve, pl. `["jegy_linkje"]`.
   *
   * MENTESKOR kell: a sablonban a link celja meg `{{jegy_linkje}}`, nem URL.
   * KULDESKOR NEM szabad megadni: ott a helyorzo mar ki van cserelve, es ami
   * meg mindig helyorzo, az nem cim.
   *
   * Csak a PONTOS alak megy at (`{{nev}}`, szokozzel vagy anelkul); egy
   * `{{nev}}/utvonal` osszetetel nem, mert annak a vegeredmenye nem
   * ellenorizheto a mentes pillanataban.
   */
  readonly hrefPlaceholders?: readonly string[];
}

const HELYORZO_HREF = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/;

function engedettHref(
  ertek: string,
  helyorzok: ReadonlySet<string>,
): string | null {
  const cim = ertek.trim();
  const helyorzo = HELYORZO_HREF.exec(cim);
  if (helyorzo) return helyorzok.has(helyorzo[1] as string) ? cim : null;
  /*
    A SEMAT A VEZERLOKARAKTEREK ELTAVOLITASA UTAN NEZZUK. A bongeszo a
    `java\tscript:` alakot `javascript:`-kent olvassa; ha itt a nyers szovegen
    kerdeznenk, a tabulator atvinne egy futtathato linket.
  */
  // eslint-disable-next-line no-control-regex
  const tomor = cim.replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  return RICH_TEXT_HREF_SCHEMES.some((sema) => tomor.startsWith(sema))
    ? cim
    : null;
}

/**
 * ATMENNE-E EZ A LINK-CEL A TISZTITON -- A SZERKESZTO EZT KERDEZI.
 *
 * A TipTap link-bovitmenye sajat szaballyal dont a `href`-rol, es az
 * alapszabalya a `{{jegy_linkje}}` alakot ELUTASITJA (nincs semaja). Ha a
 * szerkeszto sajat listat tartana, a ket szabaly szetcsuszna: a szerkeszto
 * elfogadna valamit, amit a szerver menteskor csendben kidob, vagy forditva.
 */
export function isAllowedRichHref(
  href: string,
  options: SanitizeRichHtmlOptions = {},
): boolean {
  return engedettHref(href, new Set(options.hrefPlaceholders ?? [])) !== null;
}

function attrEscape(ertek: string): string {
  return ertek
    .replace(/&(?![a-zA-Z]+;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sanitizeRichHtml(
  html: string,
  options: SanitizeRichHtmlOptions = {},
): string {
  const helyorzok = new Set(options.hrefPlaceholders ?? []);
  const szuro = new FilterXSS({
    whiteList: Object.fromEntries(
      Object.entries(RICH_TEXT_ALLOWED_TAGS).map(([tag, attrs]) => [
        tag,
        [...attrs],
      ]),
    ),
    /*
      AZ ISMERETLEN TAG ELTUNIK, A SZOVEGE MARAD. Kiveve a `script` es a
      `style`: azok TARTALMA sem szoveg, hanem kod, tehat egyutt mennek.
    */
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style"],
    allowCommentTag: false,
    onTagAttr(tag, name, value) {
      /*
        AZ URES VISSZATERESI ERTEK AZ ATTRIBUTUMOT TELJESEN KIVESZI (mert). Egy
        `<a>` `href` nelkul sima szovegkent jelenik meg -- ez a helyes kimenet
        egy tiltott vagy ures cimre, nem egy halott link.
      */
      if (tag === "a" && name === "href") {
        const cim = engedettHref(value, helyorzok);
        return cim ? `href="${attrEscape(cim)}"` : "";
      }
      if (tag === "span" && name === "data-variable")
        return RICH_TEXT_VARIABLE_NAME.test(value)
          ? `data-variable="${value}"`
          : "";
      return undefined;
    },
  });
  return szuro.process(html);
}
