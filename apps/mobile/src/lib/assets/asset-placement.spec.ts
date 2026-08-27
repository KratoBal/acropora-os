import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetPlacementDetail, assetPlacementLine } from "./asset-placement";

/**
 * A NEM PONTOSÍTOTT ESZKÖZ UGYANÚGY NÉZ KI, MINT A PONTOSÍTOTT -- ez a tét.
 *
 * Szerviz partnernél a cím mindig a partner saját postai címe, tehát alegység
 * nélkül a képernyőn látszó cím nem válasz arra, hogy hol áll az eszköz. Ha ezt
 * nem mondjuk ki, a szerelő elindul egy telephelyre, ahol tíz gép van, és a
 * cím mindegyiknél ugyanaz.
 */

const unit = { code: "BIO", name: "Biodóm", path: ["Fánk", "Biodóm"] };
const address = { formatted: "1146 Budapest, Állatkerti körút 6-12." };

describe("assetPlacementLine", () => {
  it("shows the whole path and the code when the unit is known", () => {
    assert.equal(
      assetPlacementLine({ ownerType: "SUPPLIER", unit, address }),
      "Fánk / Biodóm (BIO)",
    );
  });

  it("says out loud that a partner asset has no unit", () => {
    assert.equal(
      assetPlacementLine({ ownerType: "SUPPLIER", address }),
      "Nincs pontosítva. 1146 Budapest, Állatkerti körút 6-12.",
    );
  });

  it("says it even when there is no address to fall back to", () => {
    assert.equal(
      assetPlacementLine({ ownerType: "SUPPLIER" }),
      "Nincs pontosítva.",
    );
  });

  /**
   * VEVŐNÉL A CÍM A PONTOSÍTÁS, nem visszaesés: ott a cím önmagában válasz.
   */
  it("treats a customer address as the answer, not as a fallback", () => {
    assert.equal(
      assetPlacementLine({ ownerType: "CUSTOMER", address }),
      "1146 Budapest, Állatkerti körút 6-12.",
    );
  });

  it("falls back to the unit name when the path is missing", () => {
    assert.equal(
      assetPlacementLine({
        ownerType: "SUPPLIER",
        unit: { code: "BIO", name: "Biodóm" },
      }),
      "Biodóm (BIO)",
    );
  });
});

describe("assetPlacementDetail", () => {
  /**
   * UGYANAZ A DÖNTÉS, bővebb mondattal: az adatlapon van hely elmondani, MIÉRT
   * látszik ott egy cím.
   */
  it("explains whose address is standing in for the missing unit", () => {
    assert.equal(
      assetPlacementDetail({ ownerType: "SUPPLIER", address }),
      "Nincs pontosítva. A partner címe látszik helyette: 1146 Budapest, Állatkerti körút 6-12.",
    );
  });

  it("agrees with the list line whenever the unit is known", () => {
    const input = { ownerType: "SUPPLIER" as const, unit, address };
    assert.equal(assetPlacementDetail(input), assetPlacementLine(input));
  });
});
