/**
 * A MAGYAR ÍRÁSMÓDDAL BEÍRT SZÁM -- A BEVITEL OLDALÁN.
 *
 * === A JELENTÉS (Balázs, 2026-09-21 12:51:56 UTC, Discord) ===
 *
 * „ha a munkalapon vesszot és nem pontot ir a kollega az orahoz akkor hibat
 * dob: pl. 0,5"
 *
 * A `Number("0,5")` nem rossz számot ad, hanem NEM SZÁMOT (`NaN`), és a
 * szerver ezt utasítja el, név szerint. Vagyis aki magyar írásmóddal ír, az ma
 * egyáltalán nem tud sort felvinni.
 *
 * === MIÉRT ITT ÁLL, ÉS MIT NEM CSINÁL ===
 *
 * A webes szerkesztőben NÉGY mező ugyanezt a hibát hordozza (mennyiség,
 * létszám, egységár, áfakulcs), és négy külön javítás négyszer avul el -- az
 * ötödik mezőnél pedig valaki elfelejti. Egy helyen áll, és mind a négy ezen
 * megy át.
 *
 * AMIT SZÁNDÉKOSAN NEM CSINÁL: nem lesz megengedőbb a mainál. A vessző
 * pontra cserélése UTÁN pontosan az megy át, ami eddig is átment. A „0,5,5"
 * `0.5.5` alakot ad, az `abc` marad `abc` -- mind a kettő `NaN`, tehát a
 * szerver ugyanúgy elutasítja, NÉV SZERINT, ahogy eddig.
 *
 * Ez nem óvatosság: egy javítás, ami mindent elfogad, a rossz adatot csendben
 * beengedi, és az rosszabb a mai hibaüzenetnél.
 *
 * === ÉS AMIT NEM MOND MEG: A MEGJELENÍTÉST ===
 *
 * Ez a BEVITELRŐL szól. Hogy a lap MIT ÍR KI, az külön kérdés -- a szerverről
 * jövő érték mindig pontot használ.
 *
 * === A TELEFON KÜLÖN ÚTON JÁR, ÉS EZ MÉRÉS, NEM MULASZTÁS ===
 *
 * Az `apps/mobile` NINCS a pnpm munkatérben, és nem függ ettől a csomagtól
 * (saját, kézzel írt típusokat tart). Onnan tehát nem importálható.
 *
 * A telefon ezt a hibát MÁR MEGOLDOTTA (`worksheet-line.ts`,
 * `parseQuantity`), és a szabálya SZIGORÚBB: egy reguláris kifejezéssel
 * helyben utasítja el azt, amit itt a szerver utasít el. A két szabály tehát
 * NEM azonos -- de arra a kérdésre, ami miatt ez a modul létezik, ugyanazt
 * feleli: a „0,5" átmegy, a „0,5,5" és az „abc" nem. Mind a két oldalon áll
 * állítás erre a három esetre, tehát ha valamelyik elcsúszik, az PIROS lesz,
 * nem néma.
 */
export function magyarSzamErteke(value: string): number {
  /*
    MINDEN VESSZŐ CSERÉLŐDIK, NEM CSAK AZ ELSŐ. Egy `replace(",", ".")` a
    „0,5,5" alakból „0.5,5"-öt csinálna -- az szintén `NaN`, tehát a végeredmény
    ma ugyanaz. De a szabály olvashatósága nem: a „minden vessző tizedesjel"
    mondat pontosan az, amit a felhasználó csinál, és nem hagy kérdést arról,
    mi történik a másodikkal.
  */
  return Number(value.trim().replaceAll(",", "."));
}
