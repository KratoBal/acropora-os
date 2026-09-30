import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isChargeDescription,
  supplierTaxKey,
} from "./supplier-invoice-import.common.js";

/**
 * A DIJSOR-SZABALY, AMIT MINDEN SZALLITO SZAMLAJA HASZNAL (a fajlbol beolvasott
 * es a NAV-bol elotoltott is). Bovitve 2026-09-29 (acrobot 24749): csak MERT
 * alakokkal. Merve ugyanaznap: a 94 importalt minta-szamla 2476 soraban az uj
 * szabaly egyetlen sor iteletet valtoztatja (De Jong 19005741 "Truck
 * delivery"), es a katalogus 1927 termeknevebol egyik sem dijsor.
 */
describe("isChargeDescription", () => {
  it("a korabbi alakok valtozatlanul dijsorok (visszaeses ellen)", () => {
    for (const text of [
      "Shipping cost UPS 2 parcels",
      "Versandkosten",
      "Frachtkosten",
      "Szállítási díj",
      "Fuvar",
      "transport to Budapest Zoo",
    ])
      assert.equal(isChargeDescription(text), true, text);
  });

  it("az uj, mert alakok dijsorok", () => {
    for (const text of [
      "Kiszállítási díj",
      "Szállítási költség",
      "Postaköltség",
      "Truck delivery",
    ])
      assert.equal(isChargeDescription(text), true, text);
  });

  it("a termek, amelyben a szo csak resz, NEM dijsor (negativ kontroll)", () => {
    for (const text of [
      "Transzportzsák halszállításhoz 60x30 cm",
      "Portobello élőkő 1 kg",
      "Szállítózsák 10 db",
      "Reef Energy® Plus 1L",
      "Só",
    ])
      assert.equal(isChargeDescription(text), false, text);
  });
});

/*
  A SZALLITO KULCSA A JEV-KAPUHOZ (acrobot 24924, 2026-09-30).
  MI PIROSIT: ha a magyar hazai adoszam megint nem ad kulcsot; ha ugyanannak a
  cegnek ket alakja ket kulcsot kap; vagy ha egy elgepelt szam egy masik ceg
  kulcsava valik.
*/
describe("supplierTaxKey", () => {
  it("a magyar adószám minden alakja ugyanazt a kulcsot adja: HU + törzsszám", () => {
    for (const alak of [
      "14116380-2-06",
      "14116380-1-41",
      "14116380206",
      "HU14116380",
      "hu 14116380",
      "14116380",
    ])
      assert.equal(supplierTaxKey(alak), "HU14116380", alak);
  });

  it("az EU-adószám változatlan marad", () => {
    assert.equal(supplierTaxKey("DE 342 032 439"), "DE342032439");
    assert.equal(supplierTaxKey("NL802708705B01"), "NL802708705B01");
    assert.equal(supplierTaxKey("FR67529301244"), "FR67529301244");
  });

  it("elgépelt törzsszám (rossz ellenőrző jegy): nincs kulcs, nem egy másik cég", () => {
    assert.equal(supplierTaxKey("14116381-2-06"), null);
    assert.equal(supplierTaxKey("HU14116381"), null);
  });

  it("üres vagy alak nélküli: nincs kulcs", () => {
    assert.equal(supplierTaxKey(null), null);
    assert.equal(supplierTaxKey(""), null);
    assert.equal(supplierTaxKey("1411638"), null);
  });
});
