import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/*
  A FŐDÍJ FELIRATA TELEFONON A KÉP ALATT ÁLL (stage 390 px, 2026-11-13: a kék "A JÁTÉK FŐDÍJA" a korallra és a homokra csúszott,
  a "FŐDÍJA" alig volt olvasható). MI PIROSIT: ha a telefonos dobozban a kép magassága nagyobb lenne, mint a doboz magassága
  mínusz a felirat helye (alsó távolság + a felirat saját magassága), vagyis a kép a feliratra érne.
  A KÉT SZÁM, AMIT A MÉRÉS ADOTT (helyi futtatás, 390/360/700 px): a felirat 121 px magas, alsó távolsága a telefonos blokkban 70 px.
  A FORRÁS SZÖVEGET olvassa (a csomag mintája), a futó oldal elrendezését a stage 390 px-es képe igazolja.
*/
const css = readFileSync(
  join(process.cwd(), "src", "app", "jatek.css"),
  "utf8",
);
const LABEL_HEIGHT = 121;

/** The value (px) of `property` in the LAST rule with this selector that sets it (the cascade winner inside the phone blocks). */
function lastPx(selector: string, property: string): number {
  const rule = new RegExp(
    `${selector.replace(/[.>]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  let found: number | null = null;
  for (const match of css.matchAll(rule)) {
    const declaration = new RegExp(`(?:^|[;\\s])${property}:\\s*(\\d+)px`).exec(
      match[1]!,
    );
    if (declaration) found = Number(declaration[1]);
  }
  assert.ok(found !== null, `${selector} ${property}: nincs px érték`);
  return found;
}

describe("a főgép-doboz telefonos elrendezése", () => {
  it("a kép nem ér a fődíj feliratára (a doboz a kép + a felirat helye)", () => {
    const art = lastPx(".jatek-hero-art", "height");
    const image = lastPx(".jatek-hero-art > img", "height");
    const labelBottom = lastPx(".jatek-prize-label", "bottom");
    assert.ok(
      image + LABEL_HEIGHT + labelBottom <= art,
      `kép ${image} + felirat ${LABEL_HEIGHT} + alsó hely ${labelBottom} > doboz ${art}`,
    );
  });
});
