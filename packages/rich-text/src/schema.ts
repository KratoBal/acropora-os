/**
 * A FORMAZOTT SZOVEG HTML-RESZHALMAZA -- EGY LISTA, KET FOGYASZTO.
 *
 * Balazs kerese, 2026-09-26 14:10 (Acropora OS szal): formazott szerkeszto a
 * levelsablonokhoz, KOZOS komponenskent, hogy mas helyen is hasznalhato legyen.
 *
 * A szerkeszto (TipTap) csak azt a HTML-t tudja eloallitani, amit a semaja
 * ismer, a szerver pedig csak azt engedi at, ami ebben a listaban all. Ha a
 * ketto kulon listabol epulne, az elso uj formazasnal szetcsuszna: a
 * szerkeszto olyat mentene, amit a szerver csendben kidob.
 *
 * AMI SZANDEKOSAN NINCS BENNE:
 *   style, class     a levelezok eltero modon dobjak el, es a kinezet a kerethez
 *                    tartozik, nem a szoveghez
 *   img              kulso kep = nyomkovetes, es a legtobb levelezo letiltja
 *   minden on*       esemeny-attributum: futtathato kod
 */
export const RICH_TEXT_ALLOWED_TAGS = {
  p: [],
  br: [],
  strong: [],
  em: [],
  u: [],
  s: [],
  a: ["href"],
  ul: [],
  ol: [],
  li: [],
  h2: [],
  h3: [],
  blockquote: [],
  hr: [],
  /**
   * A VALTOZO-CSOMOPONT JELOLESE. A szerkeszto egy `{{nev}}` helyorzot atomkent
   * kezel, es igy szerializalja: `<span data-variable="nev">{{nev}}</span>`.
   * A jeloles nelkul a kovetkezo betolteskor a helyorzo sima szovegge esne
   * vissza, es egy felig kijelolt formazas ketté vaghatna.
   */
  span: ["data-variable"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type RichTextTag = keyof typeof RICH_TEXT_ALLOWED_TAGS;

/** A link cimenek engedett semai. Minden mas `href` kiesik. */
export const RICH_TEXT_HREF_SCHEMES = ["http:", "https:", "mailto:"] as const;

/** Egy valtozo neve: ugyanaz a karakterkeszlet, mint a sablon-motor mintaja. */
export const RICH_TEXT_VARIABLE_NAME = /^[a-zA-Z0-9_]+$/;
