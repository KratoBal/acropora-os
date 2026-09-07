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
 * A FEJLEC-NEVEK KOZUL PONTOSAN EGY SZAMIT: AZ ELSO. A masodiktol a hetedikig
 * a nev nem erdekes, mert a mezok a SORRENDBOL kapjak az ertelmuket; a fejlecet
 * viszont epp arrol ismerjuk fel, hogy az elso mezoje `kanonikus`.
 *
 * Merve 2026-09-07: a fajl OTODIK oszlopa egy ideig `jeleoles` alakban allt (egy
 * `e`-vel tobb) -- az adat vegig helyes volt, csak a nev nem, es a javitasa utan
 * a kod el sem mozdult. Egy teljes nev-ellenorzes ettol pirosra valtott volna
 * azon, ami nem szamit.
 *
 * EZT A KET ALLITAST ELOSZOR EGYNEK HITTUK ("a fejlec neveire nem ellenorzunk"),
 * es ez pontatlan volt: az ELSO oszlop atnevezese NEM "ismeretlen fejlec" hibat
 * ad, hanem azt, hogy a fejlec HIANYZIK -- es a fejlec-sor adatsorkent megy at.
 * Mind a ket viselkedest spec orzi, hogy a kovetkezo olvasonak ne a kod olvasasa
 * legyen az egyetlen forras.
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

/**
 * EGY MA LETEZO MARKA, ANNYIVAL, AMENNYI AZ ILLESZTESHEZ KELL.
 *
 * Korabban csak a normalizalt KULCSOK listajat kaptuk. Az eleg volt annak
 * eldontesehez, hogy egy kanonikus nev mar all-e -- ahhoz viszont nem, hogy
 * MELYIK markarol van szo, es MI hianyzik rola.
 */
export interface ExistingBrandRecord {
  id: string;
  name: string;
  normalizedName: string;
  normalizedAliases: string[];
}

/**
 * AZ ELVALASZTOJEL NELKULI KULCS -- KIZAROLAG FELISMERESRE, SOHA AZONOSITASRA.
 *
 * A tarolo normalizaloja az irasjelet SZOKOZRE csereli (`Red Sea` -> `red sea`),
 * ezert az `AquaMedic` es az `Aqua Medic` KET KULONBOZO kulcs. Ez az azonossag
 * szempontjabol helyes: a tarolo nem allithatja, hogy a ketto ugyanaz.
 *
 * A FELISMERESHEZ viszont pont ez a kulonbseg kell. Enelkul a betolto egy MASODIK
 * markat hozna letre ugyanarra a gyartora, es a kettot semmi nem kotne ossze.
 *
 * A KET HASZNALAT KOZTI HATAR: ezzel a kulccsal SOHA nem irunk ossze ket sort
 * automatikusan. Csak annyit mondunk, hogy GYANUS, es a dontes emberre marad.
 */
function separatorlessKey(value: string): string {
  return normalizeBrandName(value).replace(/ /g, "");
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

  /**
   * MAR LETEZO MARKA, AMIRE A TORZS ALIASAI MEG HIANYOZNAK.
   *
   * A betolto ilyenkor NEM nevez at es NEM hoz letre masodik markat: csak
   * potolja a hianyzo aliasokat. Az indok nem szimmetria, hanem az, melyik
   * tevedes marad rejtve. Egy elmaradt alias-potlas NEMA: a lekepezes nem epul
   * fel, es a kovetkezo szinkron ugyanugy nem talal ra a markara. Egy tevesen
   * atnevezett marka viszont HANGOS: latszik a listan, es visszaallithato.
   */
  aliasTopUp: { brandId: string; brandName: string; add: string[] }[];

  /**
   * LETEZO MARKA, AMI UGYANAZ A GYARTO, DE MAS IRASMODDAL ALL A TABLABAN.
   *
   * Peldaul `AquaMedic` kontra `Aqua Medic`. Az atnevezes NEM a betolto dolga:
   * a vevo azt latja, tehat Balazs donti el. A betolto annyit tesz, hogy a
   * letezo markara felviszi a torzs aliasait (koztuk a kanonikus irasmodot is),
   * igy a lekepezes felepul anelkul, hogy barmit atneveznenk.
   */
  nameDifferences: {
    brandId: string;
    existingName: string;
    canonicalName: string;
  }[];

  /**
   * EGY KANONIKUS, AMI TOBB LETEZO MARKAHOZ VEZET.
   *
   * A torzs ilyenkor KET MEGLEVO markat kotne ossze -- peldaul mert az egyik a
   * kanonikus nevet viseli, a masik az egyik aliasat. Ket marka osszevonasa
   * adat-muvelet: termekek mozdulnak at, es a dontes nem a betoltoe.
   *
   * A betolto ezert nem valaszt kozuluk es nem is hoz letre harmadikat: megall
   * ennel a markanal, es megnevezi mind a kettot.
   */
  mergeCandidates: {
    canonicalName: string;
    brands: { id: string; name: string }[];
  }[];

  /**
   * A MAR MEGLEVO ADATBAN allo ketertelmu kulcs: egy normalizalt alak KET
   * markahoz tartozik (az egyiknek a NEVE, a masiknak az ALIASA).
   *
   * Ez nem a torzs terve, hanem a jelen allapot leirasa -- es amig all, minden
   * alias-potlas talalgatas. A parancs ilyenkor meg tervet sem ad.
   */
  existingAmbiguousKeys: {
    key: string;
    brands: { id: string; name: string }[];
  }[];
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
  existing: readonly ExistingBrandRecord[],
): BrandMasterPlan {
  /** normalizalt kulcs (nev VAGY alias) -> a marka, amelyik viseli. */
  const kulcsHez = new Map<string, ExistingBrandRecord>();
  /** elvalasztojel nelkuli kulcs -> a marka. CSAK felismeresre. */
  const lazaHoz = new Map<string, ExistingBrandRecord>();
  /**
   * AZ INDEX EPITESE KOZBEN FIGYELJUK, HOGY EGY KULCSOT KET MARKA VISEL-E.
   *
   * === A MERT ALLAPOT, ES AZ, HOGY EZ MAJDNEM KIMARADT ===
   *
   * A teszt gepen az `aquamedic` EGYSZERRE az "AquaMedic" marka NEVE es az
   * "Aqua Medic" marka ALIASA. Az elso valtozat sima `set` hivasokkal epitette
   * az indexet -- az utolso iras felulirta az elozot, es a ket marka kozul csak
   * EGY latszott. Az osszevonas-ellenorzes ezert egyetlen talalatot latott, es
   * CSENDBEN atengedte pontosan azt az allapotot, amit ki kellett volna szurnie.
   *
   * Ugyanaz a hiba, mint a visszatolto indexeben -- ott mar orzo all rajta.
   *
   * === MIERT AZ EGESZ FUTAST ALLITJA MEG ===
   *
   * Egy ilyen kulcs mellett barmelyik alias-potlas talalgatas: nem tudjuk, melyik
   * markarol van szo. A feloldas ket marka osszevonasa vagy egy alias levetele --
   * mind a ketto adat-muvelet, es egyik sem a betoltoe.
   */
  const kulcsUtkozok = new Map<string, Map<string, ExistingBrandRecord>>();
  const felvesz = (kulcs: string, marka: ExistingBrandRecord) => {
    const eddigi = kulcsHez.get(kulcs);
    if (eddigi && eddigi.id !== marka.id) {
      const halmaz =
        kulcsUtkozok.get(kulcs) ??
        new Map<string, ExistingBrandRecord>([[eddigi.id, eddigi]]);
      halmaz.set(marka.id, marka);
      kulcsUtkozok.set(kulcs, halmaz);
      return;
    }
    kulcsHez.set(kulcs, marka);
  };
  for (const marka of existing) {
    felvesz(marka.normalizedName, marka);
    lazaHoz.set(separatorlessKey(marka.name), marka);
    for (const alias of marka.normalizedAliases) felvesz(alias, marka);
  }

  const plan: BrandMasterPlan = {
    create: [],
    alreadyThere: [],
    skipped: [],
    blockedValues: [],
    mixedMarkers: [],
    mergedAliases: [],
    aliasTopUp: [],
    nameDifferences: [],
    mergeCandidates: [],
    existingAmbiguousKeys: [...kulcsUtkozok.entries()].map(([key, markak]) => ({
      key,
      brands: [...markak.values()].map((b) => ({ id: b.id, name: b.name })),
    })),
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
    /**
     * AZ ALIASOKAT ELOSZOR OSSZEVONJUK, ES CSAK AZUTAN DONTUNK.
     *
     * Korabban ez a lepes a `create` agon belul allt, tehat a MAR LETEZO
     * markakra nem futott le. Amikor a betolto elkezdte potolni a hianyzo
     * aliasokat, ugyanaz a `P2002` jott volna vissza, csak masik uton.
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

    const nevKulcs = normalizeBrandName(marka.name);
    /**
     * AZ ILLESZTES A KANONIKUS NEVET ES AZ OSSZES ALIAST IS NEZI.
     *
     * === A MERT ESET, AMIT A KORABBI ALAK NEM FOGOTT MEG ===
     *
     * A teszt gepen a nyers ertekekbol keletkezett egy `AquaMedic` nevu marka.
     * A torzsben `Aqua Medic` all kanonikusként, es `AquaMedic` az egyik
     * ALIASA. Amig csak a kanonikus nevet neztuk, a ketto nem talalkozott
     * (`aqua medic` kontra `aquamedic`), es a betolto egy MASODIK markat hozott
     * volna letre ugyanarra a gyartora.
     *
     * Az alias viszont PONTOSAN egyezik a letezo marka nevevel. Vagyis a
     * felismereshez nem kell heurisztika: eleg a torzs sajat aliasait is
     * megkerdezni.
     *
     * === HAROM ESET, ES A HARMADIK MEGALLIT ===
     *
     * nulla talalat  -> uj marka (vagy a laza kulcs meg felismerheti)
     * egy talalat    -> ugyanaz a marka: aliasokat potolunk, nevet nem
     * TOBB talalat   -> a torzs KET letezo markat kotne ossze. Ezt nem oldjuk
     *                   fel magunktol: ket marka osszevonasa adat-muvelet.
     */
    const jeloltKulcsok = [
      nevKulcs,
      ...marka.aliases.map((a) => normalizeBrandName(a)),
    ];
    const talaltak = new Map<string, ExistingBrandRecord>();
    for (const kulcs of jeloltKulcsok) {
      const talalat = kulcsHez.get(kulcs);
      if (talalat) talaltak.set(talalat.id, talalat);
    }
    if (talaltak.size > 1) {
      plan.mergeCandidates.push({
        canonicalName: marka.name,
        brands: [...talaltak.values()].map((b) => ({ id: b.id, name: b.name })),
      });
      continue;
    }
    const pontos = [...talaltak.values()][0];
    const laza = pontos ?? lazaHoz.get(separatorlessKey(marka.name));

    if (laza) {
      plan.alreadyThere.push(marka.name);
      /**
       * A NEV-ELTERES ATTOL FUGG, HOGY MAS-E A NEV -- NEM AZ ILLESZTES MODJATOL.
       *
       * Az elso valtozat akkor jelentett, ha CSAK a laza kulcs talalt. Amint az
       * illesztes az aliasokat is megkerdezte, az `AquaMedic` eset PONTOS
       * talalatta valt -- es a jelentesbol epp az a tetel esett ki, amiert az
       * egesz lista keszult.
       */
      if (laza.name !== marka.name)
        plan.nameDifferences.push({
          brandId: laza.id,
          existingName: laza.name,
          canonicalName: marka.name,
        });

      /**
       * A POTLANDO ALIASOK. A kanonikus irasmod IS koztuk van, ha a letezo
       * marka mas alakban all -- epp ez koti ossze a kettot atnevezes nelkul.
       */
      const marVan = new Set([laza.normalizedName, ...laza.normalizedAliases]);
      /**
       * A KANONIKUS NEV MINDIG A JELOLTEK KOZOTT VAN.
       *
       * Az elso valtozat csak akkor vette be, ha az illesztes LAZA volt --
       * abbol a feltevesbol, hogy pontos talalatnal a kanonikus nev MAGA
       * egyezett. Amint az illesztes az aliasokat is megkerdezi, ez nem all: a
       * talalat johet egy ALIASBOL is, es akkor epp a kanonikus irasmod
       * hianyzik a markarol. Ha mar ott van, a `marVan` szures ugyis kiveszi.
       */
      const jeloltek = [marka.name, ...marka.aliases];
      const potlando: string[] = [];
      for (const alias of jeloltek) {
        const kulcs = normalizeBrandName(alias);
        if (marVan.has(kulcs)) continue;
        marVan.add(kulcs);
        potlando.push(alias);
      }
      if (potlando.length)
        plan.aliasTopUp.push({
          brandId: laza.id,
          brandName: laza.name,
          add: potlando,
        });
      continue;
    }

    plan.create.push({
      name: marka.name,
      aliases: marka.aliases,
      forras: marka.forras,
      jelolo,
    });
  }
  return plan;
}

/**
 * A TERMEKSZAM ES A MERES KORULMENYEI.
 *
 * A tervet tiszta fuggveny allitja elo, a termekszam viszont az ADATBAZISBOL jon.
 * Ezert nem a tervben lakik, hanem itt adjuk hozza -- igy a terv tesztelheto
 * marad adatbazis nelkul, a jelentes pedig teljes lesz ott, ahol adatbazis van.
 *
 * A KET KISERO ADAT NEM DISZ:
 *
 *   `at`      egy termekszam a szinkronnal MOZOG. Datum nelkul a lista holnap
 *             ugyanolyan magabiztosan hazudik, mint ma igazat mond.
 *   `source`  a teszt gep szama NEM az eles szama, es a ket listat egymas melle
 *             teve semmi nem kulonbozteti meg oket.
 */
export interface BrandMasterReportContext {
  productCounts: Record<string, number>;
  at: string;
  source: string;
}

export function describeBrandMasterPlan(
  plan: BrandMasterPlan,
  meres?: BrandMasterReportContext,
): string {
  const sorok = [
    `Létrehozandó márka-rekord: ${plan.create.length}`,
    `Már áll, érintetlen: ${plan.alreadyThere.length}`,
    `Kihagyva (nem márka vagy ellenőrizendő): ${plan.skipped.length}`,
    `Tiltó bejegyzés (a visszatöltés nem rendelhet hozzá): ${plan.blockedValues.length}`,
    `Ellentmondó jelölésű márka (kihagyva): ${plan.mixedMarkers.length}`,
    `Összevont alias (a normalizálás azonosnak látja): ${plan.mergedAliases.length}`,
    `Meglévő márka, amire alias kerül: ${plan.aliasTopUp.length}`,
    `Meglévő márka MÁS írásmóddal (döntést kér): ${plan.nameDifferences.length}`,
    `Két meglévő márkához vezet (kihagyva, ÖSSZEVONÁS kérdése): ${plan.mergeCandidates.length}`,
    `MEGLÉVŐ kétértelmű kulcs (a futás nem indulhat): ${plan.existingAmbiguousKeys.length}`,
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
  /**
   * A NEV-ELTERESEK LISTAJA BALAZSNAK KESZUL, ezert a KET irasmod egymas mellett
   * all. Az atnevezes az o dontese: a vevo azt latja. A betolto addig sem
   * tehetetlen -- a kanonikus irasmodot ALIASKENT viszi fel, tehat a lekepezes
   * felepul anelkul, hogy barmit atneveznenk.
   */
  if (plan.nameDifferences.length) {
    sorok.push(
      "",
      "MÁS ÍRÁSMÓD, UGYANAZ A GYÁRTÓ -- az átnevezés DÖNTÉS, nem betöltés:",
    );
    if (meres)
      sorok.push(`  (termékszám mérve: ${meres.at}, forrás: ${meres.source})`);
    for (const n of plan.nameDifferences) {
      const db = meres?.productCounts[n.brandId];
      /**
       * A HIANYZO SZAM NEM NULLA, ES NEM IS SZABAD ANNAK LATSZANIA.
       *
       * Ha a parancs adatbazis nelkul fut, a termekszam nem ismert. Egy ures
       * hely vagy egy `0` ugyanugy nezne ki, mint egy valodi nulla -- es epp
       * azt a tetelt tuntetne el a dontesbol, amelyik a legolcsobb eset lenne.
       */
      const suly =
        db === undefined ? " -- termékszám: NEM MÉRT" : ` -- ${db} termék`;
      sorok.push(
        `  a táblában "${n.existingName}", a törzsben "${n.canonicalName}"${suly}`,
      );
    }
  }

  if (plan.aliasTopUp.length) {
    sorok.push("", "MEGLÉVŐ MÁRKÁRA FELVITT ALIASOK (átnevezés nélkül):");
    for (const t of plan.aliasTopUp)
      sorok.push(
        `  ${t.brandName} <- ${t.add.map((a) => `"${a}"`).join(", ")}`,
      );
  }

  /**
   * EZ A LISTA NEM HIBA, HANEM HATAR: egy normalizalt kulcs nem lehet egyszerre
   * az egyik marka NEVE es a masik ALIASA. Ha eroltetnenk, a visszatoltes nem
   * tudna eldonteni, melyikhez tartozik egy nyers ertek.
   */
  /**
   * AZ OSSZEVONAS NEM BETOLTES. Ez a lista azt mondja meg, hol all ma ket
   * marka-rekord ugyanarra a gyartora -- a feloldas termekeket mozgat, tehat
   * ember donti el, nem a parancs.
   */
  if (plan.mergeCandidates.length) {
    sorok.push(
      "",
      "KÉT MEGLÉVŐ MÁRKÁHOZ VEZET -- a betöltő kihagyta, ÖSSZEVONÁS kérdése:",
    );
    for (const m of plan.mergeCandidates)
      sorok.push(
        `  "${m.canonicalName}" -> ` +
          m.brands.map((b) => `"${b.name}"`).join(" és "),
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
