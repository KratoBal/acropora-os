import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetEditFormFrom,
  buildAssetPatch,
  assetLabelEditProblem,
  baseValuesFor,
  hasAssetChanges,
  type EditableAsset,
} from "./asset-edit";

const asset: EditableAsset = {
  updatedAt: "2026-08-18T20:00:00.000Z",
  // Szerviz partner eszkoze, helyszin nelkul: igy az alegyseg-ag LEFUT a
  // meglevo eseteknel is, es lathato, hogy valtozas nelkul nem kuld semmit.
  ownerType: "SUPPLIER",
  status: "ACTIVE",
  criticality: "NORMAL",
  manufacturer: "Eheim",
  model: "2078",
  serialNumber: "SN-1",
  inventoryNumber: undefined,
  description: undefined,
  notes: "Halk.",
};

describe("assetEditFormFrom", () => {
  it("turns absent values into empty fields, not into the word undefined", () => {
    const form = assetEditFormFrom(asset);
    assert.equal(form.inventoryNumber, "");
    assert.equal(form.description, "");
    assert.equal(form.manufacturer, "Eheim");
    assert.equal(form.status, "ACTIVE");
  });
});

describe("buildAssetPatch", () => {
  it("sends nothing but the guard when nothing changed", () => {
    const patch = buildAssetPatch(asset, assetEditFormFrom(asset));
    assert.deepEqual(patch, { expectedUpdatedAt: asset.updatedAt });
  });

  it("always carries the timestamp the server checks against", () => {
    // Without it the server cannot tell a fresh edit from one that was
    // written on top of somebody else's work.
    const form = { ...assetEditFormFrom(asset), model: "2080" };
    assert.equal(
      buildAssetPatch(asset, form).expectedUpdatedAt,
      "2026-08-18T20:00:00.000Z",
    );
  });

  it("sends only the field that changed", () => {
    const form = { ...assetEditFormFrom(asset), model: "2080" };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      model: "2080",
    });
  });

  it("clears an emptied field with null rather than an empty string", () => {
    const form = { ...assetEditFormFrom(asset), notes: "" };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      notes: null,
    });
  });

  it("does not treat added whitespace as a change", () => {
    const form = { ...assetEditFormFrom(asset), manufacturer: "  Eheim  " };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
    });
  });

  it("trims what it does send", () => {
    const form = { ...assetEditFormFrom(asset), serialNumber: "  SN-2  " };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      serialNumber: "SN-2",
    });
  });

  it("leaves an already-empty field alone instead of clearing it again", () => {
    // `description` was absent to begin with. Sending `null` for it would
    // be a write nobody asked for, and a write is what loses a conflict.
    const form = { ...assetEditFormFrom(asset), description: "   " };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
    });
  });

  it("carries a changed status and criticality", () => {
    const form = {
      ...assetEditFormFrom(asset),
      status: "IN_REPAIR" as const,
      criticality: "HIGH" as const,
    };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      status: "IN_REPAIR",
      criticality: "HIGH",
    });
  });

  it("sends several changes at once", () => {
    const form = {
      ...assetEditFormFrom(asset),
      model: "2080",
      notes: "Cserélt tömítés.",
      status: "OUT_OF_SERVICE" as const,
    };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      model: "2080",
      notes: "Cserélt tömítés.",
      status: "OUT_OF_SERVICE",
    });
  });
});

/**
 * A MATRICAKOD HAROM AGA -- ES A HARMADIK TER EL A TOBBI MEZOTOL.
 *
 * A szoveges mezoknel a kiuritett ertek `null`-kent megy fel, ami a szerveren
 * "toroljed". A matricanal ez NEM letezik: a `UpdateAssetDto` `string`-et var,
 * mert a leszedesnek nincs neve az esemeny-naploban. Egy `null` ott 400-zal
 * bukna el, tehat a kiuritest a kepernyo mondja ki szoban, nem egy nema keres.
 */
describe("buildAssetPatch és a matricakód", () => {
  const matricas: EditableAsset = { ...asset, labelCode: "V2196" };

  it("a VALTOZATLAN kódot nem küldi fel", () => {
    assert.deepEqual(buildAssetPatch(matricas, assetEditFormFrom(matricas)), {
      expectedUpdatedAt: matricas.updatedAt,
    });
  });

  it("matrica NÉLKÜLI eszközre felviszi az újat, nagybetűsen", () => {
    const form = { ...assetEditFormFrom(asset), labelCode: " v2196 " };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      labelCode: "V2196",
    });
  });

  it("meglévő kódot MÁSIKRA cserél", () => {
    const form = { ...assetEditFormFrom(matricas), labelCode: "Z9001" };
    assert.equal(buildAssetPatch(matricas, form).labelCode, "Z9001");
  });

  /**
   * A TESTVER-KONTROLL: a fenti harom allitas atmenne akkor is, ha a kiuritett
   * mezo `null`-t kuldene -- ott mindig van ertek. Ez az egy mondja ki, hogy a
   * kiuritessel NEM lehet leszedni a matricat.
   */
  it("a kiürített mező NEM küld törlést, ahogy a szöveges mezők tennék", () => {
    const form = { ...assetEditFormFrom(matricas), labelCode: "   " };
    const patch = buildAssetPatch(matricas, form);
    assert.equal(
      "labelCode" in patch,
      false,
      "a kiürítés nem mehet fel: a szerver 400-zal utasítaná el",
    );
    // ES A KONTRASZT, UGYANEBBEN AZ ALLITASBAN: egy szoveges mezo ugyanattol
    // a mozdulattol IGENIS torlest kuld. Ha ez a ket sor valaha egyet mondana,
    // az azt jelentene, hogy a ket szabaly osszecsuszott.
    const szoveges = { ...assetEditFormFrom(matricas), serialNumber: "  " };
    assert.equal(buildAssetPatch(matricas, szoveges).serialNumber, null);
  });

  /**
   * ES AZ OFFLINE SOR IS VIGYE AZ ALAPERTEKET.
   *
   * A `baseValuesFor` a `TEXT_FIELDS` listajan megy vegig, es a matricakod
   * SZANDEKOSAN nincs benne. A kihagyas nem bukna el magatol: a
   * `QueuedAssetUpdateBase` minden mezoje opcionalis, tehat a fordito hallgat,
   * a sor felmegy, es a feloldo kepernyo csak annyit tud, hogy "nincs
   * alapertek".
   */
  it("a sorba tett módosítás VISZI, mi állt az eszközön", () => {
    const form = { ...assetEditFormFrom(matricas), labelCode: "Z9001" };
    const patch = buildAssetPatch(matricas, form);
    assert.equal(baseValuesFor(matricas, patch).labelCode, "V2196");
  });

  it("matrica nélkül indulva az alapérték null, nem hiányzó", () => {
    const form = { ...assetEditFormFrom(asset), labelCode: "Z9001" };
    const patch = buildAssetPatch(asset, form);
    const base = baseValuesFor(asset, patch);
    // A KULONBSEG SZAMIT: a `null` azt mondja, hogy NEM VOLT matrica; a
    // hianyzo mezo azt, hogy NEM TUDJUK. A feloldo kepernyo a masodikra
    // tobbet kerdez, mint amennyi indokolt.
    assert.equal("labelCode" in base, true);
    assert.equal(base.labelCode, null);
  });
});

/**
 * A ROSSZ ALAK A MENTES ELOTT AKAD EL, ES EZ AZ OFFLINE SOR MIATT SZAMIT.
 *
 * Kapcsolat nelkul a mentes SORBA kerul: egy hibas kod igy csak a sor
 * kiuritesekor bukna el, akar orakkal kesobb, amikor a szerelo mar nincs a
 * gepnel. A szerver ugyanezt a kerest 400-zal utasitana el -- csak sokkal
 * kesobb, es mashol.
 */
describe("assetLabelEditProblem", () => {
  it("a jó alakot átengedi, kisbetűsen is", () => {
    for (const kod of ["V2196", " v2196 "])
      assert.equal(
        assetLabelEditProblem({ ...assetEditFormFrom(asset), labelCode: kod }),
        null,
        kod,
      );
  });

  it("az ÜRES mező nem hiba: azt jelenti, nem nyúltak hozzá", () => {
    for (const kod of ["", "   "])
      assert.equal(
        assetLabelEditProblem({ ...assetEditFormFrom(asset), labelCode: kod }),
        null,
      );
  });

  it("a rossz alakot MEGFOGJA", () => {
    // ISMERT POZITIV KONTROLL a ket fenti tagadashoz: ha a fuggveny MINDIG
    // `null`-t adna, azok is zoldek lennenek.
    for (const kod of ["ROSSZ", "V219", "V21966", "2196V"])
      assert.equal(
        assetLabelEditProblem({ ...assetEditFormFrom(asset), labelCode: kod }),
        "malformed",
        kod,
      );
  });
});

describe("hasAssetChanges", () => {
  it("is false for an untouched form", () => {
    assert.equal(hasAssetChanges(asset, assetEditFormFrom(asset)), false);
  });

  it("is false when the only edit was whitespace", () => {
    const form = { ...assetEditFormFrom(asset), model: " 2078 " };
    assert.equal(hasAssetChanges(asset, form), false);
  });

  it("is true as soon as one field differs", () => {
    const form = { ...assetEditFormFrom(asset), notes: "" };
    assert.equal(hasAssetChanges(asset, form), true);
  });
});

describe("buildAssetPatch es az alegyseg", () => {
  const partnerAsset: EditableAsset = {
    ...asset,
    ownerType: "SUPPLIER",
    unit: { id: "unit-1" },
  };

  /**
   * A FELVITELI URLAP UGYANAZNAP MEGKAPTA A HELYSZIN-VALASZTOT. Egy mezo, amit
   * felvinni lehet, de javitani nem, egy elgepeles utan zsakutca: a szerelo a
   * terepen nem tud mit kezdeni magaval.
   */
  it("sends the new unit when the technician picks another one", () => {
    const form = { ...assetEditFormFrom(partnerAsset), unitId: "unit-2" };
    assert.equal(buildAssetPatch(partnerAsset, form).departmentId, "unit-2");
  });

  it("stays silent when the unit did not change", () => {
    const patch = buildAssetPatch(
      partnerAsset,
      assetEditFormFrom(partnerAsset),
    );
    assert.equal("departmentId" in patch, false);
  });

  /**
   * AZ URESRE TORLES TORLES: a szerver a `null` erteket ugy veszi, hogy a
   * kotes megszunik. A mezo ELHAGYASA ellenben azt jelenti, hogy ne nyulj
   * hozza -- a ketto nem ugyanaz, es a kulonbseg itt keletkezik.
   */
  it("clears the unit with null, not by leaving the field out", () => {
    const form = { ...assetEditFormFrom(partnerAsset), unitId: "" };
    assert.equal(buildAssetPatch(partnerAsset, form).departmentId, null);
  });

  /**
   * VEVO TULAJDONOSNAL SOSEM MEGY KI, akkor sem, ha a formban maradt ertek: a
   * szerver elutasitana, es a hiba a mentes pillanataban jelenne meg.
   */
  it("never sends a unit for a customer-owned asset", () => {
    const customerAsset: EditableAsset = { ...asset, ownerType: "CUSTOMER" };
    const form = { ...assetEditFormFrom(customerAsset), unitId: "unit-2" };
    assert.equal("departmentId" in buildAssetPatch(customerAsset, form), false);
  });

  it("counts a unit change as a change worth saving", () => {
    const form = { ...assetEditFormFrom(partnerAsset), unitId: "unit-2" };
    assert.equal(hasAssetChanges(partnerAsset, form), true);
  });
});
