import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isGroupVatTaxNumber,
  supplierAccountKey,
} from "./supplier-bank-account-key.js";

/*
  A SZÁLLÍTÓ KULCSA (acrobot 58553). MI PIROSÍT: ha ugyanazon szállító két írásmódja (8 vagy 11 jegy, kötőjel, HU előtag) két kulcs lenne; ha két szállító egy kulcson osztozna; ha a külföldi
  szállító közösségi adószáma nem kulcs; ha a saját cég szállítóként kulcsot kapna; ha adószám és név nélkül is lenne kulcs.
*/
describe("a szállító kulcsa a kitöltött számlaszámhoz", () => {
  it("a magyar adószám minden írásmódja egy kulcs: törzsszám, teljes adószám, közösségi alak", () => {
    for (const tax of [
      "32435119",
      "32435119-2-13",
      "HU32435119",
      "32435119213",
    ])
      assert.equal(supplierAccountKey(tax, null, "x"), "hu:32435119", tax);
  });

  it("a külföldi szállító közösségi adószáma kulcs; a magyar közösségi alak a hazai kulcs", () => {
    assert.equal(
      supplierAccountKey(null, "ATU63964918", "niceshops GmbH"),
      "eu:ATU63964918",
    );
    assert.equal(
      supplierAccountKey(null, "atu 63964918", "niceshops"),
      "eu:ATU63964918",
    );
    assert.equal(supplierAccountKey("", "HU12805637", "x"), "hu:12805637");
  });

  it("adószám nélkül a név (kisbetű, szóközök összevonva); név nélkül nincs kulcs", () => {
    assert.equal(
      supplierAccountKey(null, null, "  Euro   Corals "),
      "name:euro corals",
    );
    assert.equal(supplierAccountKey(null, null, "   "), null);
    assert.equal(supplierAccountKey(null, null, null), null);
  });

  it("a saját cég nem szállító: nincs hazai kulcsa, a név marad", () => {
    assert.equal(
      supplierAccountKey("23916229-2-42", null, "Acropora Kft."),
      "name:acropora kft.",
    );
  });

  it("két különböző szállító két kulcs", () => {
    assert.notEqual(
      supplierAccountKey("32435119", null, "A"),
      supplierAccountKey("12369410", null, "A"),
    );
  });
});

describe("a csoportos ÁFA-alany nem szállító-kulcs (barracuda #2801)", () => {
  it("a 11 jegyű adószám 9. jegye az 5: csoportos; a 4, a 2, a 8 jegyű törzsszám és az üres nem", () => {
    for (const tax of ["12345678-5-41", "12345678541", "HU12345678-5-41"])
      assert.equal(isGroupVatTaxNumber(tax), true, tax);
    for (const tax of [
      "12345678-2-41",
      "12345678-4-41",
      "12345678",
      "",
      null,
      undefined,
    ])
      assert.equal(isGroupVatTaxNumber(tax), false, String(tax));
  });

  it("a csoport-adószámú szállító a névre esik (az nem ír és nem pótol), a tag saját adószámú sora a hazai kulcsot kapja", () => {
    assert.equal(
      supplierAccountKey("12345678-5-41", null, "Csoport Tag Kft."),
      "name:csoport tag kft.",
    );
    assert.equal(
      supplierAccountKey(null, "HU12345678-5-41", "Csoport Tag Kft."),
      "name:csoport tag kft.",
    );
    assert.equal(
      supplierAccountKey("12345678-4-41", null, "Csoport Tag Kft."),
      "hu:12345678",
    );
  });
});
