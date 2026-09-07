import { normalizeBrandName } from "../../brands/brands.repository.js";

/**
 * A MARKA-TORZS BETOLTOJE -- A TERV RESZE, IRAS NELKUL.
 *
 * === MI EZ A FAJL, ES MIERT A REPOBAN ===
 *
 * A bemenet barracuda meresebol SZARMAZTATOTT fajl, es a repoban all
 * (`brand-master/marka-betolto-bemenet-v1.tsv`). Nem az agens mappajabol
 * olvassuk: ez ADAT, ami a VEVO ELE KERULO neveket hatarozza meg, tehat
 * ugyanolyan atnezest erdemel a diffben, mint egy kodvaltozas. A meresi
 * dokumentum (`markatorzs-v1.tsv`) marad a forras, ahonnan ujragenerálhato.
 *
 * === A NEGY JELOLO, ES A NEGYEDIK SZANDEKOSAN MAS ===
 *
 *   (ures)              onallo marka -> letrejon
 *   kanonikus_meretlen  onallo marka -> LETREJON. A marka LETEZESEBEN biztosak
 *                       vagyunk, csak a nev ALAKJABAN nem. Ezt NEM szabad
 *                       osszemosni a masik harommal.
 *   nem_onallo          nem marka (konyvelesi sor) -> semmi
 *   ellenorizendo       a torzs sajat megjegyzese szerint nem biztos, hogy
 *                       marka -> semmi. A kanonikus nev a VEVO ele kerul, es a
 *                       ket tevedes ara nem egyforma: a kihagyas HANGOS (valaki
 *                       keresni fogja), a felvetel NEMA (ot bizonytalan nev all
 *                       a torzsben, nulla termekkel, es senki nem keresi).
 *   ketertelmu_alias    nem marka, hanem TILTO bejegyzes -> a visszatoltes NEM
 *                       rendelhet hozza markat
 */

/**
 * EGY SOR A BEMENETBEN -- ES A v2 OTA EGY SOR EGY ALIAS.
 *
 * MIERT VALTOZOTT: a v1-ben az aliasok VESSZOS listaban alltak egy cellaban, es
 * egy listaban allo EGYEDI ertekhez nem lehet oszlopot kotni. A `ketertelmu`
 * jelzes viszont pont egy ERTEKROL mond valamit, nem a sorrol -- ezert kellett
 * soronkent egy alias.
 *
 * ES EGY UJ ESET, AMI A REGI ALAKBAN NEM LETEZETT: a `kanonikus` mezo lehet
 * URES. Az az ERTEK-SZINTU sor (ma egy van, a `Jebao/Jecod`): nem marka, hanem
 * egy tiltott ertek. Aki feltetelezi, hogy minden sornak van kanonikusa, az itt
 * elhasal -- vagy ami rosszabb, letrehoz egy URES NEVU markat.
 */
export interface BrandMasterRow {
  /** URES, ha a sor ERTEK-szintu (tiltott ertek, nem marka). */
  kanonikus: string;
  alias: string;
  /** `igen`, ha ez az ERTEK ketertelmu. */
  ketertelmu: string;
  forras: string;
  jelolo: string;
  /**
   * A DONTESI TABLAT SZOLGALJA, A BETOLTOT NEM.
   *
   * Beolvassuk, hogy a fajl alakja teljesen le legyen irva, de VISELKEDEST NEM
   * epitunk ra: azt a kerdest szolgalja, hogy melyik nev melyik marka
   * termekvonala lehet, es az ember ele megy. A betolto amugy is kihagyja a
   * `nem_onallo` sorokat, ahol ez az adat all.
   */
  feltetelesSzulo: string;
  megjegyzes: string;
}

/** A jelolok, amik NEM eredmenyeznek marka-rekordot. */
const NEM_KELETKEZIK = new Set(["nem_onallo", "ellenorizendo"]);
/** Ez sem marka, de MAS: tiltast eredmenyez a visszatoltesnel. */
export const TILTO_JELOLO = "ketertelmu_ertek";

/**
 * A FAJL ERTELMEZESE, ES AZ OSZLOPSZAM SZIGORU.
 *
 * A FEJLEC NEVEIRE NEM ELLENORZUNK, es ez tudatos: a SORREND es az OSZLOPSZAM
 * az, ami szamit. Merve 2026-09-07: a fajl otodik oszlopa egy ideig `jeleoles`
 * alakban allt (egy `e`-vel tobb) -- az adat vegig helyes volt, csak a nev nem.
 * Egy nev-alapu ellenorzes ilyenkor elhasalna azon, ami nem szamit. (A nevet
 * azota javitottak; a szabaly ettol fuggetlenul all.)
 *
 * MERVE a mai fajlon: 126 adatsor, MIND pontosan otoszlopos (a forras-torzsben
 * 80 volt otos es 45 hatos). Egy elcsuszott oszlop csendben az aliasok helyere
 * tenne a forrast, ezert az eltero sor NEM figyelmeztetes, hanem hiba.
 */
export function parseBrandMaster(text: string): {
  rows: BrandMasterRow[];
  errors: string[];
} {
  const rows: BrandMasterRow[] = [];
  const errors: string[] = [];
  let fejlecMegvolt = false;

  text.split("\n").forEach((sor, index) => {
    const nyers = sor.replace(/\r$/, "");
    if (!nyers.trim() || nyers.startsWith("#")) return;
    const mezok = nyers.split("\t");
    if (mezok.length !== 7) {
      errors.push(
        `${index + 1}. sor: ${mezok.length} oszlop, de hetet várunk ` +
          `(kanonikus, alias, ketertelmu, forras, jeloles, felteteles_szulo, ` +
          `megjegyzes)`,
      );
      return;
    }
    if (!fejlecMegvolt && mezok[0] === "kanonikus") {
      fejlecMegvolt = true;
      return;
    }
    const sorObj: BrandMasterRow = {
      kanonikus: mezok[0]!.trim(),
      alias: mezok[1]!.trim(),
      ketertelmu: mezok[2]!.trim(),
      forras: mezok[3]!.trim(),
      jelolo: mezok[4]!.trim(),
      feltetelesSzulo: mezok[5]!.trim(),
      megjegyzes: mezok[6]!.trim(),
    };
    /**
     * URES KANONIKUS CSAK TILTO SORNAL FOGADHATO EL.
     *
     * Enelkul egy elgepelt sor CSENDBEN tiltott ertekke valna -- vagy ami
     * rosszabb, egy ures nevu markava. A tiltas nem lehet elgepeles
     * mellekterméke.
     */
    if (!sorObj.kanonikus && sorObj.jelolo !== TILTO_JELOLO) {
      errors.push(
        `${index + 1}. sor: üres kanonikus név, de a jelölő nem ` +
          `${TILTO_JELOLO} (hanem "${sorObj.jelolo}")`,
      );
      return;
    }
    rows.push(sorObj);
  });

  if (!fejlecMegvolt) errors.push("A fejléc sor hiányzik.");
  return { rows, errors };
}

export interface BrandMasterPlan {
  /**
   * Aliasok, amiket a NORMALIZALAS azonosnak lat, ezert csak az elso megy at.
   *
   * Nem hiba, es nem is elhallgatando: a bemenet SZANDEKOSAN sorolja fel a
   * `REDSEA` es a `RedSea` alakot is, mert a nyers ertek barmelyik lehet. A
   * tarolo viszont a normalizalt alakra tart egyedi megkotest, tehat ketto
   * kozuluk egy sor.
   */
  mergedAliases: { name: string; normalized: string; dropped: string[] }[];

  /** Amit letre kell hozni: kanonikus nev plusz a sajat aliasai. */
  create: {
    name: string;
    aliases: string[];
    forras: string;
    jelolo: string;
  }[];
  /** Ami MAR all az adatbazisban -- egy masodik futasban ez lesz minden sor. */
  alreadyThere: string[];
  /** Amit szandekosan nem hozunk letre, jelolovel egyutt. */
  skipped: { name: string; jelolo: string }[];
  /** A visszatoltes szamara tiltott ERTEKEK (nyers alak). */
  blockedValues: string[];
  /**
   * Marka, aminek a sorai KULONBOZO jelolot visznek. Ma URES, es ha valaha nem
   * az, az a BEMENET hibaja -- ilyenkor nem talalgatunk, hanem kihagyjuk es
   * megnevezzuk.
   */
  mixedMarkers: { name: string; jelolok: string[] }[];
}

/**
 * A TERV. Nem ir: bemenet a sorok es a MA letezo markak normalizalt kulcsai.
 *
 * A MASODIK FUTAS SZOTLAN: ami mar all (kanonikus nev VAGY alias szerint), az a
 * `alreadyThere` listaba kerul, es nem lesz belole `create`. Ha ez nem allna,
 * nem betolto lenne, hanem egyszer hasznalhato parancs.
 */
export function planBrandMaster(
  rows: readonly BrandMasterRow[],
  existingKeys: readonly string[],
): BrandMasterPlan {
  const megvan = new Set(existingKeys);
  const plan: BrandMasterPlan = {
    create: [],
    alreadyThere: [],
    skipped: [],
    blockedValues: [],
    mixedMarkers: [],
    mergedAliases: [],
  };

  /**
   * A SOROKAT KANONIKUS SZERINT CSOPORTOSITJUK -- egy marka TOBB soron all.
   *
   * A jelolo es a forras a marka elso sorabol jon; merve a v2-n: nincs olyan
   * marka, aminek a sorai KULONBOZO jelolot vinnenek, tehat itt ma nincs mit
   * eldonteni. Ha valaha lenne, az a bemenet hibaja, es a betoltes ELOTT kell
   * kiderulnie -- ezert all ra kulon ellenorzes.
   */
  const csoport = new Map<
    string,
    { name: string; aliases: string[]; forras: string; jelolok: Set<string> }
  >();

  for (const row of rows) {
    if (row.jelolo === TILTO_JELOLO || !row.kanonikus) {
      /** A tiltott ERTEK az ALIAS oszlopban all, nem a kanonikusban. */
      plan.blockedValues.push(row.alias);
      continue;
    }
    const eddigi = csoport.get(row.kanonikus);
    if (eddigi) {
      if (row.alias) eddigi.aliases.push(row.alias);
      eddigi.jelolok.add(row.jelolo);
    } else {
      csoport.set(row.kanonikus, {
        name: row.kanonikus,
        aliases: row.alias ? [row.alias] : [],
        forras: row.forras,
        jelolok: new Set([row.jelolo]),
      });
    }
  }

  for (const marka of csoport.values()) {
    const jelolo = [...marka.jelolok][0] ?? "";
    if (marka.jelolok.size > 1) {
      plan.mixedMarkers.push({
        name: marka.name,
        jelolok: [...marka.jelolok].sort(),
      });
      continue;
    }
    if (NEM_KELETKEZIK.has(jelolo)) {
      plan.skipped.push({ name: marka.name, jelolo });
      continue;
    }
    if (megvan.has(normalizeBrandName(marka.name))) {
      plan.alreadyThere.push(marka.name);
      continue;
    }
    /**
     * AZ ALIASOKAT A TAROLO NORMALIZALOJAVAL VONJUK OSSZE, MIELOTT ATADJUK.
     *
     * === A MERT BUKAS, AMI EZT KIKENYSZERITETTE ===
     *
     * A teszt gepen az iras `P2002`-vel elhasalt a `normalizedAlias` mezon, es
     * RESZLEGES allapotot hagyott (18 marka es 3 alias letrejott, aztan meghalt
     * -- a letrehozas nem egy tranzakcio).
     *
     * Elso gyanunk a teszt gep szennyezett allapota volt: ott 48 marka MAR allt
     * a nyers ertekekbol. Nem az: a bemeneten belul, TISZTA adatbazison is OT
     * marka bukna el ugyanigy. Merve a `brands.repository` sajat
     * normalizalojaval: Aqua Light (`aqualight` ketszer), Ecotech Marine
     * (`ecotech`), Red Sea (`redsea`), Rowa (`rowa phos`), Two Little Fishies
     * (`two little`).
     *
     * === MIERT NEM LATSZOTT A BEMENET ELLENORZESEKOR ===
     *
     * A bemenetet keszito meres MASIK normalizalot hasznalt: az elvalasztojelet
     * TORLI, a tarolo viszont SZOKOZRE csereli. `Red Sea` -> `redsea` az egyik
     * szerint, `red sea` a masik szerint. Az elso alak mellett a `RedSea` alias
     * a marka SAJAT nevevel esik egybe -- a tarolo az ilyet kiszuri --, a
     * masodik mellett viszont ket kulonbozo aliasnak latszik, es utkozik.
     * Ugyanaz a ket sor, ket ellentetes eredmennyel; a kulonbseg nem az adatban
     * van, hanem abban, ki nezi.
     *
     * === MIERT ITT, ES NEM A TAROLOBAN ===
     *
     * A tarolo `create` metodusa kozos ut, minden marka-letrehozas rajta megy.
     * Ott egy csendes osszevonas MASOKTOL is elvenne az utkozes-jelzest. Itt
     * viszont a bemenet ismert tulajdonsagarol van szo, es a terv KI IS IRJA,
     * melyik alakot hagyta el -- tehat nem tunik el.
     */
    const latott = new Map<string, string>();
    const megtartott: string[] = [];
    const eldobott: { normalized: string; dropped: string[] }[] = [];
    for (const alias of marka.aliases) {
      const kulcs = normalizeBrandName(alias);
      const elso = latott.get(kulcs);
      if (elso === undefined) {
        latott.set(kulcs, alias);
        megtartott.push(alias);
        continue;
      }
      const meglevo = eldobott.find((e) => e.normalized === kulcs);
      if (meglevo) meglevo.dropped.push(alias);
      else eldobott.push({ normalized: kulcs, dropped: [alias] });
    }
    for (const e of eldobott)
      plan.mergedAliases.push({
        name: marka.name,
        normalized: e.normalized,
        dropped: e.dropped,
      });
    marka.aliases = megtartott;

    plan.create.push({
      name: marka.name,
      aliases: marka.aliases,
      forras: marka.forras,
      jelolo,
    });
  }
  return plan;
}

export function describeBrandMasterPlan(plan: BrandMasterPlan): string {
  const sorok = [
    `Létrehozandó márka-rekord: ${plan.create.length}`,
    `Már áll, érintetlen: ${plan.alreadyThere.length}`,
    `Kihagyva (nem márka vagy ellenőrizendő): ${plan.skipped.length}`,
    `Tiltó bejegyzés (a visszatöltés nem rendelhet hozzá): ${plan.blockedValues.length}`,
    `Ellentmondó jelölésű márka (kihagyva): ${plan.mixedMarkers.length}`,
    `Összevont alias (a normalizálás azonosnak látja): ${plan.mergedAliases.length}`,
  ];

  if (plan.mixedMarkers.length) {
    sorok.push("", "ELLENTMONDÓ JELÖLÉS, ezért kimaradt:");
    for (const m of plan.mixedMarkers)
      sorok.push(`  ${m.name} -- ${m.jelolok.join(", ")}`);
  }

  if (plan.skipped.length) {
    sorok.push("", "Kihagyva, és MIÉRT:");
    for (const s of plan.skipped) sorok.push(`  ${s.name} -- ${s.jelolo}`);
  }
  if (plan.mergedAliases.length) {
    sorok.push(
      "",
      "ÖSSZEVONT ALIASOK -- a tároló a normalizált alakra tart egyedi megkötést,",
      "ezért a csoportból az ELSŐ írásmód megy át, a többi kimarad:",
    );
    for (const m of plan.mergedAliases)
      sorok.push(
        `  ${m.name} -- "${m.normalized}": kimaradt ${m.dropped
          .map((d) => `"${d}"`)
          .join(", ")}`,
      );
  }
  if (plan.blockedValues.length) {
    sorok.push("", "Tiltott értékek (a visszatöltés ezekre NEM ír márkát):");
    for (const v of plan.blockedValues) sorok.push(`  ${v}`);
  }

  /**
   * A FORRAS ATVITELE NEM DISZ, ES A SZAM ITT ALL, hogy lassa, aki a lapot
   * olvassa: ma 126 sorbol 9 all gyartoi forrason. Ha ez nem kerul at a
   * rekordba, holnap mind egyformán biztosnak latszik.
   */
  const forrasok = new Map<string, number>();
  for (const c of plan.create)
    forrasok.set(c.forras, (forrasok.get(c.forras) ?? 0) + 1);
  if (forrasok.size) {
    sorok.push("", "A létrehozandók FORRÁSA (ez a rekordba is átmegy):");
    for (const [forras, db] of [...forrasok.entries()].sort(
      (a, b) => b[1] - a[1],
    ))
      sorok.push(`  ${forras} -- ${db}`);
  }

  sorok.push(
    "",
    "AMIT EZ A SZÁM NEM MOND MEG: hogy a kanonikus ÍRÁSMÓD helyes-e. A forrás " +
      "oszlop mondja meg, melyik név állt gyártói bizonyítékon és melyik csak " +
      "a mezőből vagy a termék nevéből -- ezért megy át a rekordba.",
    "Ez a parancs CSAK a márka-törzset írja: terméket nem érint.",
  );
  return sorok.join("\n") + "\n";
}
