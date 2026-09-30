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
  RICH_TEXT_ALIGNMENTS,
  RICH_TEXT_ALLOWED_TAGS,
  RICH_TEXT_HREF_SCHEMES,
  RICH_TEXT_IMAGE_MAX_WIDTH,
  RICH_TEXT_VARIABLE_NAME,
  richImageId,
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
  /**
   * A KULDES MASODIK RETEGE KERI: ott a kep `src`-je mar `cid:` (a mellekelt
   * kepre mutat), es a MIME-epito ugyanezzel a tisztitoval ellenorzi, hogy a
   * torzs tiszta. Mashol NEM szabad megadni: a szerkesztobol erkezo `cid:`
   * semmire nem mutatna.
   */
  readonly allowCidImages?: boolean;
}

/** A sajat kep-hivatkozas, vagy -- csak kuldeskor -- egy `cid:` hivatkozas. */
function engedettKep(ertek: string, cidEngedett: boolean): string | null {
  const src = ertek.trim();
  if (richImageId(src)) return src;
  return cidEngedett && /^cid:[A-Za-z0-9._@-]{1,128}$/.test(src) ? src : null;
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

/**
 * A TISZTITAS EREDMENYE, ES HOGY ELVETT-E VALAMIT.
 *
 * A szerkeszto HTML modjabol visszavaltaskor a felulet ezt kerdezi: ami a
 * semaba nem fer, az elveszik, es ezt ki kell irni, nem csendben elnyelni. A
 * lista NEM a kimenet es a bemenet osszevetesebol keszul (az attributumok
 * sorrendje, az idezojel es a szokoz mindig kulonbseget adna), hanem abbol,
 * amit a tisztito maga dobott el.
 */
export interface SanitizeRichHtmlReport {
  readonly html: string;
  /** Az eldobott elemek, pl. `table`, `p style`, `a href`; ismetles nelkul. */
  readonly removed: readonly string[];
}

export function sanitizeRichHtml(
  html: string,
  options: SanitizeRichHtmlOptions = {},
): string {
  return sanitizeRichHtmlReport(html, options).html;
}

export function sanitizeRichHtmlReport(
  html: string,
  options: SanitizeRichHtmlOptions = {},
): SanitizeRichHtmlReport {
  const helyorzok = new Set(options.hrefPlaceholders ?? []);
  const eldobott = new Set<string>();
  /*
    A `script` es a `style` TARTALMAVAL EGYUTT megy, es azt a js-xss sajat
    agon kezeli: a lenti `onIgnoreTag` nem hallja. Ezert itt all kulon.
  */
  for (const m of html.matchAll(/<(script|style)[\s>/]/gi))
    eldobott.add((m[1] as string).toLowerCase());
  const elutasitott = (tag: string, name: string) => {
    eldobott.add(`${tag} ${name}`);
    return "";
  };
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
    stripIgnoreTagBody: ["script", "style"],
    onIgnoreTag(tag, _html, { isClosing }) {
      if (!isClosing) eldobott.add(tag.toLowerCase());
      return "";
    },
    onIgnoreTagAttr(tag, name) {
      eldobott.add(`${tag} ${name}`);
      return "";
    },
    allowCommentTag: false,
    onTagAttr(tag, name, value) {
      /*
        A js-xss EZT A NEM ENGEDETT ATTRIBUTUMRA IS MEGHIVJA, es amit itt
        visszaadunk, az a feherlistat felulirja. Ezert elobb a tag sajat
        listaja: ami nincs rajta, az a `undefined`-dal a kovetkezo lepesre
        (`onIgnoreTagAttr`) megy, es ott esik ki.
      */
      const engedett: readonly string[] | undefined =
        RICH_TEXT_ALLOWED_TAGS[tag as keyof typeof RICH_TEXT_ALLOWED_TAGS];
      if (!engedett?.includes(name)) return undefined;
      /*
        AZ URES VISSZATERESI ERTEK AZ ATTRIBUTUMOT TELJESEN KIVESZI (mert). Egy
        `<a>` `href` nelkul sima szovegkent jelenik meg -- ez a helyes kimenet
        egy tiltott vagy ures cimre, nem egy halott link.
      */
      if (tag === "a" && name === "href") {
        const cim = engedettHref(value, helyorzok);
        return cim ? `href="${attrEscape(cim)}"` : elutasitott(tag, name);
      }
      if (name === "data-align") {
        const igazitas = value.trim().toLowerCase();
        if ((RICH_TEXT_ALIGNMENTS as readonly string[]).includes(igazitas))
          return `data-align="${igazitas}"`;
        // a bal az alapertelmezes: a jelolese nem veszteseg, csak folosleges
        return igazitas === "left" ? "" : elutasitott(tag, name);
      }
      // a gomb jelolese ertek nelkuli: barmi allt benne, az alakja egy
      if (name === "data-cta") return 'data-cta=""';
      if (tag === "span" && name === "data-variable")
        return RICH_TEXT_VARIABLE_NAME.test(value)
          ? `data-variable="${value}"`
          : elutasitott(tag, name);
      if (tag === "img" && name === "src") {
        const src = engedettKep(value, options.allowCidImages === true);
        return src ? `src="${attrEscape(src)}"` : elutasitott(tag, name);
      }
      if (tag === "img" && name === "width") {
        /*
          CSAK EGESZ SZAM, ES A FELSO HATAR ALATT. A tul szeles kep a levelben
          vizszintes gorgetest ad a telefonon; egy szazalek vagy egy `auto`
          nem ellenorizheto a szerveren.
        */
        const szelesseg = /^\d{1,4}$/.test(value.trim())
          ? Number(value.trim())
          : NaN;
        return szelesseg >= 1 && szelesseg <= RICH_TEXT_IMAGE_MAX_WIDTH
          ? `width="${szelesseg}"`
          : elutasitott(tag, name);
      }
      if (tag === "img" && name === "alt") return `alt="${attrEscape(value)}"`;
      return undefined;
    },
  });
  /*
    A FORRAS NELKULI KEP EGESZEBEN KIESIK. A tisztito az attributumot veszi ki,
    a tag marad (`<img alt="x">`), es egy ilyen kep a levelben torott ikonkent
    jelenne meg. A kimenet a tisztito sajat, egyseges alakja, ezert eleg ra a
    minta.
  */
  const tiszta = szuro
    .process(html)
    .replace(/<img(?![^>]*\ssrc=")[^>]*>/g, () => {
      eldobott.add("img");
      return "";
    });
  return { html: tiszta, removed: [...eldobott] };
}
