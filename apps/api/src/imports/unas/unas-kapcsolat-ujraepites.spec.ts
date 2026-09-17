import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runKapcsolatUjraepitesCli,
  type UjraepitesDeps,
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
): { deps: UjraepitesDeps; irasok: unknown[] } {
  const irasok: unknown[] = [];
  return {
    irasok,
    deps: {
      jeloltek: async () => jeloltek,
      terkep: async () =>
        new Map(terkepbol.map((externalId) => [externalId, `p-${externalId}`])),
      ir: async (input) => {
        irasok.push(input);
        return input.celProductIdk.length;
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
    // A TERV MEGIS SZAMOL: a "nulla kapcsolat" itt hamis lenne.
    assert.match(sorok.join(""), /SIMILAR: 1 kapcsolat/);
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
    assert.match(sorok.join(""), /SIMILAR: 0 kapcsolat/);
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

  /** A hivatkozas nelkuli termekre nem hivunk irast: nincs mit torolni-ujrairni. */
  it("a hivatkozás nélküli terméket nem írja újra", async () => {
    const { deps: d, irasok } = deps([jelolt("1", [])], ["1"]);
    const { out } = kimenet();

    await runKapcsolatUjraepitesCli(["--apply"], out, d);

    assert.deepEqual(irasok, []);
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
      ir: async () => 0,
    });

    assert.equal(code, 1);
    assert.match(sorok.join(""), /a tükör-tábla nem olvasható/);
  });
});
