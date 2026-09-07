import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import {
  describeBrandMasterPlan,
  parseBrandMaster,
  planBrandMaster,
  type BrandMasterRow,
} from "./unas-brand-master.js";
import {
  planBrandBackfill,
  type BrandBackfillRow,
} from "./unas-brand-backfill.js";
import {
  BRAND_MASTER_PATH,
  normalizeBrandName,
} from "./unas-brand-master.cli.js";

const sor = (
  kanonikus: string,
  alias = "",
  jelolo = "",
  forras = "BRAND",
): BrandMasterRow => ({
  kanonikus,
  alias,
  ketertelmu: "",
  forras,
  jelolo,
  feltetelesSzulo: "",
  megjegyzes: "",
});

describe("a márka-törzs betöltőjének terve", () => {
  it("létrehozza a jelöletlen sort, az aliasaival együtt", () => {
    const plan = planBrandMaster(
      [sor("Aqua Medic", "Aqua Medic"), sor("Aqua Medic", "AquaMedic")],
      [],
    );

    assert.deepEqual(plan.create, [
      {
        name: "Aqua Medic",
        aliases: ["Aqua Medic", "AquaMedic"],
        forras: "BRAND",
        jelolo: "",
      },
    ]);
  });

  /**
   * A NEGYEDIK JELOLO SZANDEKOSAN MAS: a marka LETEZESEBEN biztosak vagyunk,
   * csak a nev ALAKJABAN nem. Ha ezt osszemosnank a masik harommal, egy valodi
   * marka maradna ki -- 19 termekkel.
   */
  it("a kanonikus_meretlen sor LÉTREJÖN, nem esik ki", () => {
    const plan = planBrandMaster(
      [sor("Oase", "OASE", "kanonikus_meretlen")],
      [],
    );

    assert.equal(plan.create.length, 1);
    assert.equal(plan.create[0]!.jelolo, "kanonikus_meretlen");
    assert.deepEqual(plan.skipped, []);
  });

  it("a nem_onallo és az ellenorizendo sorból NEM lesz márka", () => {
    const plan = planBrandMaster(
      [
        sor("biOrb", "biOrb", "nem_onallo"),
        sor("Octo", "Octo", "ellenorizendo"),
      ],
      [],
    );

    assert.deepEqual(plan.create, []);
    assert.deepEqual(
      plan.skipped.map((s) => s.jelolo),
      ["nem_onallo", "ellenorizendo"],
    );
  });

  it("a ketertelmu_alias sorból tiltó bejegyzés lesz, nem márka", () => {
    const plan = planBrandMaster(
      [sor("", "Jebao/Jecod", "ketertelmu_ertek")],
      [],
    );

    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.blockedValues, ["Jebao/Jecod"]);
  });

  /**
   * A MASODIK FUTAS SZOTLAN. Ha ez nem allna, nem betolto lenne, hanem egyszer
   * hasznalhato parancs -- es akkor a neve is hazudna.
   */
  it("ami már áll, azt nem hozza létre újra", () => {
    const plan = planBrandMaster([sor("Triton", "Triton")], [letezo("Triton")]);

    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.alreadyThere, ["Triton"]);
  });

  /**
   * A MAS IRASMOD NEM UJ MARKA, ES NEM IS ATNEVEZES.
   *
   * A tarolo normalizaloja az irasjelet szokozre csereli, tehat az `AquaMedic`
   * es az `Aqua Medic` KET kulonbozo kulcs. Elvalasztojel nelkul viszont
   * ugyanaz -- es ezt a kulcsot KIZAROLAG felismeresre hasznaljuk.
   *
   * A mert eset: a teszt gepen a nyers ertekekbol keletkezett egy `AquaMedic`
   * marka, a torzsben pedig `Aqua Medic` all. Osszevonas nelkul a betolto egy
   * MASODIK markat hozott volna letre ugyanarra a gyartora, es a kettot semmi
   * nem kotne ossze.
   */
  it("más írásmóddal álló márkát FELISMER, de nem nevez át", () => {
    const plan = planBrandMaster(
      [sor("Aqua Medic", "AquaMedic")],
      [letezo("AquaMedic")],
    );

    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.nameDifferences, [
      {
        brandId: "brand-aquamedic",
        existingName: "AquaMedic",
        canonicalName: "Aqua Medic",
      },
    ]);
    // ES A KANONIKUS IRASMOD ALIASKENT MEGY FEL -- ez koti ossze a kettot.
    assert.deepEqual(plan.aliasTopUp, [
      {
        brandId: "brand-aquamedic",
        brandName: "AquaMedic",
        add: ["Aqua Medic"],
      },
    ]);
  });

  /**
   * A MAR MEGLEVO ALIAST NEM VISSZUK FEL MEGEGYSZER. Enelkul a masodik futas
   * `P2002`-vel allna meg -- vagyis a betolto egyszer hasznalhato lenne.
   */
  it("a meglévő aliast nem viszi fel újra", () => {
    const plan = planBrandMaster(
      [sor("Triton", "TRITON"), sor("Triton", "Triton Labs")],
      [letezo("Triton", ["triton"])],
    );

    assert.deepEqual(plan.aliasTopUp, [
      { brandId: "brand-triton", brandName: "Triton", add: ["Triton Labs"] },
    ]);
  });

  /**
   * ES AMI EGY MASIK MARKA NEVE, AZ NEM MEHET FEL ALIASKENT.
   *
   * A korabbi valtozat ezt kulon `aliasBlocked` listakent kezelte. Amint az
   * illesztes az aliasokat is megkerdezi, ez az eset MAGATOL osszevonasi
   * kerdesse valik: a kanonikus ket letezo markahoz vezet (a sajatjahoz es
   * ahhoz, amelyiknek az alias a NEVE). A betolto ilyenkor megall.
   *
   * Ez erosebb, mint a korabbi alak: ott a marka egy resze meg letrejott volna,
   * es csak egy alias maradt volna ki. Egy normalizalt kulcs nem lehet
   * egyszerre az egyik marka NEVE es a masik ALIASA -- onnantol a visszatoltes
   * nem tudna eldonteni, melyikhez tartozik egy nyers ertek.
   */
  it("nem visz fel olyan aliast, ami egy MÁSIK márka neve", () => {
    const plan = planBrandMaster(
      [sor("Triton", "Rowa")],
      [letezo("Triton"), letezo("Rowa")],
    );

    assert.deepEqual(plan.aliasTopUp, []);
    assert.equal(plan.mergeCandidates.length, 1);
    assert.deepEqual(
      plan.mergeCandidates[0]!.brands.map((b) => b.name).sort(),
      ["Rowa", "Triton"],
    );
  });
});

/**
 * AZ ALIAS-OSSZEVONAS, ES MIERT A TERVBEN.
 *
 * A MERT BUKAS: a teszt gepen az iras `P2002`-vel elhasalt a `normalizedAlias`
 * mezon, es RESZLEGES allapotot hagyott -- 18 marka es 3 alias letrejott, aztan
 * meghalt. Elso gyanunk a teszt gep szennyezett allapota volt (48 marka mar allt
 * ott a nyers ertekekbol). Nem az volt: a bemeneten belul, TISZTA adatbazison is
 * ot marka bukna el ugyanigy.
 */
/**
 * Egy MA letezo marka, a tarolo sajat kulcsaival.
 *
 * AZ AZONOSITO KULON PARAMETER, ES EZT EGY MERT HIBA HOZTA ELO: az alapertelmezes
 * a normalizalt nevbol keszul, szokoz nelkul -- az `Aqua Medic` es az `AquaMedic`
 * ott UGYANAZT az azonositot kapja. Egy olyan tesztben, ahol mind a ketto kulon
 * markakent all, a fixture csendben EGY markava vonta ossze oket, es a lelet a
 * kodra tunt.
 */
function letezo(
  name: string,
  normalizedAliases: string[] = [],
  id = "brand-" + normalizeBrandName(name).replace(/ /g, ""),
) {
  return {
    id,
    name,
    normalizedName: normalizeBrandName(name),
    normalizedAliases,
  };
}

describe("a betöltő-terv alias-összevonása", () => {
  const sor = (
    kanonikus: string,
    alias: string,
  ): Parameters<typeof planBrandMaster>[0][number] => ({
    kanonikus,
    alias,
    ketertelmu: "",
    forras: "BRAND",
    jelolo: "",
    feltetelesSzulo: "",
    megjegyzes: "",
  });

  it("két alias, amit a normalizálás azonosnak lát, EGY aliasszá válik", () => {
    const plan = planBrandMaster(
      [sor("Red Sea", "REDSEA"), sor("Red Sea", "RedSea")],
      [],
    );

    assert.equal(plan.create.length, 1);
    assert.deepEqual(plan.create[0]!.aliases, ["REDSEA"]);
    assert.equal(plan.mergedAliases.length, 1);
    assert.equal(plan.mergedAliases[0]!.name, "Red Sea");
    assert.equal(plan.mergedAliases[0]!.normalized, "redsea");
    assert.deepEqual(plan.mergedAliases[0]!.dropped, ["RedSea"]);
  });

  /**
   * AZ ELSO IRASMOD MARAD, ES EZ NEM IZLES KERDESE: a bemenet sorrendje a
   * szerkeszto dontese. Ha az UTOLSO maradna, ugyanaz a fajl mas eredmenyt adna
   * attol, hogy valaki hozzafuzott-e egy sort a vegehez.
   */
  it("az ELSŐ írásmód marad meg, nem az utolsó", () => {
    const plan = planBrandMaster(
      [
        sor("Two Little Fishies", "Two Little"),
        sor("Two Little Fishies", "Two little"),
      ],
      [],
    );

    assert.deepEqual(plan.create[0]!.aliases, ["Two Little"]);
    assert.deepEqual(plan.mergedAliases[0]!.dropped, ["Two little"]);
  });

  /**
   * ES AZ OSSZEVONAS A KIMENETEN IS LATSZIK. Egy csendes osszevonas ugyanaz a
   * fajta, mint egy csendes csonkolas: a szam stimmel, es senki nem tudja, mi
   * maradt ki.
   */
  it("a terv kiírja, melyik írásmód maradt ki", () => {
    const plan = planBrandMaster(
      [sor("Red Sea", "REDSEA"), sor("Red Sea", "RedSea")],
      [],
    );

    const szoveg = describeBrandMasterPlan(plan);
    assert.match(szoveg, /Összevont alias.*: 1/);
    assert.match(szoveg, /Red Sea/);
    assert.match(szoveg, /"RedSea"/);
  });
});

/**
 * A NEV-ELTERES JELENTESE BALAZSNAK KESZUL, ES A SULYA NELKUL NEM DONTHETO EL.
 *
 * acrobot kerese: a termekszam alljon ott, mellette a MERES IDEJE es a FORRAS.
 * Az elso azert, mert egy termekszam a szinkronnal mozog; a masodik azert, mert
 * a teszt gep szama nem az eles szama, es ket lista egymas mellett semmi masban
 * nem kulonbozik.
 */
/**
 * AZ ILLESZTES A TORZS SAJAT ALIASAIT IS MEGKERDEZI.
 *
 * A mert eset: a teszt gepen a nyers ertekekbol keletkezett egy `AquaMedic`
 * marka. A torzsben `Aqua Medic` all kanonikuskent, `AquaMedic` pedig az egyik
 * aliasa. Amig csak a kanonikus nevet neztuk, a ketto nem talalkozott
 * (`aqua medic` kontra `aquamedic`) -- az alias viszont PONTOSAN egyezik.
 */
describe("a betöltő-terv illesztése az aliasokon át", () => {
  const sorral = (kanonikus: string, alias: string) => ({
    kanonikus,
    alias,
    ketertelmu: "",
    forras: "BRAND",
    jelolo: "",
    feltetelesSzulo: "",
    megjegyzes: "",
  });

  it("a törzs ALIASA is felismeri a meglévő márkát", () => {
    const plan = planBrandMaster(
      [sorral("Aqua Medic", "AquaMedic")],
      [letezo("AquaMedic")],
    );

    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.alreadyThere, ["Aqua Medic"]);
  });

  /**
   * ES HA KET KULONBOZO LETEZO MARKAHOZ VEZET, A BETOLTO MEGALL.
   *
   * Ilyenkor a torzs KET meglevo rekordot kotne ossze. Az osszevonas
   * adat-muvelet: termekek mozdulnak at, es a dontes nem a parancse.
   */
  it("két meglévő márkához vezető kanonikust KIHAGY, és megnevezi mindkettőt", () => {
    const plan = planBrandMaster(
      [sorral("Aqua Medic", "AquaMedic"), sorral("Aqua Medic", "Medic Aqua")],
      [
        letezo("Aqua Medic", [], "b-aqua-medic"),
        letezo("AquaMedic", [], "b-aquamedic"),
        letezo("Medic Aqua", [], "b-medic-aqua"),
      ],
    );

    assert.deepEqual(plan.create, []);
    assert.deepEqual(plan.alreadyThere, []);
    assert.equal(plan.mergeCandidates.length, 1);
    assert.equal(plan.mergeCandidates[0]!.canonicalName, "Aqua Medic");
    assert.deepEqual(
      plan.mergeCandidates[0]!.brands.map((b) => b.name).sort(),
      ["Aqua Medic", "AquaMedic", "Medic Aqua"],
    );
  });

  /**
   * A POZITIV KONTROLL: egy alias, ami UGYANARRA a markara mutat, nem
   * osszevonasi eset. Enelkul az orzot az is kielegitene, ha minden
   * tobb-aliasos markat kihagyna.
   */
  it("ugyanahhoz a márkához vezető több alias NEM összevonási eset", () => {
    const plan = planBrandMaster(
      [sorral("Aqua Medic", "AquaMedic"), sorral("Aqua Medic", "Aqua Mdic")],
      [letezo("AquaMedic", ["aqua mdic"])],
    );

    assert.deepEqual(plan.mergeCandidates, []);
    assert.deepEqual(plan.alreadyThere, ["Aqua Medic"]);
  });
});

/**
 * A MEGLEVO ADAT KETERTELMUSEGE -- ES EZ MAJDNEM KIMARADT.
 *
 * A teszt gepen az `aquamedic` EGYSZERRE az "AquaMedic" marka NEVE es az
 * "Aqua Medic" marka ALIASA. Az elso valtozat sima `set` hivasokkal epitette az
 * indexet: az utolso iras felulirta az elozot, a ket marka kozul csak EGY
 * latszott, es az osszevonas-ellenorzes CSENDBEN atengedte pontosan azt az
 * allapotot, amit ki kellett volna szurnie.
 */
describe("a betöltő-terv a meglévő adat kétértelműségét is látja", () => {
  it("egy kulcs KÉT márkánál: megnevezi mindkettőt", () => {
    const plan = planBrandMaster(
      [sor("Aqua Medic", "AquaMedic")],
      [
        letezo("AquaMedic", [], "b-aquamedic"),
        letezo("Aqua Medic", ["aquamedic"], "b-aqua-medic"),
      ],
    );

    assert.equal(plan.existingAmbiguousKeys.length, 1);
    assert.equal(plan.existingAmbiguousKeys[0]!.key, "aquamedic");
    assert.deepEqual(
      plan.existingAmbiguousKeys[0]!.brands.map((b) => b.name).sort(),
      ["Aqua Medic", "AquaMedic"],
    );
  });

  /**
   * A POZITIV KONTROLL: egy marka SAJAT neve es SAJAT aliasa ugyanarra a kulcsra
   * NEM ketertelmu. Enelkul az orzot az is kielegitene, ha mindent megallitana.
   */
  it("egy márka saját neve és aliasa NEM kétértelmű", () => {
    const plan = planBrandMaster(
      [sor("Triton", "Triton")],
      [letezo("Triton", ["triton"])],
    );

    assert.deepEqual(plan.existingAmbiguousKeys, []);
    assert.deepEqual(plan.alreadyThere, ["Triton"]);
  });
});

describe("a név-eltérés jelentése", () => {
  const terv = () =>
    planBrandMaster(
      [
        {
          kanonikus: "Aqua Medic",
          alias: "AquaMedic",
          ketertelmu: "",
          forras: "BRAND",
          jelolo: "",
          feltetelesSzulo: "",
          megjegyzes: "",
        },
      ],
      [letezo("AquaMedic")],
    );

  it("a termékszám, a mérés ideje és a forrás is kiíródik", () => {
    const szoveg = describeBrandMasterPlan(terv(), {
      productCounts: { "brand-aquamedic": 37 },
      at: "2026-09-07T12:00:00.000Z",
      source: "db-teszt:5432/acropora",
    });

    assert.match(szoveg, /37 termék/);
    assert.match(szoveg, /2026-09-07T12:00:00\.000Z/);
    assert.match(szoveg, /db-teszt:5432\/acropora/);
  });

  /**
   * ES A HIANYZO SZAM NEM NULLA.
   *
   * Adatbazis nelkul futtatva a termekszam nem ismert. Ha ilyenkor `0` allna
   * ott, az pont azt a tetelt tuntetne el a dontesbol, amelyik a legolcsobb
   * esetnek latszana -- es a kulonbseget senki nem venne eszre.
   */
  it("mérés nélkül NEM nullát ír, hanem megmondja, hogy nem mért", () => {
    const szoveg = describeBrandMasterPlan(terv());

    assert.match(szoveg, /termékszám: NEM MÉRT/);
    assert.doesNotMatch(szoveg, /0 termék/);
    // ES A LISTA ATTOL MEG OTT ALL: a hianyzo suly nem tunteti el a tetelt.
    assert.match(szoveg, /a táblában "AquaMedic", a törzsben "Aqua Medic"/);
  });
});

describe("a betöltő-bemenet értelmezése", () => {
  const FEJLEC =
    "kanonikus\talias\tketertelmu\tforras\tjeloles\tfelteteles_szulo\tmegjegyzes\n";

  it("a hét oszloptól eltérő sor HIBA, nem figyelmeztetés", () => {
    const { rows, errors } = parseBrandMaster(
      FEJLEC + "Triton\tTriton\t\tBRAND\t\t\t\n" + "Rossz\tsor\tcsak\tnegy\n",
    );

    assert.equal(rows.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /4 oszlop/);
  });

  /**
   * AZ URES KANONIKUS CSAK TILTO SORNAL FOGADHATO EL. Enelkul egy elgepelt sor
   * CSENDBEN tiltott ertekke valna -- a tiltas nem lehet elgepeles
   * mellektermeke.
   */
  it("üres kanonikus név csak tiltó jelölővel fogadható el", () => {
    const jo = parseBrandMaster(
      FEJLEC + "\tJebao/Jecod\tigen\tBRAND\tketertelmu_ertek\t\t\n",
    );
    assert.deepEqual(jo.errors, []);
    assert.equal(jo.rows.length, 1);

    const rossz = parseBrandMaster(FEJLEC + "\tValami\t\tBRAND\t\t\t\n");
    assert.equal(rossz.rows.length, 0);
    assert.match(rossz.errors[0]!, /üres kanonikus/);
  });

  /**
   * A FEJLEC-NEVEK KOZUL EGY SZAMIT, A TOBBI HAT NEM -- ES EZ MOSTANTOL ALLITAS.
   *
   * === MIERT KELL EZ A KET SZELET ===
   *
   * 2026-09-07-en a bemeneti fajl OTODIK oszlopa egy hetig `jeleoles` alakban
   * allt, es amikor atirtuk `jeloles`-re, a kod el sem mozdult. Ezt ugy adtuk
   * tovabb, hogy "a beolvaso nem ellenoriz a fejlec NEVEIRE". A kod olvasasa es
   * ez a ket szelet egyutt pontositja: a MASODIKTOL a hetedikig tenyleg nem
   * szamit a nev, az ELSO viszont igen -- a fejlecet epp arrol ismerjuk fel,
   * hogy az elso mezoje `kanonikus`.
   *
   * A kulonbseg nem szormenszalhasogatas: ha valaki az ELSO oszlopot nevezi at,
   * nem "ismeretlen fejlec" hibat kap, hanem azt, hogy a fejlec HIANYZIK, es a
   * fejlec-sor ADATSORKENT megy at. Ezt jobb allitasban tartani, mint a
   * felfedezesre bizni.
   */
  it("a második és a további oszlopok NEVE nem számít", () => {
    const MAS_NEVEK = "kanonikus\tketto\tharom\tnegy\tjeleoles\that\thet\n";

    const { rows, errors } = parseBrandMaster(
      MAS_NEVEK + "Triton\tTRITON\t\tGYARTO\tnem_onallo\t\tmegj\n",
    );

    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
    // A MEZOK A SORRENDBOL kapjak az ertelmuket, nem a fejlec szavaibol.
    assert.equal(rows[0]!.kanonikus, "Triton");
    assert.equal(rows[0]!.alias, "TRITON");
    assert.equal(rows[0]!.forras, "GYARTO");
    assert.equal(rows[0]!.jelolo, "nem_onallo");
    assert.equal(rows[0]!.megjegyzes, "megj");
  });

  it("az ELSŐ oszlop neve viszont számít: enélkül a fejléc nem fejléc", () => {
    const { rows, errors } = parseBrandMaster(
      "egy\tketto\tharom\tnegy\tot\that\thet\n" +
        "Triton\tTRITON\t\tGYARTO\t\t\t\n",
    );

    assert.match(errors.join(" "), /fejléc sor hiányzik/);
    // ES A FEJLEC-SOR ADATKENT MEGY AT -- ezert lesz ket sor, nem egy.
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.kanonikus, "egy");
  });

  it("a # sorokat és az üres sorokat kihagyja", () => {
    const { rows, errors } = parseBrandMaster(
      "# fejlec-komment\n\n" + FEJLEC + "Triton\tTRITON\t\tGYARTO\t\t\tmegj\n",
    );

    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.alias, "TRITON");
  });
});

/**
 * A REPOBAN ALLO VALODI FAJL, ES AMIT RAJTA ALLITUNK.
 *
 * Ez nem egy kitalált fixture: a parancs EZT a fajlt fogja olvasni. Ha valaki
 * ujragenerálja a torzsbol es kozben elcsuszik egy oszlop, itt derul ki, nem
 * futas kozben.
 */
describe("a repóban álló betöltő-bemenet", () => {
  const { rows, errors } = parseBrandMaster(
    readFileSync(BRAND_MASTER_PATH, "utf8"),
  );

  it("értelmezhető, hibátlan sorokkal", () => {
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 181);
  });

  /**
   * A SZAMOT A v2-BOL SZAMOLTAM UJRA, nem vettem at a v1-bol: 124 kulonbozo
   * kanonikus minusz 9 kihagyando (nem_onallo vagy ellenorizendo) = 115.
   * Ugyanaz a szam, mint a v1-nel -- a szerkezet valtozott, az eredmeny nem.
   */
  it("a terv 115 márkát hozna létre, és 9 márka nem lesz", () => {
    const plan = planBrandMaster(rows, []);

    /**
     * A KOZBULSO SZAM IS ALLITAS, NEM CSAK A VEGEREDMENY: 124 - 9 = 115. Egy
     * puszta 115 akkor is kijohetne, ha a csoportositas mast von ossze, es a
     * kihagyas is maskent szamol -- a ket hiba kiolthatna egymast.
     */
    assert.equal(
      plan.create.length + plan.skipped.length + plan.alreadyThere.length,
      124,
    );
    assert.equal(plan.create.length, 115);
    assert.equal(plan.skipped.length, 9);
    assert.deepEqual(plan.blockedValues, ["Jebao/Jecod"]);
    assert.deepEqual(plan.mixedMarkers, []);
  });

  /**
   * A KET TILTO FORRAS KULON MERHETO -- ES EZ AZ ALLITAS AZ, AMI EZT
   * BIZONYITJA: a `Jebao/Jecod` NINCS a szotar halmazaiban, tehat ha a
   * visszatoltes visszautasitja, azt CSAK a fajl-alapu tiltas okozhatta.
   */
  it("a fájl tiltása önmagában megállítja a visszatöltést", () => {
    const termek: BrandBackfillRow[] = [
      { productId: "p1", brandValue: "Jebao/Jecod", currentBrandId: null },
    ];

    const szotarNelkul = planBrandBackfill(termek, [], []);
    assert.deepEqual(szotarNelkul.refused, []);
    assert.equal(szotarNelkul.createBrands.length, 1);

    const fajllal = planBrandBackfill(termek, [], ["Jebao/Jecod"]);
    assert.equal(fajllal.createBrands.length, 0);
    assert.equal(fajllal.refused.length, 1);
    assert.match(fajllal.refused[0]!.reason, /betöltő-bemenet/);
  });

  it("a terv szövege kiírja a forrás-eloszlást és a mérés határát", () => {
    const szoveg = describeBrandMasterPlan(planBrandMaster(rows, []));

    assert.match(szoveg, /GYARTO/);
    assert.match(szoveg, /AMIT EZ A SZÁM NEM MOND MEG/);
  });
});
