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
  /**
   * AZ IGAZITAS ES A GOMB JELOLESE (EmailRichEditor, Balazs jovahagyasa
   * 2026-09-30 21:26 UTC; a leiras: `agents/nautilus/megosztas/
   * email-rich-editor-tarolt-html.md`). Szuk jeloles, nem `style`: a tarolt
   * HTML-ben tovabbra sincs stilus, a kuldes forditja inline stilusra
   * (`richHtmlForEmail`).
   *
   *   data-align   `center` vagy `right`; a bal az alapertelmezes, jeloles nelkul
   *   data-cta     ures ertek; a bekezdes egyetlen linkje gombkent megy ki
   */
  p: ["data-align", "data-cta"],
  br: [],
  strong: [],
  em: [],
  u: [],
  s: [],
  a: ["href"],
  ul: [],
  ol: [],
  li: [],
  h2: ["data-align"],
  h3: ["data-align"],
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

/**
 * A KET PROFIL (Balazs dontese, 2026-10-25 22:30 UTC, Discord fo csatorna,
 * msg 1564043552525389924).
 *
 *   email   a levelsablon mai, szukitett reszhalmaza, VALTOZATLANUL. Ez az
 *           alapertelmezes minden fogyasztonal, aki nem kerdezi.
 *   full    a weben megjeleno tartalom: termekleiras, blogcikk, ReefClub cikk,
 *           kezdolap blokk. Mashova (hibajegy, munkalap) nem kerul.
 *
 * A `full` nem a levelet bovitti, hanem kulon lista: a level egy masik
 * kozegbe megy (levelezo), ahol a tablazat, a galeria es a kulso kep mast
 * jelent. Ha a ketto egy listan allna, az elso weboldali bovites a levelekbe is
 * atjutna.
 */
export const RICH_TEXT_PROFILES = ["email", "full"] as const;
export type RichTextProfile = (typeof RICH_TEXT_PROFILES)[number];

/**
 * A TELJES PROFIL RESZHALMAZA: a level minden jelolese, plusz a weboldali
 * blokkok.
 *
 * A KEP ITT MAS SZABALLYAL MEGY AT, nem mas attributummal: a `src` csak
 * `https:` cim lehet (a weben a kep a sajat cimerol toltodik, nincs mellekelt
 * kep), a sajat `acropora-image:` hivatkozas viszont NEM, mert azt a bolt nem
 * tudja feloldani.
 *
 *   div data-gallery        a galeria: egy blokk, benne csak kepek
 *   div data-product-card   a termekkartya: a termek azonositoja, a szovege a
 *                           termek neve a beszuras pillanataban (tartalek,
 *                           ha a megjelenito nem tudja feloldani)
 *   table ... td            tablazat; a cellak osszevonasa szammal, stilus nelkul
 */
export const RICH_TEXT_FULL_ALLOWED_TAGS = {
  ...RICH_TEXT_ALLOWED_TAGS,
  div: ["data-gallery", "data-product-card"],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type RichTextFullTag = keyof typeof RICH_TEXT_FULL_ALLOWED_TAGS;

/** A profil engedett tagjei es attributumai. */
export function richTextAllowedTags(
  profile: RichTextProfile,
): Readonly<Record<string, readonly string[]>> {
  return profile === "full"
    ? RICH_TEXT_FULL_ALLOWED_TAGS
    : RICH_TEXT_ALLOWED_TAGS;
}

/** A teljes profil kepenek legnagyobb szelessege, pixelben. */
export const RICH_TEXT_FULL_IMAGE_MAX_WIDTH = 1600;

/** Egy tablazat-cella osszevonasanak felso hatara (colspan, rowspan). */
export const RICH_TEXT_TABLE_SPAN_MAX = 20;

/**
 * A TERMEKKARTYA AZONOSITOJA: a `Product.id` alakja (cuid, kisbetu es szam).
 * Ugyanaz a karakterkeszlet, mint a kep-azonositoe, de kulon nev, mert kulon
 * dolgot jelol.
 */
export const RICH_TEXT_PRODUCT_ID = /^[a-z0-9]{1,64}$/;

/**
 * A TELJES PROFIL KEPCIME: `https:`, es semmi mas. A `http:` a bolt `https`
 * lapjan vegyes tartalom-figyelmeztetest ad, a `data:` es a relativ cim nem
 * ellenorizheto, a sajat `acropora-image:` pedig a boltban nem oldhato fel.
 */
export function isAllowedFullImageSrc(
  src: string,
  allowedHosts?: readonly string[],
): boolean {
  const cim = src.trim();
  if (!/^https:\/\//i.test(cim)) return false;
  try {
    const url = new URL(cim);
    if (url.protocol !== "https:") return false;
    /*
      A HOSZT-ENGEDELYLISTA (barracuda, #1875 review): egy idegen hoszt kepe a
      weboldalon harmadik feles betoltes (a latogato IP-je es Referere a
      hoszthoz megy, lehet nyomkoveto pixel, kesobb lecserelheto). Ahol a hivo
      megadja a listat, csak a pontos hosztnev megy at; az ures lista minden
      kepet elutasit.
    */
    return (
      allowedHosts === undefined ||
      allowedHosts.some((host) => host.toLowerCase() === url.hostname)
    );
  } catch {
    return false;
  }
}

/** Az igazitas jelolt ertekei. A `left` nincs koztuk: az a jeloletlen alap. */
export const RICH_TEXT_ALIGNMENTS = ["center", "right"] as const;
export type RichTextAlignment = (typeof RICH_TEXT_ALIGNMENTS)[number];

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
