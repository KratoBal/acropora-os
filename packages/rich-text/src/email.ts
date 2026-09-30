/**
 * A TAROLT JELOLES FORDITASA A LEVELEZOK NYELVERE -- KULDESKOR ES ELONEZETBEN.
 *
 * A tarolt HTML-ben nincs `style` (a tisztito nem engedi), az igazitas es a
 * gomb szuk jelolessel all (`data-align`, `data-cta`). A levelezok egy resze
 * viszont csak az inline stilust ismeri, ezert a kikuldott levelben ez a
 * fuggveny teszi ki. A MIME-epito a keretnel (`mailHtmlDocument`) hivja, a
 * tisztitas-ellenorzes UTAN: igy a tisztito egyetlen `style`-t sem enged at,
 * es ami inline stilus a levelben all, azt csak ez a fuggveny irhatta.
 *
 * Az elonezet ugyanezt hivhatja, hogy ugyanazt mutassa, ami kimegy.
 */
import type { RichTextAlignment } from "./schema.js";

/**
 * A GOMB KINEZETE: a Figma levelsablon mintaja (358:441, „Email CTA”):
 * #0b7a6e hatter, feher, felkover felirat, 7px sarok. A mintaban a felirat
 * 11px, a level 14px-en fut, a belso margo ehhez aranyosan nagyobb.
 */
export const EMAIL_CTA_STYLE =
  "display:inline-block;padding:12px 24px;background-color:#0b7a6e;" +
  "color:#ffffff;font-weight:600;text-decoration:none;border-radius:7px";

const igazitasStilus = (attrs: string): string => {
  const igazitas = /\sdata-align="(center|right)"/.exec(attrs)?.[1] as
    RichTextAlignment | undefined;
  return igazitas ? ` style="text-align:${igazitas}"` : "";
};

/**
 * TISZTITOTT toredekre valo (a `sanitizeRichHtml` kimenetere): az attributumok
 * ott a tisztito egyseges alakjaban allnak, ezert eleg rajuk egy minta.
 *
 * A GOMB CSAK A TISZTA ALAKBAN GOMB: a bekezdesben egyetlen link, benne csak
 * szoveg. Minden mas alak (ket link, felkover resz a feliratban) sima
 * bekezdeskent megy ki -- a tartalom nem vesz el, csak a gomb-kinezet.
 */
export function richHtmlForEmail(html: string): string {
  return html
    .replace(
      /<p(\s[^>]*)>\s*<a href="([^"]*)">([^<]*)<\/a>\s*<\/p>/g,
      (egesz, attrs: string, href: string, felirat: string) =>
        /\sdata-cta=""/.test(attrs)
          ? `<p${igazitasStilus(attrs)}><a href="${href}" style="${EMAIL_CTA_STYLE}">${felirat}</a></p>`
          : egesz,
    )
    .replace(/<(p|h2|h3)(\s[^>]*)>/g, (egesz, tag: string, attrs: string) =>
      /\sdata-(align|cta)=/.test(attrs)
        ? `<${tag}${igazitasStilus(attrs)}>`
        : egesz,
    );
}
