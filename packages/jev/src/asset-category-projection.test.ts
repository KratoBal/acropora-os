import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASSET_CATEGORY_SCHEMA,
  projectAssetCategory,
  stripAssetNamePrefix,
} from "./asset-category-projection.js";
import { cph1Canonical } from "./cph1.js";

/**
 * AZ ELOTAG-SZABALY (#1199 CH-002, P-004; acrobot eles merese 2026-09-28).
 * A pelda-nevek az eles adat alakjai: `CAP/NMD`, `BIO/LSS07`, `AKV/FRE/A19`,
 * `CAP ` szegmens nelkul, es a nagybetus, de NEM helyszin-kod elso szo
 * (`UV`, `GHL`).
 */
describe("a helyszín-előtag levágása", () => {
  it("többszintű részleg-útvonal: a teljes útvonal megy le", () => {
    assert.deepEqual(
      stripAssetNamePrefix("AKV/CRE/A05 Lámpa II.", ["AKV", "CRE", "A05"]),
      { name: "Lámpa II.", rule: "department" },
    );
  });

  /*
    A NEVBEN CSAK AZ UTVONAL VEGE ALL: `AKV/A11` a `FAN/AKV/A11` utvonalbol. A
    leghosszabb vegszelet megy elobb; ha forditva lenne, az `A11` egyezes nem
    illeszkedne (a nev `AKV/`-vel kezdodik), de egy `AKV` csonkot hagyhatna.
  */
  it("végszelet: a név csak az útvonal végét hordozza", () => {
    assert.deepEqual(
      stripAssetNamePrefix("AKV/A11 Homokszűrő", ["FAN", "AKV", "A11"]),
      { name: "Homokszűrő", rule: "department" },
    );
  });

  it("egyszegmensű útvonal, szegmens nélküli kód", () => {
    assert.deepEqual(stripAssetNamePrefix("CAP RO szűrő", ["CAP"]), {
      name: "RO szűrő",
      rule: "department",
    });
  });

  it("a kód csak szóhatáron egyezik: az A11 nem vágja le az A110-et", () => {
    assert.deepEqual(stripAssetNamePrefix("A110 Szivattyú", ["A11"]), {
      name: "A110 Szivattyú",
      rule: "none",
    });
  });

  it("tartalék minta, ha az útvonal nem egyezik: több szegmens és a CAP", () => {
    assert.deepEqual(stripAssetNamePrefix("AKV/FRE/A19 Lámpa VI.", ["X"]), {
      name: "Lámpa VI.",
      rule: "pattern",
    });
    assert.deepEqual(stripAssetNamePrefix("BIO/LSS07 Keringető", []), {
      name: "Keringető",
      rule: "pattern",
    });
    assert.deepEqual(stripAssetNamePrefix("CAP RO szűrő", []), {
      name: "RO szűrő",
      rule: "pattern",
    });
  });

  /** A NAGYBETUS ELSO SZO MAGABAN NEM ELOTAG: technika vagy gyarto. */
  it("az UV és a GHL marad, és az előtag nélküli név is", () => {
    for (const nev of [
      "UV sterilizáló 55W",
      "GHL Profilux 4",
      "Homokszűrő szivattyú",
    ])
      assert.deepEqual(stripAssetNamePrefix(nev, ["BIO", "LSS07"]), {
        name: nev,
        rule: "none",
      });
  });
});

describe("az eszköz-kategória vetülete", () => {
  it("a teljes vetület: előtag és sorszám nélküli név, snake_case kulcsok, decimális stringek", () => {
    const { projection, prefixRule } = projectAssetCategory({
      name: "AKV/FRE/A19 Lámpa VI.",
      manufacturer: " Kessil ",
      model: "A360X",
      kind: "EQUIPMENT",
      performance: "90.000000",
      performanceUnit: "watt",
      powerConsumption: "0.090000",
      parentCategory: "Világítás",
      departmentPath: ["AKV", "FRE", "A19"],
    });
    assert.equal(prefixRule, "department");
    assert.equal(
      cph1Canonical(projection),
      `{"data":{"kind":"EQUIPMENT","manufacturer":"Kessil","model":"A360X","name":"Lámpa","performance":"90","performance_unit":"watt","power_consumption":"0.09","resze_ennek":"Ez az eszköz egy nagyobb egység ALKATRÉSZE; a befoglaló egység kategóriája: Világítás. A kérdés az ALKATRÉSZ saját kategóriája."},"schema":"${ASSET_CATEGORY_SCHEMA}"}`,
    );
  });

  it("az üres és hiányzó mező kimarad, nem null", () => {
    const { projection } = projectAssetCategory({
      name: "Szivattyú",
      manufacturer: "   ",
      model: null,
      performance: null,
    });
    assert.deepEqual(projection.data, { name: "Szivattyú" });
  });

  /**
   * A KIZART MEZOK NEM KERULHETNEK BE -- A TIPUS NEM IS ENGEDI, DE A FUTASI
   * ALLITAS A TIPUS KERULESET IS MERI: egy `as`-sel atadott teljes eszkozsor
   * (description, gyari szam, leltari szam, partnerkod, function) sem szivarog.
   */
  it("a kizárt mezők akkor sem kerülnek be, ha a bemenet hordozza őket", () => {
    const teljesSor = {
      name: "BIO/LSS07 Szivattyú",
      description: "A II. emeleti kezelőben, Kovács úr szerint zajos",
      serialNumber: "SN-123",
      partnerInternalCode: "FANK-0042",
      inventoryNumber: "LT-9",
      electricalCode: "E-7",
      notes: "megjegyzés",
      function: "Keringetés",
      departmentPath: ["BIO", "LSS07"],
    };
    const { projection } = projectAssetCategory(teljesSor as never);
    assert.deepEqual(Object.keys(projection.data), ["name"]);
    assert.doesNotMatch(
      cph1Canonical(projection),
      /LSS07|Kovács|SN-123|FANK|LT-9|E-7|Keringetés/,
    );
  });

  it("a csak előtagból álló név üres, tehát kimarad", () => {
    const { projection } = projectAssetCategory({
      name: "CAP/NMD ",
      departmentPath: ["CAP", "NMD"],
    });
    assert.deepEqual(projection.data, {});
  });

  /**
   * @2 (2026-09-28): A SZULO KATEGORIAJA MAGYARAZO MONDATBAN MEGY, NEM NYERS
   * MEZOKENT. A nyers `parent_category` mellett acrobot eles futasan a modell a
   * 67 hibabol 53-szor a szulo kategoriajat valasztotta. A mondat betu szerint
   * a mert B valtozat: ha atirodik, a mert szam mar nem ra vonatkozik.
   */
  it("a szülő kategóriája a mért magyarázó mondatban áll, parent_category nincs", () => {
    const { projection } = projectAssetCategory({
      name: "Homokszűrő II. motoros szelep",
      parentCategory: "Nyomástartó tartályok",
    });
    assert.equal(projection.schema, "service-assets.asset-category@2");
    assert.deepEqual(Object.keys(projection.data).sort(), [
      "name",
      "resze_ennek",
    ]);
    assert.equal(
      projection.data.resze_ennek,
      "Ez az eszköz egy nagyobb egység ALKATRÉSZE; a befoglaló egység kategóriája: Nyomástartó tartályok. A kérdés az ALKATRÉSZ saját kategóriája.",
    );
    assert.doesNotMatch(cph1Canonical(projection), /parent_category/);
  });

  it("szülő nélkül nincs resze_ennek mező", () => {
    const { projection } = projectAssetCategory({
      name: "Szivattyú",
      parentCategory: " ",
    });
    assert.deepEqual(projection.data, { name: "Szivattyú" });
  });
});
