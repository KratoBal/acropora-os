import type {
  ServiceJobHandoverMailSendSkipReason,
  ServiceJobHandoverMailSkipReason,
} from "@acropora/types";

/**
 * A HAT KIHAGYASI OK HAT KULON MONDATA.
 *
 * `Record<...>`, NEM egy `switch` alapertelmezett aggal: ha a szerver egy
 * ujabb okot vezet be, ez FORDITASI HIBA lesz. Egy alapertelmezett ag csendben
 * "ismeretlen ok"-ot mutatna a kezelonek, es a felulet zolden allna tovabb.
 *
 * ES EZ A JOSLAT BEVALT, 2026-09-22-en. Amikor a levelezes harom utja kulon
 * kapcsolot kapott, a `mode-off` ketteesett (`mail-off` es `path-off`), es a
 * fordito PONTOSAN ITT allt meg -- nem a felhasznalonal, egy ures mondattal.
 * Ez a bekezdes ezert nem a szandekot irja le tovabb, hanem egy MERT esetet.
 *
 * Mindegyik mondat a TEENDOT nevezi meg, nem az allapotot: a hat ok hat
 * kulonbozo embert erint, es egy kozos "nem kuldheto" mondat mindegyiknel
 * ugyanoda vezetne -- hozzank. A harom kapcsolos ok kozott is VALODI a
 * kulonbseg: az elso az egesz kornyezetre szol, a masodik EGY levelfajtara, a
 * harmadik (`no-redirect`) pedig azt mondja meg, hogy a kuldes MINDEN mas
 * felteteltol keszen all, es CSAK a cel hianyzik.
 *
 * ES A HARMADIK MASODSZOR IGAZOLTA A JOSLATOT, 2026-09-22-en: amikor a hianyzo
 * atiranyitas sajat okot kapott, a fordito megint PONTOSAN ITT allt meg. Egy
 * alapertelmezett ag helyette azt mondta volna a kezelonek, hogy "ismeretlen
 * ok" -- epp abban az allapotban, ahol a level MAJDNEM kiment.
 */
/*
  A KOLTOZTETESSEL EGYETLEN DOLOG VALTOZOTT A BLOKKON: a lathatosaga.

  A tabla 2026-09-22-ig a dialogus fajljaban allt, modul-privatként. Azert
  kerult ide, mert a KULDES tablaja ebbol szorodik -- es egy masolt par
  csendben elcsuszna. A szovege es a fejlece bajtra valtozatlan.
*/
export const KIHAGYAS_OKA: Record<ServiceJobHandoverMailSkipReason, string> = {
  "mail-off":
    "A levélküldés ki van kapcsolva ezen a környezeten, ezért most nem megy ki semmi. Ez üzemeltetési beállítás.",
  "path-off":
    "A levélküldés be van kapcsolva, de az átadási levél külön ki van kapcsolva. Ez is üzemeltetési beállítás, és a többi levéltípust nem érinti.",
  "no-redirect":
    "A levélküldés be van kapcsolva, de nincs megadva, hová menjenek a levelek. Amíg ez hiányzik, egyetlen levél sem megy ki senkinek. Ez üzemeltetési beállítás.",
  "no-department":
    "A hibajegyhez nincs helyszín rendelve, így nincs kinek kiküldeni. Előbb a hibajegy helyszínét kell megadni.",
  "no-customer":
    "A hibajegy helyszínéhez nem tartozik ügyfél, ezért a címzettek nem állapíthatók meg. Ez törzsadat-hiba.",
  "no-recipient":
    "Az ügyfélnek nincs aktív portál-felhasználója, ezért nincs kinek kiküldeni. A hozzáférést az ügyfélnél kell létrehozni.",
};

/**
 * ES A KULDES TABLAJA, AMI A FENTIBOL EPUL -- NEM UJRAGEPELVE (2026-09-22).
 *
 * === MIERT KET TABLA, ES MIERT NEM EGY ===
 *
 * Az elonezet HAT okot tud adni, a kuldes NYOLCAT. A `no-sender` es a `no-job`
 * csak a kuldes utjan all elo. Ha a fenti tabla kapna ket tovabbi sort, az azt
 * allitana, hogy az elonezet is adhat ilyet -- es a kovetkezo olvaso egy olyan
 * agat keresne, ami ott sosem fut le.
 *
 * === ES MIERT SZORAS, NEM MASOLAS (acrobot kikotese, 2026-09-22 19:38) ===
 *
 * Ha a KOZOS hat ok valamelyikenek a szovege valtozik, egy kezzel masolt
 * tablaban KETTO lenne belole, es a ketto csendben elcsuszna. A fordito ezt NEM
 * fogna meg, mert mindket tabla TELJES maradna -- pontosan az a nema elteres,
 * ami ellen az egesz szukites keszult.
 *
 * Ha egy kozos ok szovege valaha SZANDEKOSAN mas kell legyen a ket agon, azt a
 * szoras UTAN egy sorral kell felulirni. Akkor a KULONBSEG latszik, nem az
 * azonossag all ketszer leirva.
 */
export const KULDES_KIHAGYAS_OKA: Record<
  ServiceJobHandoverMailSendSkipReason,
  string
> = {
  ...KIHAGYAS_OKA,
  /*
    A KET UJ SOR NEM A CIMZETTEKRE MUTAT, ES EZ A LENYEGUK.

    A felulet 2026-09-22-ig minden kihagyott kuldesre azt mondta, hogy "nezd meg
    ujra a cimzetteket". Mind a ket esetben a cimzettek HELYESEK -- a mondat
    tehat a rossz helyre kuldte a kezelot, epp amikor eloszor probalta.
  */
  "no-sender":
    "A levélküldő nincs beállítva ezen a környezeten, ezért a levél nem ment ki. A címzettekkel nincs baj: ez üzemeltetési beállítás.",
  "no-job":
    "A hibajegy a küldés pillanatában már nem volt elérhető. Frissítsd az oldalt, és nézd meg, létezik-e még a jegy.",
};
