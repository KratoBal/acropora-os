import { buildUnitPaths } from "../service-assets/unit-path.js";

/**
 * EGY ALEGYSEG TELJES UTJA, A GYOKERTOL LEFELE -- ADATBAZISBOL.
 *
 * MIERT KELL, es miert nem eleg a nev: a kod es a nev csak TESTVEREK kozott
 * egyedi, tehat ket tavoli ag alatt ugyanaz a "Biodóm (BIO)" megengedett es
 * termeszetes. Aki egy adatlapon ilyen sort lat, nem tudja megmondani,
 * melyikrol van szo -- es semmi nem jelzi neki, hogy van miben tevedni.
 *
 * Balazs merte vissza 2026-09-16-an, a munkalap adatlapjarol: ott `NMD —
 * Nagymedence` allt, a teljes ut helyett.
 *
 * === A KLIENST A HIVO ADJA, ES EZ NEM STILUS ===
 *
 * A fuggveny NEM importal `prisma`-t. Elso alakjaban megtette, es huszonhat
 * egyseg-teszt bukott el ra: a szolgaltatasok hamis TAROLOVAL futnak, es ha a
 * szolgaltatas maga nyul az adatbazishoz, a hamis tarolo mar nem fedi le.
 * A reteg-rend ebben a kodbazisban az, hogy adatbazishoz a TAROLO nyul --
 * a bukas nem kellemetlenseg volt, hanem pont ezt mondta ki.
 *
 * === MIERT A TESTVEREKET IS BETOLTI, HOLOTT EGY UT KELL ===
 *
 * Mert az ut FELFELE epul, es a szulok azonositojat csak a sorokbol tudjuk. Egy
 * rekurziv lekerdezes korokre is helyes lenne, de ugyanazt a vedelmet ujra meg
 * kellene irni, ami a tiszta fuggvenyben mar all (hianyzo szulo, kor).
 */
export interface UnitPathClient {
  worksheetDepartment: {
    findUnique(args: {
      where: { id: string };
      select: { customerId: true };
    }): Promise<{ customerId: string } | null>;
    findMany(args: {
      where: { customerId: string };
      select: { id: true; name: true; parentId: true };
    }): Promise<{ id: string; name: string; parentId: string | null }[]>;
  };
}

/**
 * A LISTAS ALAK KLIENSE -- EGY ALAIRAS, NEM KETTO, ES EZ MERESBOL KOVETKEZIK.
 *
 * Elsore ket tulterhelessel irtam meg (kulon a gazda-kereses, kulon a fa), es a
 * fordito elutasitotta: a Prisma `findMany` egy GENERIKUS fuggveny, a
 * tulterhelt alakra pedig nem illeszkedik ra. A mezok ezert elhagyhatok, es a
 * ket hivas kozul mindegyik a sajat reszet tolti ki.
 *
 * A LAZASAG ARA, hogy a TIPUS nem mondja meg, melyik hivas mit ad vissza -- ezt
 * a fuggveny torzse tartja rendben, ket egymast koveto lepesben.
 */
export interface UnitPathListClient {
  worksheetDepartment: {
    findMany(args: {
      where: { id?: { in: string[] }; customerId?: { in: string[] } };
      select: {
        id: true;
        customerId?: true;
        name?: true;
        parentId?: true;
      };
    }): Promise<
      {
        id: string;
        customerId?: string;
        name?: string;
        parentId?: string | null;
      }[]
    >;
  };
}

export async function unitPathFor(
  client: UnitPathClient,
  departmentId: string | null | undefined,
): Promise<string[] | null> {
  if (!departmentId) return null;

  const egyseg = await client.worksheetDepartment.findUnique({
    where: { id: departmentId },
    select: { customerId: true },
  });
  if (!egyseg) return null;

  const sorok = await client.worksheetDepartment.findMany({
    where: { customerId: egyseg.customerId },
    select: { id: true, name: true, parentId: true },
  });

  /**
   * A HIANYZO UT `null`, NEM URES TOMB. A ketto ket kulonbozo allitas: az
   * ures tomb azt mondana, hogy az ut ISMERT es nulla hosszu, a `null` azt,
   * hogy nem tudjuk. A felulet a masodikra visszaeshet a rovid nevre.
   */
  return buildUnitPaths(sorok).get(departmentId) ?? null;
}

/**
 * UGYANAZ EGY EGESZ OLDALRA, KET LEKERDEZESBOL -- ES A DARABSZAM NEM SZAMIT.
 *
 * MIERT NEM AZ `unitPathFor` SORONKENT: az egy alegysegre KET kerdest tesz fel
 * az adatbazisnak. Egy otvenes listan az szaz kerdes, es epp az a kepernyo
 * lassulna be tole, amit olvashatobba akarunk tenni. Ez a valtozat ketto marad
 * akkor is, ha ketszaz sor jon.
 *
 * A KET LEPES: eloszor a kert egysegek GAZDAJA (`customerId`) all elo, mert a
 * fa partnerenkent kulon all; utana egyszerre jon le mindegyik erintett partner
 * teljes faja. A `buildUnitPaths` ezutan EGYSZER fut, az osszes soron -- hogy
 * ez miert biztonsagos tobb partner mellett, az a torzsben all megindokolva.
 *
 * A VISSZAADOTT TERKEP CSAK AZT TARTALMAZZA, AMIRE UT EPITHETO. Ami hianyzik
 * belole, arrol nem azt allitjuk, hogy nulla hosszu az utja, hanem hogy nem
 * tudjuk -- a hivo ilyenkor a rovid nevre esik vissza. Ugyanaz a kulonbseg,
 * mint az `unitPathFor` `null` erteke es egy ures tomb kozott.
 */
export async function unitPathsFor(
  client: UnitPathListClient,
  departmentIds: (string | null | undefined)[],
): Promise<Map<string, string[]>> {
  const kertek = [
    ...new Set(departmentIds.filter((id): id is string => Boolean(id))),
  ];
  if (kertek.length === 0) return new Map();

  const gazdak = await client.worksheetDepartment.findMany({
    where: { id: { in: kertek } },
    select: { id: true, customerId: true },
  });
  const customerIds = [
    ...new Set(
      gazdak
        .map((sor) => sor.customerId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (customerIds.length === 0) return new Map();

  const nyers = await client.worksheetDepartment.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true, name: true, parentId: true },
  });
  /**
   * A NEV NELKULI SOR KIMARAD, NEM URES NEVVEL KERUL BE. A kliens felulete
   * elhagyhatonak irja le a mezot (lasd fent, miert), a valosagban viszont
   * kotelezo -- egy ures nevvel beengedett sor CSENDBEN rovidebb utat adna.
   */
  const sorok = nyers
    .filter(
      (sor): sor is { id: string; name: string; parentId: string | null } =>
        typeof sor.name === "string",
    )
    .map((sor) => ({
      id: sor.id,
      name: sor.name,
      parentId: sor.parentId ?? null,
    }));

  /**
   * TOBB PARTNER FAJA EGY HIVASBAN: BIZTONSAGOS, ES EZT MEG KELL INDOKOLNI.
   *
   * A `buildUnitPaths` AZONOSITO szerint lepked felfele, az azonosito pedig az
   * egesz tablan egyedi -- egy lanc tehat nem tud atsetalni egy masik partner
   * faiba, akkor sem, ha a ket fa azonos NEVEKET hasznal. Epp az azonos nevek
   * miatt letezik ez a mezo, ezert a kerdes jogos, es a valasz nem "nyilvan
   * jo", hanem az egyediseg.
   *
   * Amit viszont NEM szabad: partnerre szukiteni a `parentId` lancot. A gyoker
   * fele vezeto uton minden szint UGYANAHHOZ a partnerhez tartozik, tehat a
   * szukites nem adna semmit, csak egy tovabbi feltetelt, ami elromolhat.
   */
  const utak = buildUnitPaths(sorok);

  const eredmeny = new Map<string, string[]>();
  for (const id of kertek) {
    const ut = utak.get(id);
    if (ut) eredmeny.set(id, ut);
  }
  return eredmeny;
}
