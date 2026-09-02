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

export type BuildUploadResult =
  { ok: true; body: FormData } | { ok: false; reason: string };

/**
 * Felépíti a kérés törzsét, vagy megmondja, miért nem lehet.
 *
 * A HIBÁK ITT, A KÜLDÉS ELŐTT DERÜLNEK KI, és ez a lényeg: egy üres válogatás
 * vagy tizenegy fájl a szerverig is elmenne, csak lassabban és drágábban, és a
 * szerelő addig a töltés-jelzőt nézné.
 */
export function buildAssetDocumentUpload(input: {
  type: string;
  files: readonly PickedFile[];
}): BuildUploadResult {
  if (input.files.length === 0)
    return { ok: false, reason: "Válassz ki legalább egy fájlt." };

  if (input.files.length > MAX_FILES_PER_UPLOAD)
    return {
      ok: false,
      reason: `Egyszerre legfeljebb ${MAX_FILES_PER_UPLOAD} fájl tölthető fel.`,
    };

  const body = new FormData();
  body.append("type", input.type);
  for (const file of input.files) {
    // A React Native FormData a fájl-mezőt objektumként veszi át; a webes
    // `File` típus itt nem létezik, és a `as unknown as Blob` csak azt mondja
    // ki, hogy a futtató mást vár, mint a DOM típusdefiníció.
    body.append(UPLOAD_FIELD_NAME, {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);
  }
  return { ok: true, body };
}
