/**
 * A CSATOLMÁNYOK MEGNÉZÉSE -- a döntések, a képernyőn kívül.
 *
 * === A MÉRT HIÁNY, 2026-09-17 ===
 *
 * Balázs szava: „a feltöltött fényképek sehol nem jelennek meg. marmint nem
 * tudom megnezni se a mobil appban se a weben." A telefonon ez SZÓ SZERINT
 * igaz volt: az `apps/mobile/src` egészében nulla kép-megjelenítés állt, és
 * egyetlen képernyő sem hívta a dokumentum-listát.
 *
 * === MIÉRT NEM MŰKÖDIK EGY SIMA KÉP-HIVATKOZÁS ===
 *
 * A letöltő végpont Bearer tokent kér, ÉS `attachment` diszpozícióval küld.
 * A WEBEN mind a kettő akadály. A TELEFONON csak az első: a natív képbetöltő a
 * bájtokat kéri le és dekódolja, a diszpozíciót nem értelmezi. A megoldás tehát
 * nem a szerver átírása, hanem az, hogy a kérés VIGYE a fejlécet.
 *
 * A HATÁRA KIMONDVA, mert ezt innen nem tudom lemérni: a React Native
 * `ImageURISource` TÍPUSA visel `headers` mezőt (mérve, `react-native@0.86.2`,
 * `Libraries/Image/ImageSource.d.ts`), és a natív betöltő ezt küldi el. Hogy
 * MIND A KÉT platformon (iOS és Android) tényleg elmegy-e, azt készülék nélkül
 * nem tudom megmérni -- ez nem a kódról szóló kérdés. Ha egy készüléken kiderül,
 * hogy nem megy át, a következő lépés NEM ez a modul, hanem egy külön néző-út a
 * szerveren, és az már döntés.
 *
 * === MIÉRT KÖZÖS MODUL, HOLOTT MA EGY HÍVÓJA VAN ===
 *
 * Mert a második hívó MÁR KI VAN ADVA: ugyanez a szakasz a hibajegy adatlapjára
 * is kell (kártya e74d791a). A fénykép-menet ebben az appban négyszer másolódott
 * le, mielőtt valaki kiemelte -- ez a modul azért áll itt, hogy a második hívó
 * HÍVÁS legyen, ne másolat.
 */

/** A lista egy sora, ahogy a szerver adja. */
export interface ServiceDocumentSummary {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * MEGNÉZHETŐ-E EZ A CSATOLMÁNY A TELEFONON.
 *
 * CSAK KÉP. A PDF-et és a többit a natív képbetöltő nem rajzolja ki, és egy
 * törött csempe ugyanúgy néz ki, mint egy elromlott kép -- a nem-kép
 * csatolmány ezért NÉV szerint áll a listán, nem csempeként.
 *
 * A `startsWith` ELÉ NORMALIZÁLÁS KELL: a szerver a bejelentett típust adja
 * vissza, és az tartalmazhat paramétert (`image/jpeg; charset=binary`) vagy
 * nagybetűt.
 */
export function isViewableImage(contentType: string): boolean {
  return contentType.trim().toLowerCase().startsWith("image/");
}

/**
 * A CSATOLMÁNY-VÁLTOZAT NEVE ÉS A KÉRÉS-PARAMÉTER -- KÉZI MÁSOLAT.
 *
 * A FORRÁS a `packages/types/src/document-variant.ts`. Ez a csomag SZÁNDÉKOSAN
 * kívül van a pnpm workspace-en, tehát nem tudja importálni; ugyanaz a helyzet,
 * mint a válasz-típusoknál. A két oldal egyezését a szerver oldali
 * `mobile-response-mirror` háló méri, nem a fordító.
 *
 * ÉS AZ ELTÉRÉS ITT NÉMA LENNE: egy elgépelt érték mellett a szerver az
 * EREDETIT adná vissza, a csempe megjelenne, semmi nem hibázna -- csak a
 * megtakarítás maradna el, és pont az a kliens fizetné meg, ahol a sávszélesség
 * a legdrágább.
 */
export const DOCUMENT_VARIANT_PARAM = "variant";
export const DOCUMENT_THUMBNAIL_VARIANT = "thumbnail";

/**
 * A HITELESÍTETT KÉP-FORRÁS.
 *
 * TISZTA FÜGGVÉNY, hogy MÉRHETŐ legyen: a token és a cím kívülről jön, nem a
 * tárolóból. Így egy elgépelt útvonal vagy egy lemaradt fejléc állításon bukik
 * el, nem a helyszínen, egy üres csempén.
 *
 * === A `variant` KÖTELEZŐ, ÉS EZ ACROBOT DÖNTÉSE (2026-09-18) ===
 *
 * Mind a három képernyő EGY horgot használ, és abból épül a 104 pontos CSEMPE
 * ÉS a TELJES KÉPERNYŐS kép is. Ha ez a paraméter elhagyható lenne, egy
 * lemaradt hívóhely csendben BÉLYEGKÉPET adna a nagy képnek: nem hibázna, nem
 * állna meg, csak ELMOSÓDNA. Egy elmosódott szerviz-fénykép az a fajta
 * károsodás, amit senki nem jelent be hibaként, csak egyszer csak nem lehet
 * elolvasni róla a típustáblát.
 *
 * Kötelezőként minden hívóhely KIMONDJA, melyiket kéri, és egy új képernyő
 * fordítási hibát kap, amíg nem dönt.
 */
export type DocumentImageVariant = "thumbnail" | "original";

export function documentImageSource(input: {
  apiUrl: string;
  token: string;
  ownerPath: string;
  documentId: string;
  variant: DocumentImageVariant;
}): { uri: string; headers: Record<string, string> } {
  const alap = input.apiUrl.replace(/\/+$/, "");
  const cim = `${alap}${input.ownerPath}/documents/${encodeURIComponent(input.documentId)}`;
  return {
    uri:
      input.variant === "thumbnail"
        ? `${cim}?${DOCUMENT_VARIANT_PARAM}=${DOCUMENT_THUMBNAIL_VARIANT}`
        : cim,
    headers: { Authorization: `Bearer ${input.token}` },
  };
}

/**
 * MIT MOND A SZAKASZ -- vagy `null`, ha van mit mutatni.
 *
 * A NÉGY ÜRES-ESET NÉGY KÜLÖN MONDAT, mert a teendőjük más. Egy közös „nincs
 * fénykép" mondat a betöltés és a hiba esetére is azt állítaná, hogy nincs --
 * holott olyankor csak nem tudjuk.
 */
export function describeDocuments(input: {
  loading: boolean;
  error: boolean;
  total: number;
  images: number;
}): string | null {
  if (input.error)
    return "A csatolmányok listája most nem tölthető be. Térerőnél próbáld újra.";
  if (input.loading) return "A csatolmányok töltődnek...";
  if (input.total === 0) return "Ehhez a laphoz még nincs csatolmány.";
  if (input.images === 0)
    return "Ezen a lapon nincs fénykép, csak egyéb csatolmány.";
  return null;
}

/**
 * A NEM MEGNÉZHETŐ CSATOLMÁNY SORA.
 *
 * KIMONDJA, HOGY ITT NEM NYITHATÓ MEG. Enélkül a szerelő koppintgatna rajta, és
 * azt hinné, elromlott -- ugyanaz a hiba, mint egy gomb, ami némán nincs ott.
 */
export function describeUnviewableDocument(
  doc: ServiceDocumentSummary,
): string {
  return `${doc.fileName} (${doc.contentType}) -- ez a webes felületen nyitható meg.`;
}

/** A méret emberi alakban. Egy nyers bájtszám a helyszínen semmit nem mond. */
export function formatDocumentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} kB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
