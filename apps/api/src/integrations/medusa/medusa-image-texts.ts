/**
 * A KÉPEK ALT SZÖVEGE A TERMÉK METAADATÁBAN (SEO P0 PR 9; C9, D1).
 *
 * A Medusa képobjektuma az `alt`-ot csendben eldobja (lásd az `images` mező
 * kommentjét a kliensben), ezért az alt a termék metaadatában utazik, a KIADOTT
 * (Medusa) URL-lel párosítva. A kirakat ugyanazt az URL-t kapja a képlistában,
 * tehát URL szerint keresi meg a sajátját, és ahol nincs, a terméknévre esik
 * vissza.
 *
 * A forrás ma egyetlen: a `ProductImage.altText`, amit a UNAS-szinkron ír
 * (D1: `SOURCE`, kimegy). Jóváhagyási réteg most nincs, mert nincs írója.
 */
import { ACROPORA_IMAGES_KEY } from "./medusa-metadata-merge.js";

export interface ProjectedImageText {
  url: string;
  alt: string | null;
  title: string | null;
}

export interface ImageTextSource {
  altText: string | null;
  title: string | null;
}

function szoveg(ertek: string | null): string | null {
  const levagott = ertek?.trim();
  return levagott ? levagott : null;
}

/**
 * A kiadott URL-ek és a képsorok párosítása, INDEX szerint.
 *
 * A kiadó (`publishProductImages`) mindent vagy semmit ad: a lista vagy teljes,
 * a bemenet sorrendjében, vagy üres. Ezért az index pár, és egy eltérő hossz
 * nem részleges eredmény, hanem a szerződés sérülése: akkor `null` megy, és a
 * bolt oldalán álló érték érintetlen marad.
 *
 * `null` URL-lista (a képek most nem mennek ki) szintén `null`: nem tudjuk,
 * melyik URL áll a boltban, tehát nem is mondunk róla semmit.
 */
export function imageTextsFor(
  urls: string[] | null,
  images: ImageTextSource[],
): ProjectedImageText[] | null {
  if (urls === null || urls.length !== images.length) return null;
  return urls.map((url, i) => ({
    url,
    alt: szoveg(images[i]!.altText),
    title: szoveg(images[i]!.title),
  }));
}

/**
 * A metaadat-érték: JSON szöveg, csak a szöveggel bíró képekkel.
 *
 * Szöveg, mert a vetítés metaadata kulcs-szöveg párokat tart (a szorzó és a
 * kapcsolat-lista is így megy). Ha egyik képnek sincs szövege, `null`: a kulcs
 * nem megy ki, és az összefésülés leveszi a régit.
 */
export function imageTextsMetadataValue(
  texts: ProjectedImageText[],
): string | null {
  const szoveges = texts.filter((t) => t.alt !== null || t.title !== null);
  return szoveges.length > 0 ? JSON.stringify(szoveges) : null;
}

/**
 * A metaadat-folt, a `null` lista MEGŐRZŐ jelentésével.
 *
 * `texts === null` (nem tudunk listát adni): a bolt oldalán álló értéket
 * visszaküldjük, különben az összefésülés a saját kulcsunkként levenné, és a
 * boltban maradó képek elveszítenék az altjukat. Egy lista viszont mindig a
 * mostani állapotot mondja, akkor is, ha üres.
 */
export function imageTextsMetadataPatch(
  texts: ProjectedImageText[] | null,
  existing: Record<string, unknown> | null,
): Record<string, string> {
  if (texts === null) {
    const regi = existing?.[ACROPORA_IMAGES_KEY];
    return typeof regi === "string" ? { [ACROPORA_IMAGES_KEY]: regi } : {};
  }
  const ertek = imageTextsMetadataValue(texts);
  return ertek ? { [ACROPORA_IMAGES_KEY]: ertek } : {};
}
