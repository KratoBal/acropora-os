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
  /**
   * A BEAGYAZOTT KEP (Balazs kerese, 2026-09-28 07:39 UTC: „jo lenne ha kepet
   * is lehetne beszurni. pl acropora log").
   *
   * A `src` CSAK a sajat kep-hivatkozasunk lehet (`RICH_TEXT_IMAGE_SCHEME`),
   * kulso cim es `data:` nem. A kep a levelbe agyazva megy ki (inline CID), nem
   * kulso URL-kent: a kulso kepet sok levelezo alapbol blokkolja, a `data:`
   * URI-t a Gmail nem mutatja, es publikus tarhelyunk sincs. A `width` felso
   * hatara `RICH_TEXT_IMAGE_MAX_WIDTH`, hogy a levelben ne legyen oriasi.
   */
  img: ["src", "alt", "width"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type RichTextTag = keyof typeof RICH_TEXT_ALLOWED_TAGS;

/** A link cimenek engedett semai. Minden mas `href` kiesik. */
export const RICH_TEXT_HREF_SCHEMES = ["http:", "https:", "mailto:"] as const;

/**
 * A SAJAT KEP-HIVATKOZAS SEMAJA: `acropora-image:<azonosito>`.
 *
 * Nem URL, es ez szandekos: sem a bongeszo, sem a levelezo nem tudja
 * magatol feloldani. A kuldes `cid:`-re csereli es a kepet mellekeli, az
 * elonezet es a szerkeszto pedig a sajat, hitelesitett uton tolti be. Igy a
 * tarolt HTML-ben SOHA nem all olyan cim, ami kifele mutatna.
 */
export const RICH_TEXT_IMAGE_SCHEME = "acropora-image:";

/** Egy kep-azonosito alakja a hivatkozasban. */
export const RICH_TEXT_IMAGE_ID = /^[a-z0-9]{1,64}$/;

/** A levelbe szant kep legnagyobb szelessege, pixelben. */
export const RICH_TEXT_IMAGE_MAX_WIDTH = 600;

/** A hivatkozasbol az azonosito, vagy `null`, ha nem a sajat semank. */
export function richImageId(src: string): string | null {
  if (!src.startsWith(RICH_TEXT_IMAGE_SCHEME)) return null;
  const id = src.slice(RICH_TEXT_IMAGE_SCHEME.length);
  return RICH_TEXT_IMAGE_ID.test(id) ? id : null;
}

/** Egy valtozo neve: ugyanaz a karakterkeszlet, mint a sablon-motor mintaja. */
export const RICH_TEXT_VARIABLE_NAME = /^[a-zA-Z0-9_]+$/;

/**
 * A HTML-BEN HIVATKOZOTT SAJAT KEPEK AZONOSITOI, ismetles nelkul, a
 * megjelenes sorrendjeben. TISZTITOTT HTML-re valo: ott a `src` a tisztito
 * egyseges alakjaban all (`src="..."`), tehat a minta megbizhato.
 *
 * A mentes ezzel ellenorzi, hogy a hivatkozott kep letezik-e, a kuldes pedig
 * ezzel tudja, mit kell mellekelni.
 */
export function richImageIds(html: string): readonly string[] {
  const ids = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)]
    .map((m) => richImageId(m[1] as string))
    .filter((id): id is string => id !== null);
  return [...new Set(ids)];
}
