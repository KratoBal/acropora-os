/**
 * MI TORTENJEN AZ ERTESITESSEL, AMIG AZ APP NYITVA VAN.
 *
 * === A HIBA, AMIT EZ JAVIT, ES AHOGY MERVE LETT ===
 *
 * Az `expo-notifications` sajat forrasa mondja ki (57.0.9,
 * `NotificationsHandler.js`): „The default behavior when the handler is not set
 * or does not respond in time is not to show the notification."
 *
 * Merve 2026-09-04: az appban a `setNotificationHandler` SEHOL nem futott le.
 * Az `expo-notifications` mindossze ket helyen szerepel a forrasban (a
 * `push-device.ts` engedely- es token-kereseiben, es a `usePushNavigation.ts`
 * koppintas-horgan) -- ez a kontroll zarja ki, hogy a nulla a keresesem
 * tulajdonsaga legyen. A `setNotificationHandler` neve csak a lefordított
 * csomagban all, vagyis a konyvtar sajat definiciojakent, nem a mi hivasunkkent.
 *
 * KOVETKEZMENY, ES EZ AZ, AMI A SZERELOT ERINTI: ha a telefon a kezeben van es
 * az app NYITVA, egy kiosztott munkalap ertesitese SEHOL nem jelent meg. Nem
 * hibaval: csendben. Hattérben mukodott, tehat a hiba pontosan akkor allt elo,
 * amikor a kollega epp dolgozott az appal.
 *
 * === MIERT NEM A KEPERNYON DOL EL ===
 *
 * Az appban nincs komponens-teszt: ami a `_layout.tsx` torzseben marad, azt
 * csak kezzel, telefonon lehet kiprobalni. A DONTES (mit mutatunk, szol-e)
 * ezert itt all, ahol merheto; ott csak a bekotes marad.
 *
 * A tipus SAJAT, szerkezeti alak: ez a fajl a teszt-forditasba is bekerul, az
 * pedig nem tud `expo-notifications`-t betolteni. A `_layout.tsx` viszont a
 * VALODI fuggvenynek adja at, tehat a ket alak eltereserol a fordito szol.
 */

/**
 * Amit a rendszernek visszaadunk. A mezonevek a konyvtar
 * `NotificationBehavior` tipusabol valok, 57.0.9.
 *
 * A `shouldShowAlert` SZANDEKOSAN NINCS BENNE: a konyvtarban elavult, es ha
 * atadjuk, futasidoben figyelmeztetest ir a naploba. Egy regi peldabol masolt
 * kod pont ezt hozna vissza.
 */
export interface ForegroundNotificationBehavior {
  shouldShowBanner: boolean;
  shouldShowList: boolean;
  shouldPlaySound: boolean;
  shouldSetBadge: boolean;
}

/**
 * MINDIG MEGMUTATJUK, ES NEM A NYITOTT KEPERNYOTOL FUGGOEN.
 *
 * Lehetne finomabb (ne szoljon, ha epp azon a munkalapon all a kollega), de az
 * a valtozat az AKTUALIS UTVONALTOL fuggne, amit ebbol a retegbol nem latunk,
 * es amit semmi nem merne. Egy elmaradt sav dragabb, mint egy folosleges:
 * a folosleges LATSZIK es bosszanto, az elmaradt NEMA -- a kollega nem tudja
 * meg, hogy kapott munkat.
 */
export function foregroundNotificationBehavior(): ForegroundNotificationBehavior {
  return {
    shouldShowBanner: true,
    /**
     * A LISTABA IS BEKERUL. E nelkul a sav felvillan es nyomtalanul eltunik:
     * aki epp nem nezte a telefont abban a masodpercben, sehol nem talalja meg.
     */
    shouldShowList: true,
    /**
     * A HANG NEM IZLES-KERDES, HANEM ANDROIDON A SAV FELTETELE.
     *
     * A konyvtar tipusanak sajat megjegyzese (57.0.9): „On Android, setting
     * `shouldPlaySound: false` will result in the drop-down notification alert
     * NOT showing, no matter what the priority is."
     *
     * Vagyis egy „ne zavarjuk hanggal" dontes Androidon PONT AZT a savot venne
     * el, amiert ez a modul keszult -- csendben, es csak az egyik platformon.
     *
     * A szerver amugy is hangot ker: az APNs torzsben `sound: "default"` all
     * (`apns.client.ts`). Igy a ket allapot nem valik szet aszerint, hogy a
     * kollega epp hova nez.
     */
    shouldPlaySound: true,
    /**
     * JELVENYT NEM IRUNK. A szerver a torzsben nem kuld `badge` erteket, tehat
     * itt egy szamot TALALNANK KI, amit utana semmi nem tart karban -- egy
     * jelvény, ami nem tud nullazodni, orokre ott marad.
     */
    shouldSetBadge: false,
  };
}
