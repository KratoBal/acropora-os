/**
 * MIT TÖLTÖTTEK FEL VALÓJÁBAN: a bejelentett típus ÉS az első bájtok együtt.
 *
 * MIÉRT NEM ELÉG A BEJELENTETT TÍPUS. A `mimetype` és a kiterjesztés is a
 * KÜLDŐTŐL jön: egy elnevezett fájl akkor is `image/jpeg`-nek mondja magát, ha
 * bármi más van benne. A tartalom első bájtjai viszont a fájl sajátjai.
 *
 * MIÉRT NEM ELÉG A TARTALOM SEM, ÖNMAGÁBAN. Ha csak a bájtokat néznénk, egy
 * PDF-nek nevezett kép csendben átmenne, és a letöltésnél derülne ki, hogy a
 * böngésző nem tudja megnyitni. A kettőnek EGYEZNIE kell: ez az egyetlen alak,
 * ami mindkét irányban véd.
 *
 * A LISTA SZÁNDÉKOSAN RÖVID, és a hiányzókat is megnevezzük:
 *
 * - HEIC/HEIF: az iPhone alapértelmezett formátuma, de a telefonos képválasztók
 *   (az Expo sajátját is beleértve) JPEG-re konvertálnak feltöltés előtt.
 *   Felvenni akkor kell, ha egy MÉRÉS mutat érkező HEIC-et, nem előre.
 * - WebP, AVIF: a szerviz-fotók telefonról vagy fényképezőgépből jönnek, és
 *   egyik sem ezekben ír. Egy formátum, amit soha senki nem küld, csak a
 *   felületet szélesíti.
 * - SVG: szándékosan KIMARAD. Nem fénykép, viszont futtatható tartalmat vihet,
 *   és a letöltésnél a böngésző értelmezné.
 */
export type UploadedFileKind = "pdf" | "jpeg" | "png";

interface Signature {
  kind: UploadedFileKind;
  /** A bejelentett típusok, amiket ehhez a tartalomhoz elfogadunk. */
  mimetypes: readonly string[];
  /**
   * Amit a LETÖLTÉSNÉL válaszolunk. Nem a küldő bejelentett típusa: az
   * `image/jpg` alakot elfogadjuk beérkezéskor, de visszaadni a szabványosat
   * kell, különben a böngésző azon akadna fenn, amit mi engedtünk át.
   */
  canonicalMimetype: string;
  /** A fájl első bájtjai, ahogy a formátum előírja. */
  magic: readonly number[];
}

const SIGNATURES: readonly Signature[] = [
  {
    kind: "pdf",
    mimetypes: ["application/pdf"],
    canonicalMimetype: "application/pdf",
    // "%PDF-"
    magic: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    kind: "jpeg",
    // A `image/jpg` nem szabványos, de a régebbi klienseknél előfordul, és a
    // tartalom-ellenőrzés úgyis külön véd: elfogadni olcsóbb, mint egy valódi
    // fényképet elutasítani egy elgépelt fejléc miatt.
    mimetypes: ["image/jpeg", "image/jpg"],
    canonicalMimetype: "image/jpeg",
    magic: [0xff, 0xd8, 0xff],
  },
  {
    kind: "png",
    mimetypes: ["image/png"],
    canonicalMimetype: "image/png",
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
];

/**
 * A felismert fajta, vagy `null`, ha a bejelentett típus és a tartalom nem
 * egyezik. A hívó dolga eldönteni, mit kezd a `null`-lal - itt nem dobunk,
 * mert a hibaüzenet a végponté, és az tudja, mit szabad kimondania.
 */
export function detectUploadedFileKind(
  mimetype: string,
  buffer: Buffer,
): UploadedFileKind | null {
  const declared = mimetype.trim().toLowerCase();
  for (const signature of SIGNATURES) {
    if (!signature.mimetypes.includes(declared)) continue;
    const head = buffer.subarray(0, signature.magic.length);
    if (head.equals(Buffer.from(signature.magic))) return signature.kind;
    // A BEJELENTETT TÍPUS EGYEZETT, A TARTALOM NEM. Nem próbálunk másik
    // aláírást: az a fájl nem az, aminek mondja magát, és ez a válasz.
    return null;
  }
  return null;
}

/** Amit a feltöltő felületnek fel szabad kínálnia, egy `accept` attribútumhoz. */
export const ACCEPTED_UPLOAD_MIMETYPES: readonly string[] = SIGNATURES.flatMap(
  (signature) => signature.mimetypes,
);

/**
 * A LETÖLTÉSKOR VISSZAADANDÓ TÍPUS. Külön áll a felismeréstől, mert a tárolt
 * sor ezt őrzi meg: a feltöltés eldönti, MI a fájl, és a letöltés ebből
 * mondja meg a böngészőnek, mit kezdjen vele.
 *
 * Ez a lépés korábban hiányzott: a sor `application/pdf` értéket kapott
 * FÜGGETLENÜL a tartalomtól. PDF-nél igaz volt, és épp ezért nem tűnt fel.
 */
export function canonicalMimetypeFor(kind: UploadedFileKind): string {
  const signature = SIGNATURES.find((entry) => entry.kind === kind);
  // A `kind` unió zárt, tehát ide nem lehet eljutni - de ha egy új fajta
  // bekerül a típusba és kimarad a táblából, jobb hangosan elhasalni, mint
  // csendben egy rossz típust adni a letöltőnek.
  if (!signature) throw new Error(`Ismeretlen fájlfajta: ${kind}`);
  return signature.canonicalMimetype;
}
