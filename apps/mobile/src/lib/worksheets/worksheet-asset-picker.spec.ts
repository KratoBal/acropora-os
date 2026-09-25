import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  keresesNullaTalalatUzenet,
  lathatoReszlet,
  partitionEszkozokAValasztohoz,
  type KereshetoEszkoz,
} from "./worksheet-asset-picker";

function eszkoz(
  bemenet: Partial<KereshetoEszkoz> & { id: string },
): KereshetoEszkoz {
  return {
    name: "",
    assetNumber: "",
    ...bemenet,
  };
}

describe("partitionEszkozokAValasztohoz", () => {
  const a = eszkoz({ id: "a", name: "Szivattyú", assetNumber: "SZ-001" });
  const b = eszkoz({
    id: "b",
    name: "Homokszűrő",
    assetNumber: "HSZ-002",
    partnerInternalCode: "FANK-7",
  });
  const c = eszkoz({ id: "c", name: "UV lámpa", assetNumber: "UV-003" });

  it("üres keresésnél minden kijelöletlen tétel a találatok között van", () => {
    const eredmeny = partitionEszkozokAValasztohoz({
      osszes: [a, b, c],
      kivalasztottIdk: [],
      kereses: "",
    });
    assert.deepEqual(eredmeny.kivalasztottak, []);
    assert.deepEqual(eredmeny.kijeloletlenTalalatok, [a, b, c]);
  });

  it("a kijelölt tétel a kivalasztottak közé kerül, nem a találatok közé", () => {
    const eredmeny = partitionEszkozokAValasztohoz({
      osszes: [a, b, c],
      kivalasztottIdk: ["b"],
      kereses: "",
    });
    assert.deepEqual(eredmeny.kivalasztottak, [b]);
    assert.deepEqual(eredmeny.kijeloletlenTalalatok, [a, c]);
  });

  /**
   * A LEGFONTOSABB ÁLLÍTÁS: egy kijelölt tétel AKKOR IS a kivalasztottak
   * között marad, ha a keresés szövege rá NEM illeszkedik. Enélkül a
   * szerelő elveszítené a saját választása visszaigazolását, amint
   * elkezdene keresni valami mást.
   */
  it("a kijelölt tétel a keresésre nem illeszkedve is megmarad", () => {
    const eredmeny = partitionEszkozokAValasztohoz({
      osszes: [a, b, c],
      kivalasztottIdk: ["a"],
      kereses: "uv",
    });
    assert.deepEqual(eredmeny.kivalasztottak, [a]);
    assert.deepEqual(eredmeny.kijeloletlenTalalatok, [c]);
  });

  it("a keresés a névre, az azonosítóra és a partner kódra is illeszkedik", () => {
    assert.deepEqual(
      partitionEszkozokAValasztohoz({
        osszes: [a, b, c],
        kivalasztottIdk: [],
        kereses: "homok",
      }).kijeloletlenTalalatok,
      [b],
    );
    assert.deepEqual(
      partitionEszkozokAValasztohoz({
        osszes: [a, b, c],
        kivalasztottIdk: [],
        kereses: "uv-003",
      }).kijeloletlenTalalatok,
      [c],
    );
    assert.deepEqual(
      partitionEszkozokAValasztohoz({
        osszes: [a, b, c],
        kivalasztottIdk: [],
        kereses: "fank-7",
      }).kijeloletlenTalalatok,
      [b],
    );
  });

  it("a keresés kis- és nagybetűtől függetlenül illeszkedik", () => {
    assert.deepEqual(
      partitionEszkozokAValasztohoz({
        osszes: [a, b, c],
        kivalasztottIdk: [],
        kereses: "SZIVATTYÚ",
      }).kijeloletlenTalalatok,
      [a],
    );
  });

  it("a hiányzó partner kód nem dob hibát a keresésnél", () => {
    assert.deepEqual(
      partitionEszkozokAValasztohoz({
        osszes: [a],
        kivalasztottIdk: [],
        kereses: "fank",
      }).kijeloletlenTalalatok,
      [],
    );
  });

  it("megőrzi a bemeneti sorrendet mindkét csoportban", () => {
    const eredmeny = partitionEszkozokAValasztohoz({
      osszes: [c, a, b],
      kivalasztottIdk: ["a"],
      kereses: "",
    });
    assert.deepEqual(eredmeny.kijeloletlenTalalatok, [c, b]);
  });
});

describe("lathatoReszlet", () => {
  const lista = [1, 2, 3, 4, 5];

  it("a limit alatti listát egyben mutatja, rejtett szám nélkül", () => {
    const eredmeny = lathatoReszlet(lista, 10, false);
    assert.deepEqual(eredmeny.lathato, lista);
    assert.equal(eredmeny.rejtettSzam, 0);
  });

  it("a limit feletti listát levágja, és megmondja, mennyi maradt ki", () => {
    const eredmeny = lathatoReszlet(lista, 3, false);
    assert.deepEqual(eredmeny.lathato, [1, 2, 3]);
    assert.equal(eredmeny.rejtettSzam, 2);
  });

  it("mindetMutat esetén a teljes lista látszik, akkor is, ha hosszabb a limitnél", () => {
    const eredmeny = lathatoReszlet(lista, 3, true);
    assert.deepEqual(eredmeny.lathato, lista);
    assert.equal(eredmeny.rejtettSzam, 0);
  });

  it("nem módosítja az eredeti listát", () => {
    const eredeti = [1, 2, 3];
    lathatoReszlet(eredeti, 1, false);
    assert.deepEqual(eredeti, [1, 2, 3]);
  });
});

describe("keresesNullaTalalatUzenet", () => {
  it("nem szól, ha a helyszínen nincs is eszköz (azt a describeSelectableAssets mondja)", () => {
    assert.equal(
      keresesNullaTalalatUzenet({
        vanEszkozAHelyszinen: false,
        kereses: "bármi",
        kivalasztottakSzama: 0,
        kijeloletlenTalalatokSzama: 0,
      }),
      null,
    );
  });

  it("nem szól, ha a keresés mezője üres", () => {
    assert.equal(
      keresesNullaTalalatUzenet({
        vanEszkozAHelyszinen: true,
        kereses: "   ",
        kivalasztottakSzama: 0,
        kijeloletlenTalalatokSzama: 0,
      }),
      null,
    );
  });

  it("nem szól, ha van kijelölt tétel, még ha a találatok üresek is", () => {
    assert.equal(
      keresesNullaTalalatUzenet({
        vanEszkozAHelyszinen: true,
        kereses: "xyz",
        kivalasztottakSzama: 1,
        kijeloletlenTalalatokSzama: 0,
      }),
      null,
    );
  });

  it("nem szól, ha van kijelöletlen találat", () => {
    assert.equal(
      keresesNullaTalalatUzenet({
        vanEszkozAHelyszinen: true,
        kereses: "xyz",
        kivalasztottakSzama: 0,
        kijeloletlenTalalatokSzama: 1,
      }),
      null,
    );
  });

  it("szól, ha van eszköz a helyszínen, van keresés, és semmi nem talált", () => {
    const mondat = keresesNullaTalalatUzenet({
      vanEszkozAHelyszinen: true,
      kereses: "xyz",
      kivalasztottakSzama: 0,
      kijeloletlenTalalatokSzama: 0,
    });
    assert.match(mondat ?? "", /nincs találat/);
  });
});
