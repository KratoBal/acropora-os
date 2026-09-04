/**
 * A KEP TIPUSA A BAJTOKBOL, NEM A MEZOBOL.
 *
 * MIERT LETEZIK, ES MI VOLT ELOTTE. A kep-publikalo eddig KEMENYEN
 * `"image/jpeg"` tipust kuldott minden kepre, tehat egy PNG is JPEG-kent ment
 * fel. Ez NEM lustasag volt: a `ProductImage` soron NINCS tipus-mezo (merve
 * 2026-09-04: url, storageKey, sortOrder, altText, title, fileName, source), es
 * a beegetett ertek volt az EGYETLEN, ami rendelkezesre allt.
 *
 * A PRECEDENS A REPOE, es az indoklasa a lenyeg. Az APNS-kulcs olvasoja
 * ugyanezt csinalja, es a sajat kommentje mondja ki: a valtozo NEVE egy
 * ALLITAS, a TARTALOM a TENY. Ugyanaz a csalad, amibe 2026-09-04-en haromszor
 * futottunk bele:
 *
 *   a kotet CSATOLVA volt, es nem lehetett irni
 *   egy engedely-sor OTT ALLT a fajlban, es nem elt
 *   a kep-rekord MEGVOLT a termeken, es nem jelent meg
 *
 * Mindharomnal a leiras allitott valamit, es a tartalom mast.
 *
 * ES AMIT EZ A MODUL SZANDEKOSAN NEM TESZ: ha nem ismeri fel a bajtokat, NEM
 * TALAL KI tipust. Egy ismeretlen bemenetre adott `"image/jpeg"` pontosan az a
 * hiba lenne, amit javitunk -- csak egy szinttel odebb tolva.
 */

/** A felismert tipus, vagy `null`, ha a bajtok nem mondjak meg. */
export type ImageContentType =
  "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null;

/**
 * A NEGY ALAK, AMIT FELISMERUNK, ES MIERT EPP EZ A NEGY.
 *
 * Ezek azok, amiket egy webshop kepe reálisan hordoz, es amiknek MAGIKUS
 * ELOTAGJUK van -- vagyis a felismeres nem talalgatas, hanem a fajlformatum
 * sajat, kotelezo fejlece.
 *
 * A WebP KET DARABBOL all: a `RIFF` elotag onmagaban nem eleg (mas RIFF-alapu
 * formatumok is leteznek), a nyolcadik bajttol allo `WEBP` jelolo dont.
 */
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function kezdodik(
  bytes: Uint8Array,
  minta: readonly number[],
  eltolas = 0,
): boolean {
  if (bytes.length < eltolas + minta.length) return false;
  return minta.every((bajt, index) => bytes[eltolas + index] === bajt);
}

/**
 * MEGMONDJA A TIPUST A TARTALOMBOL, vagy `null`-t ad.
 *
 * A `null` NEM hiba, es nem is "valoszinuleg jpeg": azt jelenti, hogy a
 * bajtok nem mondjak meg. A hivo dontse el, mit tesz vele -- ez a modul nem
 * hoz helyette dontest.
 */
export function detectImageContentType(bytes: Uint8Array): ImageContentType {
  if (kezdodik(bytes, JPEG)) return "image/jpeg";
  if (kezdodik(bytes, PNG)) return "image/png";
  if (kezdodik(bytes, GIF)) return "image/gif";
  if (kezdodik(bytes, RIFF) && kezdodik(bytes, WEBP, 8)) return "image/webp";
  return null;
}

/**
 * A FAJLNEV KITERJESZTESE A FELISMERT TIPUSHOZ.
 *
 * MIERT KELL EGYALTALAN, es ez merestol fugg, amit innen NEM tudunk
 * elvegezni: a bolt oldalan a feltoltott fajl `application/octet-stream`
 * tipussal all. Ket oka lehet, es MINDKETTO a Medusa oldalan van -- vagy a
 * multipart resz tipusa nem jut at a tarolasig, vagy a bolt a FAJLNEV
 * kiterjesztesebol dolgozik.
 *
 * A masodik eset ellen ez a fuggveny ved: ha a nev kiterjesztese nem egyezik a
 * TARTALOMMAL, a tartalom nyer. Ha viszont az elso eset all, ez a fuggveny nem
 * segit -- es azt ki kell mondani, nem elhallgatni.
 */
export function imageFileNameFor(
  fileName: string,
  contentType: Exclude<ImageContentType, null>,
): string {
  const kiterjesztesek: Record<Exclude<ImageContentType, null>, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };
  const kell = kiterjesztesek[contentType];
  const alap = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  /** Ures alap (peldaul ".jpg" nevbol) eseten a NEVET nem talaljuk ki. */
  return `${alap || fileName}${kell}`;
}
