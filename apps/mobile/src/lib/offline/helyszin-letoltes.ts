/**
 * MIT MONDUNK A SZERELONEK, MIUTAN LETOLTOTTE A HELYSZIN ADATAIT.
 *
 * === A KERES (Balazs, 2026-09-21, Discord) ===
 *
 * "nem tudunk az ios es android appba elhelyezni egy olyan gombot, ami letolti
 * a friss adatokat mielott offline lesz a kollega?" -- majd, miutan a "mai
 * munka" egyseget javasoltuk: "nem jo a mai munka. ha pl az a munka, mint
 * most, hogy lemegy a pinceba es eszkozoket aka rogziteni, akkor mielott lemegy
 * minden eszkoz adatlapjat meg kell nyitnia. ez igy hasznalhatatlan".
 *
 * === MIERT KULON, TISZTA MODUL ===
 *
 * A letoltes maga halozat es adatbazis; EZ a resz viszont az, amit el lehet
 * rontani, es amit telefon nelkul is lehet allitani. Ugyanaz a szetvalasztas,
 * mint a `form-cache-prefetch.ts`-ben.
 *
 * === A LEGVESZELYESEBB AG: A RESZLEGES LETOLTES ===
 *
 * A szerelo a pinceben abbol indul ki, hogy MEGVAN MINDEN. Ha otven eszkozbol
 * harminc jott le, es a felulet csak annyit mond, hogy "kesz", akkor a hianyzo
 * huszat ott fogja keresni, ahol nincs -- es addigra nincs terero ahhoz, hogy
 * potolja.
 *
 * EZERT A TELJES ES A HIANYOS LETOLTES KET KULONBOZO MONDATTAL zarul, nem
 * ugyanazzal a mondattal mas szammal. Egy szam kulonbseget at lehet siklani;
 * egy masik elso szot nem.
 */

/** A harom dolog, ami egy helyszinrol lejon. */
export type LetoltesResz =
  "eszkozok" | "fenykepek" | "hibajegyek" | "munkalapok";

const RESZ_NEVE: Record<LetoltesResz, string> = {
  eszkozok: "eszköz",
  /*
    A BELYEGKEP, NEM A "KEP". Balazs merese szerint a legnagyobb kepanyagu
    helyszin TELJES meretben 51 MB, belyegkepben 567 KB -- kilencvenszeres
    kulonbseg. A szo megmondja, MI jott le, hogy senki ne varja a nagy kepet
    tereró nelkul.
  */
  fenykepek: "bélyegkép",
  hibajegyek: "hibajegy",
  munkalapok: "munkalap",
};

export type ReszEredmeny =
  /** Minden lejott, amit a szerver adott. */
  | { resz: LetoltesResz; allapot: "kesz"; darab: number }
  /**
   * LEJOTT VALAMI, DE NEM MINDEN -- es a ket ok KULONBOZO teendot ad.
   *
   * `vagott`: a SZERVER vagta el a listat (a hibajegy-lista ketszaz sornal
   * vagodik, es a valasz `truncated` mezoje errol szol). Ilyenkor a keszuleken
   * levo masolat hianyos, es ezen a szerelo nem tud segiteni.
   *
   * `hibas-sor`: egyes tetelek lekerese hasalt el. A tobbi megvan.
   */
  | {
      resz: LetoltesResz;
      allapot: "reszleges";
      darab: number;
      ok: "vagott" | "hibas-sor";
    }
  /** Egyaltalan nem jott le semmi ebbol a reszbol. */
  | { resz: LetoltesResz; allapot: "elhasalt"; darab: 0 };

export interface LetoltesOsszegzes {
  /** IGAZ, ha MIND A HAROM resz hiany nelkul jott le. */
  teljes: boolean;
  /**
   * AZ ELSO SZO MONDJA MEG, MELYIK ESETROL VAN SZO. Egy szam kulonbseget at
   * lehet siklani, egy masik elso mondatot nem.
   */
  cim: string;
  /** Reszenkent egy sor, ugyanabban a sorrendben, ahogy megkaptuk. */
  sorok: string[];
}

function sor(eredmeny: ReszEredmeny): string {
  const nev = RESZ_NEVE[eredmeny.resz];
  if (eredmeny.allapot === "kesz") return `${eredmeny.darab} ${nev} letöltve.`;
  if (eredmeny.allapot === "elhasalt")
    return `${nev}: egy sem jött le. Ez a rész hiányzik a készülékről.`;
  return eredmeny.ok === "vagott"
    ? `${eredmeny.darab} ${nev} jött le, de a lista ennél hosszabb: a többi NEM került a készülékre.`
    : `${eredmeny.darab} ${nev} jött le, a többi nem sikerült.`;
}

export function osszegezHelyszinLetoltes(input: {
  helyszin: string;
  reszek: readonly ReszEredmeny[];
}): LetoltesOsszegzes {
  /*
    AZ URES LISTA NEM SIKER. Ha a hivo egyetlen reszt sem ad at, akkor nem
    tortent meg a letoltes -- egy "minden kesz" mondat itt pont azt allitana,
    amit a legkevesbe szabad.
  */
  const teljes =
    input.reszek.length > 0 &&
    input.reszek.every((eredmeny) => eredmeny.allapot === "kesz");

  return {
    teljes,
    cim: teljes
      ? `${input.helyszin}: a letöltés kész.`
      : `${input.helyszin}: a letöltés HIÁNYOS.`,
    sorok: input.reszek.map(sor),
  };
}

/**
 * MIT KELL UJRAOLVASNI A LETOLTES UTAN -- ES MIERT NEM ELEG A MENTES.
 *
 * === A MERT HIBA (Balazs, 2026-09-21 13:11:56 UTC, Discord) ===
 *
 * „megvan, de valahogy nem mukodik jol. ha letoltom kiirja hogy hany eszkozt
 * toltott le. aztan repulogep uzemmod de utana minden latszik, de pl androidon
 * meg ott van de ha lehuzassal frissitesz akkor nincs"
 *
 * A LETOLTES JOL IRT. Ugyanazt a tablat tolti fel, amibol a lista olvas, es a
 * `rememberAssets` upsertel, nem cserel.
 *
 * AMI HIANYZOTT: a kepernyok a mentett masolatot SAJAT lekerdezesen keresztul
 * olvassak, es annak a valasza a letoltes utan is a REGI marad. A lista tehat
 * a letoltes elotti allapotot tartja -- es amikor a lehuzas utan visszaesne a
 * masolatra, egy elavult (adott esetben URES) eredmenyt kap.
 *
 * === MIERT LISTA, ES MIERT NEM A KOMPONENSBEN SOROLJUK FEL ===
 *
 * A letolto HAROM FELE adatot ment (eszkoz, hibajegy, munkalap), es mindegyik
 * KET helyen latszik: a listan es az adatlapon. Ot kulcs, egy kepernyon
 * felsorolva -- az OTODIKET felejti el az ember, es a hiba NEMA: a tobbi
 * frissul, tehat a felulet mukodonek latszik.
 *
 * Igy a darabszam merheto, es az allitas megmondja, HANY kulcsot varunk.
 */
export const LETOLTES_UTAN_UJRAOLVASANDO = [
  /** Az eszkoz-lista mentett masolata (`assets/index.tsx`). */
  ["offline-assets"],
  /** Egy eszkoz mentett adatlapja (`assets/[id].tsx`). */
  ["offline-asset"],
  /** A hibajegy-lista mentett masolata (`service-jobs/index.tsx`). */
  ["offline-service-jobs"],
  /** Egy hibajegy mentett adatlapja (`service-jobs/[id].tsx`). */
  ["offline-service-job"],
  /** Egy munkalap mentett adatlapja (`worksheets/[id].tsx`). */
  ["worksheet-cache"],
] as const;
