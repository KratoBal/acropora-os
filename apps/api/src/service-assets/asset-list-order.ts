import type { Prisma } from "@acropora/database";

/**
 * AMI SZERINT AZ ESZKOZ-LISTA RENDEZHETO.
 *
 * Balazs kerese, 2026-09-16 (Discord, Acropora OS szal): "jo lenne ha
 * kattintassal lehetne rendezni az adatokat. az Eszköz, Elhelyezés stb-re
 * gondoltam".
 *
 * A LISTA OT OSZLOPOT MUTAT, DE CSAK HAROM RENDEZHETO EGYERTELMUEN. A masik
 * ketto nem egy adat, hanem tobb osszerakva: a "Hierarchia" a szulo-lanc vagy a
 * reszegysegek szama, a "Muszaki azonosito" pedig gyarto, tipus es sorozatszam
 * egyutt. Azoknal eloszb el kell donteni, MIT jelent a rendezes, es az nem
 * fejlesztoi dontes -- a kerdes Balazsnal all.
 */
export const ASSET_LIST_SORTS = ["name", "status", "placement"] as const;
export type AssetListSort = (typeof ASSET_LIST_SORTS)[number];

export const ASSET_LIST_DIRECTIONS = ["asc", "desc"] as const;
export type AssetListDirection = (typeof ASSET_LIST_DIRECTIONS)[number];

/**
 * A RENDEZES A SZERVEREN DOL EL, ES EZ NEM IZLES.
 *
 * A lista LAPOZVA jon (alapbol 25 sor). Egy bongeszo-oldali rendezes tehat az
 * epp latszo lapot rendezne, es ugy nezne ki, mintha az egeszet tenne -- az
 * elso oldalon allo "legkisebb" ertek valojaban csak a betoltott huszonot
 * kozul lenne a legkisebb. Egy ilyen rendezes ROSSZABB a hianyanal, mert
 * hihetonek latszik.
 *
 * A MASODIK KULCS MINDIG AZ `id`, ES EZ SEM RESZLETKERDES. Lapozasnal a stabil
 * sorrend feltetel: ha ket sor elso kulcsa egyenlo (ket azonos nevu eszkoz, vagy
 * barmelyik allapot-csoport), a rendezetlen dontes lapok KOZOTT is elcsuszhat --
 * ugyanaz a sor megjelenhet a masodik lapon is, egy masik pedig kimaradhat.
 */
export function assetListOrderBy(
  sort: AssetListSort | undefined,
  direction: AssetListDirection | undefined,
): Prisma.AssetOrderByWithRelationInput[] {
  const irany: Prisma.SortOrder = direction === "desc" ? "desc" : "asc";

  if (sort === "status")
    /**
     * AZ ALLAPOT SORRENDJE A SEMABOL JON, NEM BETURENDBEN.
     *
     * A Postgres az enum ertekeket a DEKLARACIO sorrendjeben rendezi, es az
     * `AssetStatus` deklaracioja ertelmes utat ir le:
     *
     *     ACTIVE -> OUT_OF_SERVICE -> IN_REPAIR -> RETIRED
     *     (mukodik, nem mukodik, javitas alatt, kivezetve)
     *
     * Beturendben ez `ACTIVE, IN_REPAIR, OUT_OF_SERVICE, RETIRED` lenne, ami
     * semmit nem mond. A magyar cimkek szerinti betűrend pedig egy HARMADIK
     * sorrend, es az a kliensen sem all elo, mert a szerver rendez.
     *
     * AMI EBBOL KOVETKEZIK, ES AMIT EGY ALLITAS ORIZ: ha valaki uj allapotot
     * vesz fel az enumba, a HELYE megvaltoztatja ezt a rendezest, csendben.
     */
    return [{ status: irany }, { name: "asc" }, { id: "asc" }];

  if (sort === "placement")
    /**
     * AZ ELHELYEZES OSZLOP A TULAJDONOS NEVET MUTATJA, ALATTA A HELYSZINT.
     *
     * A TULAJDONOS POLIMORF, es ezt ki kell mondani, mert a rendezes alakja
     * ebbol kovetkezik, nem valasztasbol: egy eszkoz VAGY partnerhez, VAGY
     * vevohoz tartozik (`supplierId` XOR `customerId`), tehat nincs EGYETLEN
     * oszlop, ami a lathato nevet hordozza.
     *
     * Ket kulcs megy egymas utan, es a masodik oldalon a hianyzo kapcsolat
     * `NULL`. A Postgres a `NULL` erteket novekvo sorrendben hatra teszi, tehat
     * a partner-tulajdonosu eszkozok elore kerulnek, a vevoieik moge --
     * csoportositva, nem osszefesulve.
     *
     * EZ SZANDEKOS, ES A NYILVANTARTAS ALAKJAT KOVETI: az eszkoz-nyilvantartas
     * a SZERVIZ PARTNEREKROL szol, a vevo-tulajdonu sorok a kisebbseg. De mivel
     * ez ertelmezes es nem termeszeti torveny, a felulet is kiirja, mi szerint
     * rendez.
     */
    return [
      { supplier: { name: irany } },
      { customer: { displayName: irany } },
      { name: "asc" },
      { id: "asc" },
    ];

  // `name` es az ismeretlen ertek is ide esik: ez a lista eredeti, alapertelmezett
  // sorrendje, tehat a parameter nelkuli hivas beture ugyanazt adja, mint eddig.
  return [{ name: irany }, { id: "asc" }];
}
