import { forgetOfflineAssets } from "./asset-cache";
import { forgetWorksheetDepartments } from "./worksheet-department-cache";

/**
 * KIJELENTKEZÉSKOR MINDEN HELYI MÁSOLAT MEGY, EGY HELYRŐL.
 *
 * === MIÉRT KÜLÖN MODUL, ÉS MIÉRT NEM AZ ESZKÖZ-MÁSOLATBAN BŐVÍTVE ===
 *
 * A kijelentkezés eddig a `forgetOfflineAssets` függvényt hívta, és az a NEVE
 * szerint az eszközökről szól. Egy második tábla törlését beletenni azt
 * jelentené, hogy a név hazudik -- a következő olvasó pedig, aki egy HARMADIK
 * másolatot ír, nem ott keresné a takarítást, ahol van.
 *
 * Ez a modul az a hely, ahol keresni fogja. A `sign-out.ts` szerződése
 * (`forgetOfflineData`) már így is nevezi a lépést; eddig egyetlen tábláról
 * szólt, mert csak egy volt.
 *
 * === AMI NEM KERÜL IDE: A SOR ===
 *
 * A `sync_queue` NEM másolat, hanem a felvitel EGYETLEN létező példánya. Egy
 * kijelentkezés, ami törli, a szerelő rögzítését semmisítené meg -- azt, amit
 * a telefon még nem tudott felküldeni. Ha egyszer mégis kell rá szabály (idegen
 * kolléga veszi át a készüléket egy fel nem küldött lappal), az KÜLÖN döntés,
 * és nem ennek a függvénynek a csendes bővítése.
 */
export async function forgetOfflineData(): Promise<void> {
  await forgetOfflineAssets();
  await forgetWorksheetDepartments();
}
