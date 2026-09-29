import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isChargeDescription } from "./supplier-invoice-import.common.js";

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
