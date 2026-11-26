import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * AZ AKVÁRIUM VÍZÉRTÉKEINEK GÖRBÉJE A PARTNER PORTÁLON (picasso képernyő-leltár, 4. pont, P6; acrobot 62248).
 *
 * Egy mérésnél a görbe helye üres maradt (a görbe két ponttól rajzolódik), állandó értéknél a vonal a doboz alján, a kitöltés szélén
 * futott, és üres sávnak látszott. A belső web ugyanezt a kódot viseli; ott a komponens-teszt rajzolja ki
 * (`pilot-aquarium-water-values.component.test.tsx`).
 *
 * A HATÁR: forrást olvas (a csomagban nincs renderelő, lásd portal-wiring.spec.ts). MI PIROSIT: egy mérésnél nincs mondat; állandó
 * értéknél a régi tartalék (`|| 1`) tér vissza, és a vonal nem középre kerül.
 */
const KOD = readFileSync("src/components/aquarium-water-values.tsx", "utf8");

describe("P6: az akvárium görbéje egy mérésnél és állandó értéknél", () => {
  it("egy mérésnél kimondja, hogy még nincs görbe", () => {
    assert.match(
      KOD,
      /activePoints\.length === 1 \?[\s\S]{0,300}Egy mérésből még nincs görbe, a második után jelenik meg\./,
    );
  });

  it("állandó értéknél a vonal középen áll", () => {
    assert.match(KOD, /const spanValue = maxValue - minValue;/);
    assert.match(KOD, /spanValue === 0\s*\?\s*height \/ 2/);
    assert.doesNotMatch(KOD, /maxValue - minValue \|\| 1/);
  });
});
