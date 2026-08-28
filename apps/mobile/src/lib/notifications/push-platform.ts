/**
 * Melyik platformnak vallja magát a telefon a regisztrációkor.
 *
 * KÜLÖN MODUL, a `push-registration.ts` mintájára: a `lib/api/notifications.ts`
 * behúzza a `client.ts` fájlt, azon keresztül az Expo futásidejű modulokat,
 * tehát ott ezt semmilyen teszt nem érné el. Itt igen, mert ez a fájl semmit
 * nem importál.
 *
 * MÉRVE 2026-08-28: a regisztráció eddig BEÉGETVE küldte az `"IOS"` értéket.
 * Ma ez nem változtat semmit, mert Android kiadás nincs -- de a lánc elején
 * álló állítás akkor is hamis volt, és a hibája NEM ott jelentkezett volna,
 * ahol keletkezik: egy Android készülék iOS eszközként került volna be, és a
 * küldés oldalán látszana érvénytelen tokennek.
 */

/** Amit a szerver `DevicePlatform` enumja ismer. */
export type DevicePlatform = "IOS" | "ANDROID";

/**
 * A futókörnyezet platformja a szerver alakjára.
 *
 * A HARMADIK ESET (`"web"` és társai) SZÁNDÉKOSAN `"IOS"`, és ez nem a régi
 * hazugság visszacsempészése: a szerver enumja két értéket ismer, a
 * regisztrációig pedig csak valódi készülék jut el natív push tokennel (lásd
 * `push-device.ts`, `Device.isDevice`). Ez az ág tehát a drótig nem ér el. Ha
 * egyszer mégis kellene egy harmadik platform, akkor a szerver enumját kell
 * bővíteni, nem itt választani helyette.
 */
export function devicePlatform(os: string): DevicePlatform {
  return os === "android" ? "ANDROID" : "IOS";
}
