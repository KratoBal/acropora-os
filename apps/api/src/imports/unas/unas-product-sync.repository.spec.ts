import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { webshopSellableFromUnas } from "./unas-product-sync.repository.js";

describe("webshopSellableFromUnas", () => {
  it("marks a listed, directly purchasable product sellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "1", inquireOnly: false }),
      true,
    );
  });

  it("keeps a listed inquiry-only product unsellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "1", inquireOnly: true }),
      false,
    );
  });

  it("keeps a product outside the webshop unsellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "0", inquireOnly: false }),
      false,
    );
  });

  /**
   * ISMERT POZITIV: a `base=2` ("aktiv/uj") ugyanugy megvasarolhato, mint az
   * `1`. Merve 2026-09-04: a ket csoport lapjai azonos statuszkodot ES azonos
   * vasarlasi jelolo-szamot adnak. 2026-09-04-ig 54 ilyen termek esett ki.
   */
  it("marks a base=2 (active/new) product sellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "2", inquireOnly: false }),
      true,
    );
  });

  /**
   * ISMERT NEGATIV, ES EZ A FONTOSABB: a `base=3` "aktiv, de nem vasarolhato".
   * Egy tul TAG szabaly ("minden aktiv") ezt csendben bevenne, es a bolt olyan
   * termeket kinalna eladasra, amit nem lehet megvenni. A tevedes iranya nem
   * mindegy: ez a fajta NEMA, mert a termek kint ugy nezne ki, mint a tobbi.
   */
  it("keeps a base=3 (active, not purchasable) product unsellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "3", inquireOnly: false }),
      false,
    );
  });

  /**
   * AZ `Inquire` JELZO A STATUSZ FOLOTT AL, es ez az uj erteknel is igy marad.
   * A ket feltetel kulon all: a statusz azt mondja meg, KINT VAN-E, az
   * `Inquire` azt, hogy MEG LEHET-E VENNI.
   */
  it("keeps a base=2 inquiry-only product unsellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: "2", inquireOnly: true }),
      false,
    );
  });

  /**
   * A HIANYZO STATUSZ NEM "aktiv". A hatterbeli feltoltes olyan termeket is lat,
   * aminek nincs UNAS-csatornas sora -- ott a mezo `null`, es abbol nem szabad
   * eladhatosagot kovetkeztetni.
   */
  it("keeps a product with no status unsellable", () => {
    assert.equal(
      webshopSellableFromUnas({ externalStatus: null, inquireOnly: false }),
      false,
    );
  });
});
