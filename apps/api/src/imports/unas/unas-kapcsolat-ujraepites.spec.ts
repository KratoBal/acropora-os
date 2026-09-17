import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  meglevoKulcs,
  runKapcsolatUjraepitesCli,
  type UjraepitesDeps,
  type UjraepitesFutas,
  type UjraepitesJelolt,
} from "./unas-kapcsolat-ujraepites.cli.js";

/**
 * A KAPCSOLAT-UJRAEPITES -- FIXTURE-ON MERVE, ADATBAZIS NELKUL.
 *
 * A parancs torzse semmit nem tud a Prismarol: a harom varrat (jeloltek,
 * terkep, iras) kivulrol jon. Ezert lehet ITT bizonyitani azt, amit a stage-en
 * NEM lehetne: hogy `--apply` nelkul egyetlen iras sem tortenik. A stage-en ma
 * a celhalmaz majdnem ures, tehat egy "nulla sort irnek" kiiras akkor is
 * helyesnek latszana, ha a terv-ag maga hibas.
 */
function jelolt(
  externalId: string,
  hivatkozottIdk: readonly string[],
  fajta: "SimilarProducts" | "AdditionalProducts" = "SimilarProducts",
): UjraepitesJelolt {
  const elem =
    fajta === "SimilarProducts" ? "SimilarProduct" : "AdditionalProduct";
  return {
    productId: `p-${externalId}`,
    externalId,
    rawPayload: {
      [fajta]: {
        [elem]: hivatkozottIdk.map((id) => ({ Id: id, Sku: `SKU-${id}` })),
      },
    },
  };
}

function deps(
  jeloltek: UjraepitesJelolt[],
  terkepbol: readonly string[],
  /** A MAR MEGLEVO sorok: `${productId}|${fajta}` -> darab. */
  meglevo: Record<string, number> = {},
): {
  deps: UjraepitesDeps;
  irasok: unknown[];
  /** A rogzitett futas-sorok. Ures lista is allitas: akkor NEM jegyeztunk fel. */
  futasok: UjraepitesFutas[];
} {
  const irasok: unknown[] = [];
  const futasok: UjraepitesFutas[] = [];
  return {
    irasok,
    futasok,
    deps: {
      rogzit: async (sor) => {
        futasok.push(sor);
      },
      jeloltek: async () => jeloltek,
      terkep: async () =>
        new Map(terkepbol.map((externalId) => [externalId, `p-${externalId}`])),
      meglevoKapcsolatok: async () => new Map(Object.entries(meglevo)),
      ir: async (input) => {
        irasok.push(input);
        /*
          A TOROLT SZAM A MEGLEVO TERKEPBOL JON, nem talalomra: igy a teszt azt
          meri, amit a valodi iras is adna vissza -- a torolt sorok szamat, nem
          a celokét.
        */
        return {
          torolt:
            meglevo[meglevoKulcs(input.sourceProductId, input.fajta)] ?? 0,
          irt: input.celProductIdk.length,
        };
      },
    },
  };
}

function kimenet() {
  const sorok: string[] = [];
  return {
    sorok,
    out: {
      stdout: (t: string) => sorok.push(t),
      stderr: (t: string) => sorok.push(t),
    },
  };
}

describe("kapcsolat-újraépítés", () => {
  /**
   * A LEGFONTOSABB ALLITAS: TERV MODBAN NINCS IRAS.
   *
   * MI PIROSIT: ha az `--apply` vizsgalata elmarad. Az iras TOROL, mielott
   * ujrair, tehat egy veletlen eles futas nem "semmit nem tesz", hanem ELVISZ
   * meglevo sorokat.
   */
  it("`--apply` nélkül egyetlen írás sem történik", async () => {
    const { deps: d, irasok } = deps([jelolt("1", ["2"])], ["1", "2"]);
    const { out, sorok } = kimenet();

    assert.equal(await runKapcsolatUjraepitesCli([], out, d), 0);

    assert.deepEqual(irasok, []);
    // ES A KIIRAS IS MEGMONDJA: egy nema terv-futas ugyanugy nez ki, mint egy
    // olyan, ami irt.
    assert.match(sorok.join(""), /Nem írtam semmit/);
    /*
      A TERV MEGIS SZAMOL: a "nulla kapcsolat" itt hamis lenne.
      A KET TERMEK-SZAM KULON all a mondatban, es itt EGYEZIK -- ezert
      allitom mind a kettot: egy olyan kiiras, ami csak az egyiket hozza,
      pontosan azt a kulonbseget rejtene el, amiert a mondat atirodott.
    */
    assert.match(
      sorok.join(""),
      /SIMILAR: hivatkozást visel 1 termék, ebből 1 kap kapcsolatot \(1 sor\)/,
    );
  });

  /**
   * POZITIV KONTROLL: `--apply` MELLETT IR, es a celokat adja at.
   *
   * Enelkul a fenti allitas egy olyan parancstol is zold lenne, ami SOHA nem
   * ir -- es akkor a rebuild egyaltalan nem tortenne meg.
   */
  it("kontroll: `--apply` mellett megírja a kapcsolatokat", async () => {
    const { deps: d, irasok } = deps(
      [jelolt("1", ["2", "3"])],
      ["1", "2", "3"],
    );
    const { out } = kimenet();

    assert.equal(await runKapcsolatUjraepitesCli(["--apply"], out, d), 0);

    assert.deepEqual(irasok, [
      {
        sourceProductId: "p-1",
        fajta: "SIMILAR",
        celProductIdk: ["p-2", "p-3"],
      },
    ]);
  });

  /**
   * A KET FAJTA KULON SZAMOL ES KULON IR.
   *
   * 2026-09-08-an a forrasban 13854 kiegeszito kapcsolat allt, az OS-ben nulla,
   * mikozben a hasonlo agon het termek atment: a ket ag KULON tud elromlani.
   */
  it("a kiegészítő ág külön íródik, saját típussal", async () => {
    const { deps: d, irasok } = deps(
      [jelolt("1", ["2"], "AdditionalProducts")],
      ["1", "2"],
    );
    const { out, sorok } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    assert.deepEqual(irasok, [
      { sourceProductId: "p-1", fajta: "ACCESSORY", celProductIdk: ["p-2"] },
    ]);
    // ES A HASONLO AG NULLA: enelkul az allitas nem mondana meg, hogy a
    // kiegeszito ag irt-e, vagy a hasonlo ag irt rossz tipussal.
    assert.match(sorok.join(""), /SIMILAR: hivatkozást visel 0 termék/);
  });

  /**
   * A FELOLDATLAN HIVATKOZAS SZAMOLODIK, ES NEVET IS KAP.
   *
   * Egy szam megmondja, MENNYI veszett el; javitani csak abbol lehet, hogy
   * MELYIK. A minta korlatos, mert egy tizezres felsorolas ugyanaz, mint a
   * nulla: senki nem olvassa el.
   */
  it("a feloldatlan hivatkozást megszámolja és meg is nevezi", async () => {
    const { deps: d, irasok } = deps([jelolt("1", ["2", "999"])], ["1", "2"]);
    const { out, sorok } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    assert.match(sorok.join(""), /feloldatlan 1/);
    assert.match(sorok.join(""), /minta: 1->999 \(SKU-999\)/);
    // AMI FELOLDHATO, AZ ATMEGY: a feloldatlan nem viszi el a tobbit.
    assert.deepEqual(irasok, [
      { sourceProductId: "p-1", fajta: "SIMILAR", celProductIdk: ["p-2"] },
    ]);
  });

  /**
   * AZ ONHIVATKOZAS ES A DUPLIKATUM SZANDEKOS KIHAGYAS, NEM VESZTESEG.
   *
   * Kulon szamolodnak, mert egy kozos "kihagyva" szam a valodi vesztest rejtene
   * el a zajban -- es a jelentes olvasoja a legnagyobb szamot nezne bajnak.
   */
  it("az önhivatkozás és a duplikátum külön számol, nem feloldatlanként", async () => {
    const { deps: d, irasok } = deps(
      [jelolt("1", ["1", "2", "2"])],
      ["1", "2"],
    );
    const { out, sorok } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    const szoveg = sorok.join("");
    assert.match(szoveg, /önhivatkozás 1/);
    assert.match(szoveg, /duplikátum 1/);
    assert.match(szoveg, /feloldatlan 0/);
    assert.deepEqual(irasok, [
      { sourceProductId: "p-1", fajta: "SIMILAR", celProductIdk: ["p-2"] },
    ]);
  });

  /**
   * AMIRE NINCS MEGLEVO SORUNK, AHHOZ NEM NYULUNK: nincs mit torolni.
   *
   * Ez a ket eset kulonbseget meri: ugyanaz a nulla hivatkozas, MEGLEVO sor
   * nelkul es MEGLEVO sorral.
   */
  it("hivatkozás nélkül és meglévő sor nélkül nem hív írást", async () => {
    const { deps: d, irasok } = deps([jelolt("1", [])], ["1"]);
    const { out } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    assert.deepEqual(irasok, []);
  });

  /**
   * A FORRASBOL ELTUNT KAPCSOLAT SORAIT ELTAVOLITJA -- EZ A PARANCS
   * LEGFONTOSABB AGA, ES AZ ELSO VALTOZATBOL HIANYZOTT.
   *
   * A szinkron erre SOHA nem jut el: a diff motor hat mezot vet ossze, es a
   * kapcsolat NINCS koztuk -- egy termek, amiben csak a kapcsolatok valtoztak,
   * UNCHANGED marad. Vagyis ez az EGYETLEN ut, amin egy UNAS-ban torolt
   * kapcsolat nalunk is eltunik.
   */
  it("a forrásból eltűnt kapcsolat sorait eltávolítja", async () => {
    /*
       A MASIK TERMEK SORAI AZERT ALLNAK ITT, hogy a NAGY VALTOZAS hatara ne
       szoljon bele: harom sor eltavolitasa egy harom soros allomanyban szaz
       szazalek, es a parancs -- helyesen -- megallna. Az a hatar kulon
       tesztben all; ez a teszt a TORLEST meri.
     */
    const { deps: d, irasok } = deps([jelolt("1", [])], ["1"], {
      [meglevoKulcs("p-1", "SIMILAR")]: 3,
      [meglevoKulcs("p-9", "SIMILAR")]: 40,
    });
    const { out, sorok } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    assert.deepEqual(irasok, [
      { sourceProductId: "p-1", fajta: "SIMILAR", celProductIdk: [] },
    ]);
    assert.match(sorok.join(""), /eltávolított 3 sor 1 terméken/);
  });

  /**
   * ES A TERV-AG UGYANEZT A SZAMOT MONDJA, IRAS NELKUL.
   *
   * Enelkul a futas legfontosabb hatasa lathatatlan lenne: a terv nem hivja az
   * irast, tehat a szamot a MEGLEVO sorok terkepebol kell vennie.
   */
  it("terv módban megmondja, hány sor tűnne el, és nem ír", async () => {
    const { deps: d, irasok } = deps([jelolt("1", [])], ["1"], {
      [meglevoKulcs("p-1", "SIMILAR")]: 3,
      [meglevoKulcs("p-9", "SIMILAR")]: 40,
    });
    const { out, sorok } = kimenet();

    await runKapcsolatUjraepitesCli([], out, d);

    assert.deepEqual(irasok, []);
    assert.match(sorok.join(""), /eltávolítandó 3 sor 1 terméken/);
  });

  /**
   * AZ OLVASHATATLAN PILLANATKEPEN NEM TORLUNK -- MEG AKKOR SEM, HA VAN SORUNK.
   *
   * A nem-olvashato pillanatkep NEM azt allitja, hogy nincs kapcsolat, hanem
   * hogy nem tudjuk. Torolni belole annyi, mintha egy meretlen allitasra irnank.
   */
  it("olvashatatlan pillanatképnél nem töröl", async () => {
    const { deps: d, irasok } = deps(
      [{ productId: "p-1", externalId: "1", rawPayload: null }],
      ["1"],
      { [meglevoKulcs("p-1", "SIMILAR")]: 3 },
    );
    const { out, sorok } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    assert.deepEqual(irasok, []);
    const szoveg = sorok.join("");
    assert.match(szoveg, /eltávolított 0 sor 0 terméken/);
    // ES KIMONDJA, HOGY VOLT ILYEN: egy nema kihagyas ugyanugy nez ki, mint egy
    // termek, aminek nincs is kapcsolata.
    assert.match(szoveg, /olvashatatlan pillanatkép 1/);
  });

  /**
   * HA VAN HIVATKOZAS, DE EGYIK SEM OLDODIK FEL, NEM TORLUNK -- ES ITT
   * SZANDEKOSAN ELTERUNK A SZINKRONTOL.
   *
   * A szinkron ilyenkor is torol (a torlese a hataron KIVUL all). A feloldatlan
   * hivatkozas a TERKEP hibajanak a jele, nem a forrasenak: egy hibas terkep
   * miatt elvinni a meglevo, helyes sorokat rosszabb tevedes.
   */
  it("csak feloldatlan hivatkozásnál nem töröl, eltérve a szinkrontól", async () => {
    const { deps: d, irasok } = deps([jelolt("1", ["999"])], ["1"], {
      [meglevoKulcs("p-1", "SIMILAR")]: 2,
    });
    const { out, sorok } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    assert.deepEqual(irasok, []);
    const szoveg = sorok.join("");
    assert.match(szoveg, /eltávolított 0 sor/);
    assert.match(szoveg, /csak feloldatlan hivatkozás 1 terméken/);
  });

  /**
   * A NAGY VALTOZAS MEGALLIT -- ES EZ A KAPCSOLO NELKUL NEM KERULHETO MEG.
   *
   * acrobot kikotese (2026-09-17), es az indoka nem elmeleti: egy ISMETLODO
   * futasnal nem lesz ott senki, aki eszreveszi, ha egyszer csak minden
   * kapcsolat eltunik. A ket eset, amit ez szetvalaszt: egy hirtelen nagy
   * valtozas vagy VALODI, vagy egy elromlott pillanatkep-kinyeres jele.
   */
  it("nagy változásnál megáll, és nem ír semmit", async () => {
    const { deps: d, irasok } = deps([jelolt("1", [])], ["1"], {
      [meglevoKulcs("p-1", "SIMILAR")]: 30,
    });
    const { out, sorok } = kimenet();

    // A KILEPESI KOD KULON ERTEK: a 2 nem hiba (az az 1), hanem MEGALLAS.
    assert.equal(await runKapcsolatUjraepitesCli(["--apply"], out, d), 2);
    assert.deepEqual(irasok, []);
    const szoveg = sorok.join("");
    assert.match(szoveg, /MEGÁLLTAM/);
    // ES MEGMONDJA, MIT KELL TENNI ANNAK, AKI SZAMITOTT RA.
    assert.match(szoveg, /--nagy-valtozas-is/);
  });

  /**
   * ES A KAPCSOLOVAL ATMEGY. Enelkul a fenti allitas egy olyan parancstol is
   * zold lenne, ami MINDIG megall -- es akkor az elso eles futas sem indulna el.
   */
  it("kontroll: a kapcsolóval a nagy változás is lefut", async () => {
    const { deps: d, irasok } = deps([jelolt("1", [])], ["1"], {
      [meglevoKulcs("p-1", "SIMILAR")]: 30,
    });
    const { out } = kimenet();

    assert.equal(
      await runKapcsolatUjraepitesCli(
        ["--apply", "--nagy-valtozas-is"],
        out,
        d,
      ),
      0,
    );
    assert.deepEqual(irasok, [
      { sourceProductId: "p-1", fajta: "SIMILAR", celProductIdk: [] },
    ]);
  });

  /**
   * A TERV-AG SOHA NEM ALL MEG A HATARON: ott nincs mit megallitani, es epp az
   * a dolga, hogy MEGMUTASSA a nagy valtozast, mielott barki dontene rola.
   */
  it("terv módban a nagy változás nem megállás, hanem kiírás", async () => {
    const { deps: d, irasok } = deps([jelolt("1", [])], ["1"], {
      [meglevoKulcs("p-1", "SIMILAR")]: 30,
    });
    const { out, sorok } = kimenet();

    assert.equal(await runKapcsolatUjraepitesCli([], out, d), 0);
    assert.deepEqual(irasok, []);
    assert.match(sorok.join(""), /Összesen: 30 sor ma, 0 a futás után/);
  });

  /**
   * A FUTAS SORA MINDEN AGON LETREJON -- ES A MEGALLASON A LEGFONTOSABB.
   *
   * acrobot kikotese (2026-09-17): "az a legerdekesebb futas, amit rogziteni
   * lehet -- es ha epp az nem hagy nyomot, akkor a tabla pont azt nem tudja,
   * amiert megepult". A megallas TENYE es a TERVEZETT szamok kerulnek bele.
   */
  it("a megállt futás is sort ír, a tervezett számokkal", async () => {
    const {
      deps: d,
      irasok,
      futasok,
    } = deps([jelolt("1", [])], ["1"], {
      [meglevoKulcs("p-1", "SIMILAR")]: 30,
    });
    const { out } = kimenet();

    assert.equal(await runKapcsolatUjraepitesCli(["--apply"], out, d), 2);

    assert.deepEqual(irasok, []);
    assert.equal(futasok.length, 1);
    const sor = futasok[0]!;
    assert.equal(sor.stopped, true);
    // AZ `applied` HAMIS: a futas ugyan `--apply`-jal indult, de NEM irt. Egy
    // igaz ertek itt azt allitana, hogy az allomany megvaltozott.
    assert.equal(sor.applied, false);
    assert.equal(sor.rowsBefore, 30);
    assert.equal(sor.rowsPlanned, 0);
  });

  /**
   * A TERV-FUTAS IS SOR, es `applied: false`. Enelkul a tabla csak az irasokrol
   * tudna, es a "mikor neztuk meg utoljara" kerdesre nem lenne valasz.
   */
  it("a terv-futás is sort ír, applied nélkül", async () => {
    const { deps: d, futasok } = deps([jelolt("1", ["2"])], ["1", "2"]);
    const { out } = kimenet();

    await runKapcsolatUjraepitesCli([], out, d);

    assert.equal(futasok.length, 1);
    assert.equal(futasok[0]!.applied, false);
    assert.equal(futasok[0]!.stopped, false);
    assert.equal(futasok[0]!.similarRelationsPlanned, 1);
    // ES AMIT A TAROLO IRT: nulla, mert nem irtunk. A TERV es a MEGIRT kulon
    // mezo, epp azert, hogy a ketto elterese lathato legyen.
    assert.equal(futasok[0]!.similarRelationsWritten, 0);
  });

  /**
   * ES AZ IRO FUTAS SORABAN A TAROLO SZAMAI ALLNAK, nem a terve.
   */
  it("az író futás sorába a tároló számai kerülnek", async () => {
    const { deps: d, futasok } = deps(
      [jelolt("1", ["2", "3"])],
      ["1", "2", "3"],
    );
    const { out } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    assert.equal(futasok.length, 1);
    assert.equal(futasok[0]!.applied, true);
    assert.equal(futasok[0]!.similarRelationsPlanned, 2);
    assert.equal(futasok[0]!.similarRelationsWritten, 2);
  });

  /**
   * A HIBA NEM CSENDES: a parancs 1-gyel ter vissza, es kimondja, mi tortent.
   */
  it("a hibát megnevezi, és nem nulla kóddal tér vissza", async () => {
    const { out, sorok } = kimenet();
    const code = await runKapcsolatUjraepitesCli([], out, {
      jeloltek: async () => {
        throw new Error("a tükör-tábla nem olvasható");
      },
      terkep: async () => new Map(),
      meglevoKapcsolatok: async () => new Map(),
      ir: async () => ({ torolt: 0, irt: 0 }),
      rogzit: async () => {},
    });

    assert.equal(code, 1);
    assert.match(sorok.join(""), /a tükör-tábla nem olvasható/);
  });
});
