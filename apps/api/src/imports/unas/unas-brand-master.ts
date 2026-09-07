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
   * ALIAS, AMIT NEM LEHET FELVINNI, MERT EGY MASIK MARKA NEVE.
   *
   * A tarolo `addAlias` metodusa ezt `IDENTITY_CONFLICT`-tel utasitja el, es
   * helyesen: egy normalizalt kulcs nem lehet egyszerre az egyik marka NEVE es
   * a masik ALIASA -- onnantol a visszatoltes nem tudna eldonteni, melyikhez
   * tartozik. Itt nem eroltetjuk, hanem megnevezzuk.
   */
  aliasBlocked: { brandName: string; alias: string; ownedBy: string }[];
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
  /** normalizalt NEV -> a marka. Az alias-tiltas ebbol dol el. */
  const nevHez = new Map<string, ExistingBrandRecord>();
  for (const marka of existing) {
    kulcsHez.set(marka.normalizedName, marka);
    nevHez.set(marka.normalizedName, marka);
    lazaHoz.set(separatorlessKey(marka.name), marka);
    for (const alias of marka.normalizedAliases) kulcsHez.set(alias, marka);
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
    aliasBlocked: [],
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
     * KET SZINTU ILLESZTES, ES A MASODIK CSAK FELISMER.
     *
     * pontos    a tarolo sajat kulcsa (nev vagy alias) -- ez az AZONOSSAG
     * laza      elvalasztojel nelkul -- ez csak GYANU, es jelentest szul
     */
    const pontos = kulcsHez.get(nevKulcs);
    const laza = pontos ?? lazaHoz.get(separatorlessKey(marka.name));

    if (laza) {
      plan.alreadyThere.push(marka.name);
      if (!pontos)
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
      const jeloltek = pontos ? marka.aliases : [marka.name, ...marka.aliases];
      const potlando: string[] = [];
      for (const alias of jeloltek) {
        const kulcs = normalizeBrandName(alias);
        if (marVan.has(kulcs)) continue;
        marVan.add(kulcs);
        const masike = nevHez.get(kulcs);
        if (masike && masike.id !== laza.id) {
          plan.aliasBlocked.push({
            brandName: laza.name,
            alias,
            ownedBy: masike.name,
          });
          continue;
        }
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
    `Alias, ami egy másik márka neve (nem vihető fel): ${plan.aliasBlocked.length}`,
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
  if (plan.aliasBlocked.length) {
    sorok.push(
      "",
      "NEM VIHETŐ FEL, mert egy MÁSIK márka neve (a tároló elutasítaná):",
    );
    for (const b of plan.aliasBlocked)
      sorok.push(
        `  ${b.brandName} <- "${b.alias}" (ez ma "${b.ownedBy}" neve)`,
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
