/**
 * A SABLONBOL KESZULO LEVELTORZS -- SZOVEG, VAGY SZOVEG ES HTML EGYUTT.
 *
 * Balazs kerese, 2026-09-26 14:10: formazott (HTML) levelsablon. Terv:
 * `agents/nautilus/html-levelsablon-terv-2026-09-26.md`, 2. pont.
 *
 * EGY FUGGVENY, OT HIVOHELY. A negy hibajegy-level es a vizmeres-level
 * ugyanezt hivja; ha mindegyik maga dontene a HTML-agrol, az otodik ut
 * pontosan az lenne, amelyik kimarad.
 *
 * === A SORREND, ES MIERT EZ ===
 *
 *   1. behelyettesites, ESCAPE-ELT ertekekkel   (`renderMailTemplateHtml`)
 *   2. tisztitas                                 (`sanitizeRichHtml`)
 *   3. a szoveges valtozat A TISZTA HTML-BOL      (`richHtmlToText`)
 *
 * A tisztitas a behelyettesites UTAN jon, mert a link cime egy ERTEKBOL
 * erkezik (`{{jegy_linkje}}`), es ami nem `http(s)`/`mailto`, annak itt kell
 * kiesnie. A szoveges resz a tiszta HTML-bol keszul, nem a tarolt `body`-bol:
 * igy a ket alternativa biztosan ugyanazt mondja.
 */
import { richHtmlToText, sanitizeRichHtml } from "@acropora/rich-text";
import {
  renderMailTemplate,
  renderMailTemplateHtml,
  type MailTemplateValues,
} from "@acropora/types";

export interface MailBodyTemplate {
  readonly body: string;
  /** `null` vagy hianyzo: a mai, egyreszes szoveges level. */
  readonly bodyHtml?: string | null;
}

export type RenderedMailBody =
  | { readonly ok: true; readonly text: string; readonly html?: string }
  | { readonly ok: false; readonly unknown: readonly string[] };

export function renderMailBody(
  template: MailBodyTemplate,
  values: MailTemplateValues,
): RenderedMailBody {
  if (!template.bodyHtml) {
    const szoveg = renderMailTemplate(template.body, values);
    return szoveg.ok ? { ok: true, text: szoveg.text } : szoveg;
  }
  const nyers = renderMailTemplateHtml(template.bodyHtml, values);
  if (!nyers.ok) return nyers;
  const html = sanitizeRichHtml(nyers.text);
  return { ok: true, html, text: richHtmlToText(html) };
}

/**
 * A `send()`-nek atadott mezo. FELTETELES SZETTERITES, es nem `html: undefined`:
 * a hivok allitasai a teljes levelet hasonlitjak, es egy `undefined` erteku
 * kulcs mas objektum, mint a hianyzo -- a szoveges ut levele ettol nem
 * valtozhat.
 */
export function mailBodyFields(torzs: { text: string; html?: string }): {
  text: string;
  html?: string;
} {
  return torzs.html === undefined
    ? { text: torzs.text }
    : { text: torzs.text, html: torzs.html };
}
