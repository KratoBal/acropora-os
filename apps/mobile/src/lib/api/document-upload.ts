import { readFileBytes, type ReadFileBytes } from "./file-bytes";

/**
 * A FELTÖLTENDŐ FÁJLOK ÖSSZERAKÁSA EGY KÉRÉSSÉ.
 *
 * Külön áll a `assets.ts`-től, hogy `fetch` és Expo futtató nélkül forduljon:
 * így a `FormData` felépítése MÉRHETŐ anélkül, hogy telefont vagy hálózatot
 * kellene hozzá indítani. Ugyanaz a megfontolás, mint a `request-auth.ts` és a
 * `json-content-type.ts` esetében.
 */

/**
 * Egy kiválasztott fájl, ahogy a telefon adja. A React Native `FormData` ilyen
 * alakot vár egy fájl-mezőhöz: az `uri` a helyi fájlra mutat, a `name` lesz a
 * feltöltött név, a `type` pedig a bejelentett tartalomtípus.
 *
 * A `type` MEGADÁSA NEM FORMASÁG: a szerver a bejelentett típust ÉS a fájl
 * első bájtjait együtt nézi, és ha a kettő nem egyezik, elutasít. Egy hiányzó
 * vagy találomra beírt típus tehát nem lazaság, hanem biztos elutasítás.
 */
export interface PickedFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * A MEZŐNÉV MINDEN FÁJLNÁL UGYANAZ: `file`.
 *
 * A végpont ezen a néven fogad többet is, és a webes felület ugyanezt a nevet
 * használja egyetlen fájlra. Egy külön "files" név a szerveren is változást
 * kívánt volna, és eltörte volna a ma működő webes hívót.
 */
export const UPLOAD_FIELD_NAME = "file";

/**
 * Hány fájl mehet egy kérésben. A szerver ugyanezt a számot őrzi, és a fölötte
 * lévőt megnevezett hibával utasítja el - ez a másolat azért van itt, hogy a
 * telefon már a küldés ELŐTT szóljon, ne egy hálózati kör után.
 *
 * KÉT HELYEN ÁLLÓ SZÁM, ÉS EZT KIMONDJUK: ha a szerveren változik, itt is
 * változtatni kell. A telefon nem kérdezi le, mert a válasz nem függ tőle, és
 * egy külön kör a feltöltés előtt drágább, mint ez a mondat.
 */
export const MAX_FILES_PER_UPLOAD = 10;

/**
 * EGY FÁJL RÉSZE A TÖBBRÉSZES TÖRZSBEN.
 *
 * === EZ AZ ALAK MÉRÉSBŐL JÖN, NEM ÍZLÉSBŐL ===
 *
 * A futtató globális `fetch`-e (Expo 57 `winter/fetch`) a törzset maga építi
 * fel, és HÁROM alakot ismer. A harmadik ág, betűre, a saját forrásából:
 *
 *     } else if (typeof entry === 'object' && 'bytes' in entry) {
 *       results.push(await entry.bytes());
 *     } else {
 *       throw new Error('Unsupported FormDataPart implementation');
 *     }
 *
 * A React Native szokásos `{uri, name, type}` alakja egyik ágra sem illeszkedik,
 * tehát az UTOLSÓRA esik és DOB. Ezért nem ment fel SOHA egy fénykép sem a
 * telefonról: a dobás a `fetch`-ből jött vissza, tehát a kérés el sem indult, a
 * szerver naplójában nulla nyoma maradt, és a telefonon "a szerver jelenleg nem
 * érhető el" látszott -- egy olyan hiba képe, ami sosem volt hálózati.
 *
 * === MIÉRT A `name` ÉS A `type` MARAD A MIÉNK ===
 *
 * A fejléceket ugyanaz a modul az OBJEKTUMRÓL olvassa (`'name' in part`,
 * `'type' in part`), tehát a `picked-image.ts` ellenőrzött típusa és neve megy
 * ki. Ez nem apróság: a szerver a bejelentett típust ÉS az első bájtokat együtt
 * nézi. Az `expo-file-system` saját `File` példánya is átmenne ezen az ágon, DE
 * a `name`-je a gyorsítótárbeli fájlnév (`Paths.basename`), a `type`-ja pedig
 * natív MIME-felismerés -- vagyis pont az a két érték cserélődne ki, amiről a
 * `picked-image.ts` fejléce kimondja, hogy nem találgatjuk.
 */
export interface UploadPart {
  name: string;
  type: string;
  bytes: () => Promise<Uint8Array>;
}

/**
 * A `bytes` LUSTA, és ez szándékos: a fájlokat a küldés pillanatában olvassuk
 * be, nem a törzs összeállításakor. Egy elutasított válogatás (üres lista, tíz
 * fölött) így egyetlen bájtot sem olvas fel a lemezről.
 */
export function uploadPart(
  file: PickedFile,
  readBytes: ReadFileBytes,
): UploadPart {
  return {
    name: file.name,
    type: file.type,
    bytes: () => readBytes(file.uri),
  };
}

export type BuildUploadResult =
  { ok: true; body: FormData } | { ok: false; reason: string };

/**
 * Felépíti a kérés törzsét, vagy megmondja, miért nem lehet.
 *
 * A HIBÁK ITT, A KÜLDÉS ELŐTT DERÜLNEK KI, és ez a lényeg: egy üres válogatás
 * vagy tizenegy fájl a szerverig is elmenne, csak lassabban és drágábban, és a
 * szerelő addig a töltés-jelzőt nézné.
 */
/**
 * A NEVE NEM MOND TOBBET, MINT AMIT CSINAL -- ES EZ MA MAR NEM VOLT IGAZ.
 *
 * `buildAssetDocumentUpload` volt, holott a torzse a `type` mezot SZOVEGKENT
 * veszi at, es semmit nem tud az eszkozrol. A munkalap-feltoltes MAR MA is ezt
 * hivta (`worksheets.ts`), tehat a nev nem elmeletben, hanem a gyakorlatban
 * vezetett felre: aki harmadik feltoltot ir, es "Asset"-et lat a neven, MASOLNI
 * fog ahelyett, hogy hasznalna.
 *
 * Az atnevezes ezert nem takaritas volt, hanem annak a kerulese, hogy a
 * hibajegy legyen a harmadik hivo egy olyan nev alatt, ami kizarja.
 */
export function buildDocumentUpload(input: {
  /**
   * A FAJTA ELHAGYHATO, ES HA HIANYZIK, NEM KERUL A TORZSBE.
   *
   * MIERT NEM ALLANDO ALAPERTELMEZES: a szerver 2026-09-22 ota a FAJL BAJTJAIBOL
   * donti el (kep -> PHOTO, minden mas -> OTHER), fajlonkent. Ha a kliens kuld
   * egy allando erteket, az a dontest ELVESZI -- es akkor a fajta nem a fajlrol
   * allit valamit, hanem arrol, melyik kepernyorol indult a feltoltes.
   *
   * A HIANY TEHAT NEM MULASZTAS, HANEM A KERES RESZE. Aki ide erteket ir, annak
   * meg kell tudnia mondani, MIERT tudja jobban a kliens, mint a fajl tartalma.
   */
  type?: string;
  files: readonly PickedFile[];
  /** Tesztben cserélhető bájt-olvasó. Éles úton a `file-bytes.ts` valódija. */
  readBytes?: ReadFileBytes;
}): BuildUploadResult {
  if (input.files.length === 0)
    return { ok: false, reason: "Válassz ki legalább egy fájlt." };

  if (input.files.length > MAX_FILES_PER_UPLOAD)
    return {
      ok: false,
      reason: `Egyszerre legfeljebb ${MAX_FILES_PER_UPLOAD} fájl tölthető fel.`,
    };

  const readBytes = input.readBytes ?? readFileBytes;
  const body = new FormData();
  if (input.type !== undefined) body.append("type", input.type);
  for (const file of input.files) {
    // A `as unknown as Blob` azt mondja ki, hogy a futtató mást vár, mint a DOM
    // típusdefiníció -- a rész alakjáért az `uploadPart` felel, és azt a
    // `document-upload.spec.ts` méri, nem ez a sor.
    body.append(
      UPLOAD_FIELD_NAME,
      uploadPart(file, readBytes) as unknown as Blob,
    );
  }
  return { ok: true, body };
}
