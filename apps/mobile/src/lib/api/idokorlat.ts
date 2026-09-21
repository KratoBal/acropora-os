/**
 * MENNYI IDEIG VARUNK EGY HIVASRA -- ES MIERT KELL EGYALTALAN VARNI RA HATART.
 *
 * === A MERT ESET (acrobot, 2026-09-18) ===
 *
 * A kliens `fetch` hivasan NEM volt idokorlat. Egy FELIG allo kapcsolat
 * (fogva tarto halozat, olyan TCP, ami sosem epul fel) eseten a `fetch` SOHA
 * nem dol el: nem dob, tehat a sorba teves nem indul el, es nem is ter vissza,
 * tehat a sikeres ag sem. A mutacio orokke `isPending` marad, a mentes gomb
 * orokke tiltott, uzenet pedig nincs.
 *
 * REPULO UZEMMODBAN EZERT MUKODIK, PINCEBEN VISZONT NEM: ott a `fetch`
 * AZONNAL dob, tehat a felvitel sorba kerul. A ketto kivulrol ugyanaz az
 * "offline" szo.
 *
 * === MIERT BIZTONSAGOS MEGSZAKITANI EGY IRAST ===
 *
 * A megszakitas `ApiNetworkError`-ra fordul, amit a `saveOrQueue` NEM
 * elutasitasnak lat (nincs HTTP-statusza), tehat SORBA TESZI. A sorbol
 * kesobb ugyanazzal a `clientOperationId`-val megy fel, es a szerver
 * idempotencia-kulcsa a masodik kerest az ELSO jegyre feleli -- ket felvitel
 * tehat nem keletkezik.
 *
 * === MIERT NEM EGY SZAM MINDENRE ===
 *
 * A fenykep-feltoltes UGYANEZEN az uton megy, `FormData` torzzsel. Egy
 * huszmasodperces hatar epp ott vagna el a munkat, ahol a leginkabb szamit: a
 * gyenge tereju helyszinen, egy tobb megabajtos kepnel. A kettot ezert a
 * TORZS ALAKJA valasztja szet, nem a hivo emlekezete -- egy hivonkent kezzel
 * atadott szam elobb-utobb kimaradna valahonnan, es a hianya nema lenne.
 */

/** A rendes hivas hatara: keres-valasz, kis torzzsel. */
export const ALAP_IDOKORLAT_MS = 20_000;

/** A fajl-feltoltese, ami gyenge tereon percekig is tarthat. */
export const FELTOLTES_IDOKORLAT_MS = 120_000;

/**
 * A `FormData` felismerese ALAK SZERINT, nem `instanceof`-fal.
 *
 * A React Native sajat `FormData`-t hoz, a teszt-kornyezet a Node-et, es egy
 * `instanceof` a ketto kozul mindig csak az EGYIKRE igaz -- a masikra pedig
 * csendben hamis, vagyis a feltoltes a rovid hatart kapna.
 */
function feltoltesE(body: unknown): boolean {
  if (body === null || typeof body !== "object") return false;
  return typeof (body as { append?: unknown }).append === "function";
}

export function keresIdokorlatja(input: {
  body?: unknown;
  /** A hivo kimondott hatara. Ha all, MINDENT felulir. */
  timeoutMs?: number;
}): number {
  if (typeof input.timeoutMs === "number" && input.timeoutMs > 0)
    return input.timeoutMs;
  return feltoltesE(input.body) ? FELTOLTES_IDOKORLAT_MS : ALAP_IDOKORLAT_MS;
}
