import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { confirmPackSize, nameSize } from "./pack-size-confirm.js";

/*
  WHAT TURNS THIS RED. A size read off the page instead of our name's (the Korallen-Zucht page titled 10 ml for our
  100 ml); a size in a related product's link, an attribute or free text taken as a confirmation (the Modern Reef pages
  carry our 100 ml in their related links); a multipack or a two-size name given a size; "100 ml" matched inside
  "1100 ml" or "0.100 ml".
*/
describe("a név mérete", () => {
  it("egy méret, egységes alakban", () => {
    assert.equal(nameSize("Aquaforest AF Amino Mix 10ml")?.raw, "10 ml");
    assert.equal(
      nameSize("Modern Reef Iodine (I) 100 ml - Jód")?.raw,
      "100 ml",
    );
    assert.equal(
      nameSize("RedSea Salt - tengeri só 7kg (vödörben)")?.raw,
      "7 kg",
    );
    assert.equal(nameSize("Valami folyadék 0,5 L")?.raw, "0.5 l");
  });

  it("nincs méret, két méret vagy többes csomag: nincs saját érték", () => {
    assert.equal(nameSize("Stylo-Poci-Glow"), null);
    assert.equal(nameSize("Aquaforest - Component 1+2+3+ 3x5000ml"), null);
    assert.equal(nameSize("Szett 2 x 100 ml"), null);
    assert.equal(nameSize("Készlet 250 ml + 100 ml"), null);
  });

  it("átfolyás és szűrőkapacitás nem kiszerelés (barracuda, #2556; a mai katalógus nevei)", () => {
    assert.equal(
      nameSize("AQAMAI KPM Wi-Fi Smart- Áramoltató 4500-10500 l/h"),
      null,
    );
    assert.equal(nameSize("Octo Pulse4 17000 l/h áramoltató OP-4"), null);
    assert.equal(nameSize("FLUVAL FX6, 1500L-es külső szűrő"), null);
    assert.equal(nameSize("Szivattyú 3000 l/óra"), null);
    assert.equal(nameSize("Szűrő 300l-es akváriumhoz"), null);
  });

  it("típuskód és ékezetes szó nem méret (a JS \\b csak ASCII)", () => {
    assert.equal(nameSize("Schego WS2 légpumpa 250l/h"), null);
    assert.equal(nameSize("CUH-18L - 18W-os UVC pótizzó"), null);
    assert.equal(nameSize("Lámpa 100 lámpatest"), null);
    assert.equal(nameSize("Ultra Reef Skimmer 140 lehabzó (100-400l)"), null);
    assert.equal(nameSize("Vertex Előszűrőzsák tartó 100ml-s"), null);
  });

  it("a valódi kiszerelés a központozás és a tapadó betű mellett is megmarad (a mai katalógus nevei)", () => {
    assert.equal(nameSize("Triton Nickel100 ml")?.raw, "100 ml");
    assert.equal(nameSize("Aquaforest Fluorine10ml")?.raw, "10 ml");
    assert.equal(
      nameSize("Grotech ReefClear -500ml szűrőfolyadék")?.raw,
      "500 ml",
    );
    assert.equal(
      nameSize(
        "Fauna Marin Balling Magnesium (Mg) Mix 2 kg- magnézium készítmény",
      )?.raw,
      "2 kg",
    );
  });

  it("ugyanaz a méret kétszer a névben egy méret", () => {
    assert.equal(nameSize("Amino 100ml - aminosav 100 ml")?.raw, "100 ml");
  });
});

describe("a gyártói lap megerősítése", () => {
  const size = nameSize("Kitalált adalék 100ml")!;

  it("a cím, a h1 és a változat-választó megerősít, a hely a kivonat", () => {
    for (const html of [
      "<html><head><title>Additive 100 ml | Maker</title></head><body></body></html>",
      '<h1 class="product-title">Additive 100ml</h1>',
      '<select name="size"><option value="1">10 ml</option><option value="2">100 ml</option></select>',
      '<span class="shopengine_swatch">100 ml</span>',
    ]) {
      const value = confirmPackSize(html, size);
      assert.equal(value?.field, "packSize", html);
      assert.equal(value?.raw, "100 ml", html);
      assert.match(value!.excerpt, /100\s?ml/, html);
    }
  });

  it("kapcsolódó termék linkje, attribútum, szabad szöveg és szkript nem erősít meg", () => {
    for (const html of [
      '<h1>Additive 10 ml</h1><ul class="related"><li><a class="woocommerce-LoopProduct-link">Other 100 ml</a></li></ul>',
      '<h1>Additive</h1><img alt="Additive 100 ml" src="/a-100ml.png">',
      "<h1>Additive</h1><p>Available in 10 ml, 50 ml and 100 ml.</p>",
      '<h1>Additive</h1><script>var size = "100 ml";</script><title>x</title>',
    ])
      assert.equal(confirmPackSize(html, size), null, html);
  });

  it("a szám határa: az 1100 ml és a 0.100 ml nem a 100 ml", () => {
    assert.equal(confirmPackSize("<h1>Additive 1100 ml</h1>", size), null);
    assert.equal(confirmPackSize("<h1>Additive 0.100 ml</h1>", size), null);
    assert.equal(
      confirmPackSize("<h1>Additive 0,5 l</h1>", nameSize("Folyadék 0.5 L")!)
        ?.raw,
      "0.5 l",
    );
  });
});
