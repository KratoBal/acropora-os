import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { medusaHandleFromSlug } from "./medusa-product-handle.js";

describe("medusaHandleFromSlug", () => {
  /**
   * EZ AZ ALLITAS A FUGGVENY LETEZESENEK OKA: a mai cimet beture visszuk.
   * Egy "szebb" alak (kisbetusites) a cimet tavolabb vinne a regitol.
   */
  it("a mai bolti cimet valtozatlanul viszi at", () => {
    assert.equal(
      medusaHandleFromSlug("Aqua-Illumination-Prime-HD-LED-panel"),
      "Aqua-Illumination-Prime-HD-LED-panel",
    );
  });

  /**
   * A PERJEL AZ EGYETLEN, AMIT AT KELL ALAKITANI: a `handle` egy
   * URL-szegmens, perjellel a cim kettevalna. Merve: 107 SefUrl tartalmaz
   * perjelet, mind mertekegyseg miatt.
   */
  it("a mertekegyseg perjelet kotojelre csereli", () => {
    assert.equal(
      medusaHandleFromSlug("Jebao-Sine-Wave-Pump-SLW-5-aramoltato-3000-l/h"),
      "Jebao-Sine-Wave-Pump-SLW-5-aramoltato-3000-l-h",
    );
  });

  /**
   * ES NEM KELETKEZIK DUPLA KOTOJEL: a valodi adatban a perjel elott gyakran
   * mar all egy kotojel ("...KIMERT-/kg"). Ket kotojel egymas mellett nem
   * hibas cim, de a mai alakot tavolitana -- es az osszevonas teszi a
   * leképezést kiszamithatova.
   */
  it("nem hagy dupla kotojelet a valodi alakon", () => {
    assert.equal(
      medusaHandleFromSlug("Dupla-Marin-Coralit-aljzat-2-3mm-KIMERT-/kg"),
      "Dupla-Marin-Coralit-aljzat-2-3mm-KIMERT-kg",
    );
  });

  /**
   * A `null` ES AZ URES STRING UGYANAZT A VALASZT KAPJA, ES EZ SZANDEKOS: a
   * hivo szerzodese szerint `null` eseten a mezo NEM megy ki. Egy ures
   * `handle` felulirna azt, amit a bolt korabban a nevbol szarmaztatott.
   */
  it("nincs mit atvinni: null", () => {
    assert.equal(medusaHandleFromSlug(null), null);
    assert.equal(medusaHandleFromSlug(""), null);
    assert.equal(medusaHandleFromSlug("   "), null);
    assert.equal(medusaHandleFromSlug("///"), null);
  });
});
