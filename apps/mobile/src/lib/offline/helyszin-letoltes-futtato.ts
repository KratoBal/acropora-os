import {
  osszegezHelyszinLetoltes,
  type LetoltesOsszegzes,
  type ReszEredmeny,
} from "./helyszin-letoltes";

/**
 * A TIPUSOK ITT HELYBEN, SZERKEZETI ALAKKENT ALLNAK -- ES EZ MERESBOL JON.
 *
 * Eloszor a mobil sajat deklaracioit importaltam (`../api/assets`,
 * `../api/worksheets`). A FUTTATO igy is lefordul, a SPECJE viszont nem: a
 * `tsconfig.test.json` szandekosan nem hordoz `paths` bejegyzest, azok a
 * modulok pedig `@/` alakkal importalnak tovabb -- tehat a teszt-forditas
 * `TS2307`-tel elhasal, negy fajlra.
 *
 * A HELYI, SZERKEZETI ALAK EZT MEGSZUNTETI, es kozben TOBBET is mond: ez a
 * menet CSAK ennyit olvas a tetelekbol. A valodi tipusokkal a HIVO oldalan
 * talalkozik a fordito, ott, ahol a fuggvenyeket atadjak -- ugyanaz a minta,
 * mint a `uj-jegy-eszkoz.ts` `SearchableAsset` alakja.
 */
interface Sor {
  id: string;
}

interface LapozottValasz<T> {
  items: T[];
  pagination: { totalPages: number };
}

interface JegySor extends Sor {
  /** A lista-elem UTAT hordoz, nem azonositot -- lasd a fejlecet. */
  departmentPath: string[] | null;
}

/**
 * A HELYSZIN LETOLTESE -- A MENET, BEFECSKENDEZETT HIVASOKKAL.
 *
 * A dontes (mit mondunk a vegen) a `helyszin-letoltes.ts`-ben all; EZ a menet.
 * A hivasok kivulrol jonnek, tehat a sorrend, a lapozas es a HIBAKEZELES
 * halozat es adatbazis nelkul is merheto -- ugyanaz az alak, mint a
 * `saveOrQueue`-nal.
 *
 * === MI JON LE, ES MI NEM ===
 *
 *   eszkozok    A HELYSZINRE SZURVE, a szerveren. A szerver a RESZFAT is
 *               beleveszi, tehat a "Biodom" alatti medencen allo eszkoz is
 *               jon. Lapozva, vegig -- a legnagyobb reszfa ma 49 eszkoz, a
 *               lapmeret 50, es egyetlen uj eszkoz atvinne a hataron.
 *
 *   munkalapok  A HELYSZINRE SZURVE, a szerveren (`departmentId`). Lapozva.
 *
 *   hibajegyek  NEM HELYSZINRE SZURVE, ES EZ MERESBOL KOVETKEZIK: a
 *               `ServiceJobListQueryDto` HAROM mezot fogad (scope, search,
 *               includeHidden) -- helyszin-szuro nincs benne. A lista-elem
 *               pedig `departmentPath`-t hordoz, nem azonositot, es a nev CSAK
 *               TESTVEREK kozott egyedi: ket tavoli ag alatt ugyanaz a
 *               "Biodóm" megengedett.
 *
 *               EZERT A SZERELO TELJES LATHATO JEGYLISTAJA jon le, nem a
 *               helyszine. Ez TOBB, mint amit a kartya ker, es nem kevesebb --
 *               idegen partner adata nem kerul a keszulekre, mert a listat a
 *               szerver mar a lathatosagra szukiti.
 *
 *               A RESZLETLAPOKAT viszont a helyszin utjara szurjuk, mert
 *               azokbol darabonkent egy hivas megy. A nev-alapu egyezes itt
 *               BIZTONSAGOSAN romlik el: rossz egyezesnel KEVESEBB reszletlap
 *               jon le, nem rossz adat -- es a hiany a zaro mondatban ott all.
 */

/** Egy hivas, ami elhasalhat: a hiba SORONKENT szamit, nem allitja meg a menetet. */
type Probalkozas<T> = () => Promise<T>;

export interface EszkozFuggosegek<Tetel extends Sor, Reszlet> {
  eszkozLista: (oldal: number) => Promise<LapozottValasz<Tetel>>;
  eszkozReszlet: (id: string) => Promise<Reszlet>;
  eszkozokMentese: (items: Tetel[]) => Promise<void>;
  eszkozReszletMentese: (detail: Reszlet) => Promise<void>;
}

export interface JegyFuggosegek<Tetel extends JegySor, Reszlet> {
  /**
   * A `truncated` a SZERVER vagasarol szol (ketszaz sor). A mobil tukor
   * 2026-09-21-ig nem is deklaralta, tehat a telefon nem tudott rola.
   */
  jegyLista: () => Promise<{ items: Tetel[]; truncated?: boolean }>;
  jegyReszlet: (id: string) => Promise<Reszlet>;
  jegyekMentese: (items: Tetel[]) => Promise<void>;
  jegyReszletMentese: (detail: Reszlet) => Promise<void>;
}

export interface MunkalapFuggosegek<Tetel extends Sor, Reszlet> {
  munkalapLista: (oldal: number) => Promise<LapozottValasz<Tetel>>;
  munkalapReszlet: (id: string) => Promise<Reszlet>;
  munkalapMentese: (detail: Reszlet) => Promise<void>;
}

/**
 * A HAROM RESZ KULON INTERFESZ, ES EZ NEM RENDRAKAS.
 *
 * Egy kozos, hat-parameteres alakbol a reszfuggvenyek nem tudnak olvasni: a
 * fordito szerint egy `Sor` nem adhato at oda, ahol `Eszkoz` all (a hivo
 * SZUKEBB tipussal is peldanyosithatta). Harom kulon interfesszel mindegyik
 * resz CSAK a sajat ket tipusaval talalkozik, es a metszetuket a hivo adja.
 */
export type HelyszinLetoltesFuggosegek<
  Eszkoz extends Sor = Sor,
  EszkozReszlet = unknown,
  Jegy extends JegySor = JegySor,
  JegyReszlet = unknown,
  Munkalap extends Sor = Sor,
  MunkalapReszlet = unknown,
> = EszkozFuggosegek<Eszkoz, EszkozReszlet> &
  JegyFuggosegek<Jegy, JegyReszlet> &
  MunkalapFuggosegek<Munkalap, MunkalapReszlet>;

/**
 * HANY RESZLETLAPOT KERUNK LE EGY RESZBEN.
 *
 * A hatar nem optimalizacio, hanem OR: ha egy helyszin egyszer megno, a
 * letoltes nem all percekre, hanem abbahagyja -- ES A ZARO MONDAT KIMONDJA,
 * hogy nem jott le minden. Egy csendben lerovidult letoltes pont az a hiba,
 * ami ellen ez az egesz funkcio szol.
 */
export const RESZLET_HATAR = 60;

async function probald<T>(hivas: Probalkozas<T>): Promise<T | null> {
  try {
    return await hivas();
  } catch {
    return null;
  }
}

function utEgyezik(
  ut: readonly string[] | null,
  helyszinUt: readonly string[],
): boolean {
  if (!ut || helyszinUt.length === 0) return false;
  return ut.join(" / ") === helyszinUt.join(" / ");
}

export async function letoltHelyszin<
  Eszkoz extends Sor,
  EszkozReszlet,
  Jegy extends JegySor,
  JegyReszlet,
  Munkalap extends Sor,
  MunkalapReszlet,
>(
  input: {
    /**
     * A HELYSZIN AZONOSITOJA NEM SZEREPEL ITT, ES EZ SZANDEKOS: a szurest a
     * HIVO koti bele a `eszkozLista` es a `munkalapLista` fuggvenyekbe. Igy
     * ez a menet nem tud "elfelejteni" egy parametert -- a rossz halmaz a
     * hivonal derul ki, forditaskor, nem itt, futas kozben.
     */
    /** A helyszin neve a zaro mondathoz. */
    helyszinNeve: string;
    /** A helyszin teljes utja, a jegy-reszletlapok szurésehez. */
    helyszinUt: readonly string[];
  },
  deps: HelyszinLetoltesFuggosegek<
    Eszkoz,
    EszkozReszlet,
    Jegy,
    JegyReszlet,
    Munkalap,
    MunkalapReszlet
  >,
): Promise<LetoltesOsszegzes> {
  const reszek: ReszEredmeny[] = [
    await eszkozok(deps),
    await hibajegyek(input.helyszinUt, deps),
    await munkalapok(deps),
  ];
  return osszegezHelyszinLetoltes({
    helyszin: input.helyszinNeve,
    reszek,
  });
}

async function eszkozok<Tetel extends Sor, Reszlet>(
  deps: EszkozFuggosegek<Tetel, Reszlet>,
): Promise<ReszEredmeny> {
  const elso = await probald(() => deps.eszkozLista(1));
  if (!elso) return { resz: "eszkozok", allapot: "elhasalt", darab: 0 };

  const sorok = [...elso.items];
  let hianyzoLap = false;
  for (let oldal = 2; oldal <= elso.pagination.totalPages; oldal += 1) {
    const kovetkezo = await probald(() => deps.eszkozLista(oldal));
    if (!kovetkezo) {
      hianyzoLap = true;
      break;
    }
    sorok.push(...kovetkezo.items);
  }

  await probald(() => deps.eszkozokMentese(sorok));

  /*
    A TELJES ADATLAP AZ, AMIERT EZ A GOMB LETEZIK. Balazs szava: a kollega ma
    "minden eszkoz adatlapjat meg kell nyitnia", mielott lemegy. A lista-sor
    ehhez keves: azon nincs se gyarto, se garancia, se elozmeny.
  */
  const kerheto = sorok.slice(0, RESZLET_HATAR);
  let reszletek = 0;
  let hibasReszlet = false;
  for (const sor of kerheto) {
    const detail = await probald(() => deps.eszkozReszlet(sor.id));
    if (!detail) {
      hibasReszlet = true;
      continue;
    }
    await probald(() => deps.eszkozReszletMentese(detail));
    reszletek += 1;
  }

  if (hianyzoLap || hibasReszlet)
    return {
      resz: "eszkozok",
      allapot: "reszleges",
      darab: reszletek,
      ok: "hibas-sor",
    };
  if (sorok.length > RESZLET_HATAR)
    return {
      resz: "eszkozok",
      allapot: "reszleges",
      darab: reszletek,
      ok: "vagott",
    };
  return { resz: "eszkozok", allapot: "kesz", darab: reszletek };
}

async function hibajegyek<Tetel extends JegySor, Reszlet>(
  helyszinUt: readonly string[],
  deps: JegyFuggosegek<Tetel, Reszlet>,
): Promise<ReszEredmeny> {
  const lista = await probald(() => deps.jegyLista());
  if (!lista) return { resz: "hibajegyek", allapot: "elhasalt", darab: 0 };

  await probald(() => deps.jegyekMentese(lista.items));

  const helyszinei = lista.items.filter((item) =>
    utEgyezik(item.departmentPath, helyszinUt),
  );
  const kerheto = helyszinei.slice(0, RESZLET_HATAR);
  let reszletek = 0;
  let hibas = false;
  for (const sor of kerheto) {
    const detail = await probald(() => deps.jegyReszlet(sor.id));
    if (!detail) {
      hibas = true;
      continue;
    }
    await probald(() => deps.jegyReszletMentese(detail));
    reszletek += 1;
  }

  /*
    A SZERVER VAGASA KULON OK: a jegylista ketszaz sornal vagodik, es errol a
    valasz `truncated` mezoje szol. Ezen a szerelo nem tud segiteni, tehat mas
    mondatot kap, mint egy elhasalt sor.
  */
  if (lista.truncated)
    return {
      resz: "hibajegyek",
      allapot: "reszleges",
      darab: reszletek,
      ok: "vagott",
    };
  if (hibas || helyszinei.length > RESZLET_HATAR)
    return {
      resz: "hibajegyek",
      allapot: "reszleges",
      darab: reszletek,
      ok: hibas ? "hibas-sor" : "vagott",
    };
  return { resz: "hibajegyek", allapot: "kesz", darab: reszletek };
}

async function munkalapok<Tetel extends Sor, Reszlet>(
  deps: MunkalapFuggosegek<Tetel, Reszlet>,
): Promise<ReszEredmeny> {
  const elso = await probald(() => deps.munkalapLista(1));
  if (!elso) return { resz: "munkalapok", allapot: "elhasalt", darab: 0 };

  const sorok = [...elso.items];
  let hianyzoLap = false;
  for (let oldal = 2; oldal <= elso.pagination.totalPages; oldal += 1) {
    const kovetkezo = await probald(() => deps.munkalapLista(oldal));
    if (!kovetkezo) {
      hianyzoLap = true;
      break;
    }
    sorok.push(...kovetkezo.items);
  }

  const kerheto = sorok.slice(0, RESZLET_HATAR);
  let reszletek = 0;
  let hibas = false;
  for (const sor of kerheto) {
    const detail = await probald(() => deps.munkalapReszlet(sor.id));
    if (!detail) {
      hibas = true;
      continue;
    }
    await probald(() => deps.munkalapMentese(detail));
    reszletek += 1;
  }

  if (hianyzoLap || hibas)
    return {
      resz: "munkalapok",
      allapot: "reszleges",
      darab: reszletek,
      ok: "hibas-sor",
    };
  if (sorok.length > RESZLET_HATAR)
    return {
      resz: "munkalapok",
      allapot: "reszleges",
      darab: reszletek,
      ok: "vagott",
    };
  return { resz: "munkalapok", allapot: "kesz", darab: reszletek };
}
