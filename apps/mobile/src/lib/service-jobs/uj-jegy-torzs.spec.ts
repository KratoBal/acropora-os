import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  eszkozNelkuliMuveletAzonosito,
  ujJegyTorzse,
  type UjJegyAllapot,
} from "./uj-jegy-torzs";

const ALAP: UjJegyAllapot = {
  cim: "Szivattyú zúg",
  leiras: "",
  originAssetId: null,
  customerId: null,
  departmentId: null,
  userId: "user-1",
  openedAt: "2026-09-18T18:00:00.000Z",
};

const torzs = (reszlet: Partial<UjJegyAllapot> = {}) =>
  ujJegyTorzse({ ...ALAP, ...reszlet });

describe("mi megy fel egy új hibajegyből", () => {
  it("gép mellől az originAssetId megy, partner és helyszín NEM", () => {
    const eredmeny = torzs({
      originAssetId: "asset-1",
      customerId: "cust-1",
      departmentId: "dept-1",
    });

    assert.equal(eredmeny.ok, true);
    if (!eredmeny.ok) return;
    assert.deepEqual(eredmeny.payload, {
      title: "Szivattyú zúg",
      originAssetId: "asset-1",
    });
  });

  /**
   * A MÁSIK IRÁNY, ÉS ENÉLKÜL AZ ELŐZŐ ÁLLÍTÁS NEM BIZONYÍT SEMMIT: egy olyan
   * változat, ami SOHA nem küld partnert, az első teszten is átmenne.
   */
  it("gép nélkül a megadott partner és helyszín megy fel", () => {
    const eredmeny = torzs({ customerId: "cust-1", departmentId: "dept-1" });

    assert.equal(eredmeny.ok, true);
    if (!eredmeny.ok) return;
    assert.deepEqual(eredmeny.payload, {
      title: "Szivattyú zúg",
      customerId: "cust-1",
      departmentId: "dept-1",
    });
  });

  it("gép nélkül, partner nélkül is felvihető: csak a cím kötelező", () => {
    const eredmeny = torzs();

    assert.equal(eredmeny.ok, true);
    if (!eredmeny.ok) return;
    assert.deepEqual(eredmeny.payload, { title: "Szivattyú zúg" });
  });

  it("üres cím esetén nem küldünk semmit", () => {
    assert.deepEqual(torzs({ cim: "   " }), {
      ok: false,
      hiba: "A jegy címe kötelező.",
    });
  });

  /**
   * A SZERVER UGYANEZT ŐRZI, ÉS UGYANEZZEL A MONDATTAL. Itt azért áll, hogy a
   * szerelő a helyszínen NE egy szerver-hibából tudja meg, mit hagyott ki.
   */
  it("helyszín partner nélkül: a küldés előtt megáll", () => {
    assert.deepEqual(torzs({ departmentId: "dept-1" }), {
      ok: false,
      hiba: "Helyszínt csak partnerrel együtt lehet megadni.",
    });
  });

  it("a leírás csak akkor kerül bele, ha van", () => {
    const ures = torzs();
    const teli = torzs({ leiras: "  hangos  " });

    assert.equal(ures.ok && "description" in ures.payload, false);
    assert.equal(teli.ok && teli.payload.description, "hangos");
  });

  /**
   * A MŰVELET-AZONOSÍTÓ KÉT ALAKJA SOHA NEM ESHET EGYBE, és a gép nélküli
   * alakban a FELHASZNALO adja azt, amit addig a gép: két szerelő ugyanabban az
   * ezredmásodpercben különben ugyanazt a kulcsot küldené, és a szerver
   * globális idempotencia-kulcsa a másodiknak AZ ELSŐ jegyét adná vissza.
   */
  it("a gép nélküli azonosító a felhasználót is hordozza", () => {
    assert.equal(
      eszkozNelkuliMuveletAzonosito({
        userId: "user-1",
        openedAt: "2026-09-18T18:00:00.000Z",
      }),
      "service-job:nincs-eszkoz:user-1:2026-09-18T18:00:00.000Z",
    );
  });

  it("két szerelő ugyanabban a pillanatban KÜLÖN kulcsot kap", () => {
    const egyik = torzs({ userId: "user-1" });
    const masik = torzs({ userId: "user-2" });

    assert.equal(
      egyik.ok && masik.ok && egyik.operationId !== masik.operationId,
      true,
    );
  });

  it("ugyanaz a szerelő, ugyanaz a pillanat: UGYANAZ a kulcs", () => {
    const egyszer = torzs();
    const ketszer = torzs();

    assert.equal(
      egyszer.ok && ketszer.ok && egyszer.operationId === ketszer.operationId,
      true,
    );
  });

  /**
   * A SZERVER MINTÁJA: `^[A-Za-z0-9_.:-]{8,128}$`. A kulcs alakja ezen belül
   * kell maradjon, különben a felvitel a validáción bukik el -- és a szerelő
   * egy érvényes bejelentésre kapna hibát.
   */
  it("mindkét kulcs-alak megfelel a szerver mintájának", () => {
    const minta = /^[A-Za-z0-9_.:-]{8,128}$/;
    const gepes = torzs({ originAssetId: "asset-1" });
    const gepNelkul = torzs();

    assert.match(gepes.ok ? gepes.operationId : "", minta);
    assert.match(gepNelkul.ok ? gepNelkul.operationId : "", minta);
  });
});
