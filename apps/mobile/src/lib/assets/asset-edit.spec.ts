import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assetEditFormFrom,
  assetPerformanceEditProblem,
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

/**
 * A KATEGORIA A TELEFONON: FELVINNI EDDIG LEHETETT, MEGVALTOZTATNI NEM.
 *
 * A felviteli urlapon 2026-09-22 ota van valaszto, a szerkeszton nem volt --
 * vagyis egy elgepelt vagy hianyzo kategoriat a szerelo a terepen nem tudott
 * javitani. Ugyanaz az indok, amiert a helyszin 2026-08-27-en bekerult ide.
 */
describe("kategória a szerkesztőben", () => {
  const kategoriaval: EditableAsset = {
    ...asset,
    categoryId: "cat-szivattyu",
    category: "Szivattyú",
  };

  it("az űrlap a MOSTANI kategóriából töltődik elő", () => {
    assert.equal(assetEditFormFrom(kategoriaval).categoryId, "cat-szivattyu");
  });

  it("kategória nélküli eszközön üres, nem az `undefined` szó", () => {
    assert.equal(assetEditFormFrom(asset).categoryId, "");
  });

  it("változatlan kategóriát NEM küld", () => {
    const patch = buildAssetPatch(
      kategoriaval,
      assetEditFormFrom(kategoriaval),
    );
    assert.equal("categoryId" in patch, false);
  });

  it("a megváltoztatott kategóriát AZONOSÍTÓKÉNT küldi", () => {
    const patch = buildAssetPatch(kategoriaval, {
      ...assetEditFormFrom(kategoriaval),
      categoryId: "cat-vilagitas",
    });
    assert.equal(patch.categoryId, "cat-vilagitas");
  });

  /**
   * A KIURITES TORLES, ES EZ A MATRICAVAL ELLENTETES ALAK.
   *
   * A matricakodnal a kiurites NEM megy at (a szerver `string`-et var, a
   * leszedesnek nincs neve az esemeny-naploban). A kategorianal a torles
   * LETEZIK: az eszkoz allhat kategoria nelkul, es az atvezeto migracio
   * szandekosan hagy ilyen sorokat. A ket ellentetes alak ugyanabbol a
   * szabalybol jon, ezert all mind a ketto merve.
   */
  it("a kiürített kategória TÖRLÉS, nem elhagyás", () => {
    const patch = buildAssetPatch(kategoriaval, {
      ...assetEditFormFrom(kategoriaval),
      categoryId: "",
    });
    assert.equal("categoryId" in patch, true);
    assert.equal(patch.categoryId, null);
  });

  /**
   * MINDEN TULAJDONOSNAL MEGY, ELLENTETBEN AZ ALEGYSEGGEL.
   *
   * Az alegyseget a `buildAssetPatch` a tulajdonos TIPUSAHOZ koti, mert vevonel
   * a szerver elutasitana. A kategoria torzsadat: minden eszkozon ertelmes.
   * Enelkul az allitas nelkul egy „masoljuk a szomszed feltetelt" alaku
   * valtoztatas CSENDBEN elvenne a vevoi eszkozokrol.
   */
  it("vevő tulajdonosú eszközön IS elmegy", () => {
    const vevoi: EditableAsset = { ...kategoriaval, ownerType: "CUSTOMER" };
    const patch = buildAssetPatch(vevoi, {
      ...assetEditFormFrom(vevoi),
      categoryId: "cat-vilagitas",
    });
    assert.equal(patch.categoryId, "cat-vilagitas");
  });

  it("a sorba tett módosítás VISZI a látott kategóriát", () => {
    const form = { ...assetEditFormFrom(kategoriaval), categoryId: "cat-uj" };
    const patch = buildAssetPatch(kategoriaval, form);

    assert.equal(
      baseValuesFor(kategoriaval, patch).categoryId,
      "cat-szivattyu",
    );
  });

  /**
   * KONTROLL: amihez a szerelo hozza sem nyult, arrol NINCS alapertek.
   *
   * Egy felesleges alapertek a feloldo kepernyot kerdezteti olyasmirol, amit
   * senki nem irt at -- es a fenti allitas akkor is zold lenne, ha a sor
   * MINDIG vinne a kategoriat.
   */
  it("KONTROLL: érintetlen kategóriáról nincs alapérték a sorban", () => {
    const form = { ...assetEditFormFrom(kategoriaval), notes: "Más." };
    const patch = buildAssetPatch(kategoriaval, form);

    assert.equal("categoryId" in baseValuesFor(kategoriaval, patch), false);
  });

  it("a szerkesztés VÁLTOZÁSNAK számít, tehát a mentés gomb él", () => {
    assert.equal(
      hasAssetChanges(kategoriaval, {
        ...assetEditFormFrom(kategoriaval),
        categoryId: "cat-vilagitas",
      }),
      true,
    );
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
      status: "COLD_STANDBY" as const,
    };
    assert.deepEqual(buildAssetPatch(asset, form), {
      expectedUpdatedAt: asset.updatedAt,
      model: "2080",
      notes: "Cserélt tömítés.",
      status: "COLD_STANDBY",
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

/**
 * A TELJESITMENY-PAR A SZERKESZTON -- ES ITT AZ EREDMENY DONT, NEM A MEZO.
 *
 * Ugyanaz a szabaly, mint a szerveren: egy "csak a szamot irom at" keres
 * ervenyes, ha az egyseg mar all az eszkozon. Amit el kell kerulni, az a fel
 * TORLES -- es offline az csak orakkal kesobb bukna el.
 */
describe("a teljesítmény-pár a szerkesztőn", () => {
  const eszkoz: EditableAsset = {
    ...asset,
    performance: "500",
    performanceUnit: { id: "uom-w" },
  };

  it("a meglévő pár BETÖLTŐDIK az űrlapba", () => {
    const form = assetEditFormFrom(eszkoz);
    assert.equal(form.performance, "500");
    assert.equal(form.performanceUnitId, "uom-w");
  });

  it("csak a szám átírása EGYETLEN kulcsot küld", () => {
    const form = { ...assetEditFormFrom(eszkoz), performance: "750" };
    const patch = buildAssetPatch(eszkoz, form);
    assert.equal(patch.performance, "750");
    // A MASIK FEL NEM MEGY EL: a szerver a MEGLEVO egyseget hasznalja. Ha
    // menne, egy kozben atirt egyseget irnank felul a regivel.
    assert.equal("performanceUnitId" in patch, false);
  });

  it("a vessző pontra fordul a törzsben is", () => {
    const form = { ...assetEditFormFrom(eszkoz), performance: "0,5" };
    assert.equal(buildAssetPatch(eszkoz, form).performance, "0.5");
  });

  it("a két mező kiürítve EGYÜTT törli a párt", () => {
    const form = {
      ...assetEditFormFrom(eszkoz),
      performance: "",
      performanceUnitId: "",
    };
    const patch = buildAssetPatch(eszkoz, form);
    assert.equal(patch.performance, null);
    assert.equal(patch.performanceUnitId, null);
  });

  it("a fél törlés a MENTÉS ELŐTT elbukik", () => {
    const form = { ...assetEditFormFrom(eszkoz), performance: "" };
    assert.equal(assetPerformanceEditProblem(form), "missing-value");
  });

  it("az érintetlen pár semmit nem küld", () => {
    assert.equal(
      hasAssetChanges(eszkoz, assetEditFormFrom(eszkoz)),
      false,
      "egy változatlan űrlap mentése is elmozdítaná az időbélyeget",
    );
  });

  /**
   * A SORBA IS BEKERUL AZ ALAPERTEK -- ES CSAK ARRA A FELERE, AMI VALTOZOTT.
   *
   * Enelkul a pinceben beirt teljesitmeny CSENDBEN elveszne: a sor torzse
   * vinne a valtozast, de az utkozes-feloldas nem tudna, MIHEZ kepest keszult.
   */
  it("a sor alapértéke csak a változott felét viszi", () => {
    const form = { ...assetEditFormFrom(eszkoz), performance: "750" };
    const base = baseValuesFor(eszkoz, buildAssetPatch(eszkoz, form));
    assert.equal(base.performance, "500");
    assert.equal("performanceUnitId" in base, false);
  });
});
