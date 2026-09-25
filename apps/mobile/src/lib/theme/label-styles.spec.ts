import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  eyebrowStyle,
  statusBadgeStyle,
  statusToneColors,
} from "./label-styles";
import { LIGHT_THEME } from "./tokens";

describe("eyebrowStyle", () => {
  it("mindig a MUTED színt adja, akármilyen méret jön", () => {
    const style = eyebrowStyle(LIGHT_THEME, {
      fontSize: 11,
      fontWeight: "900",
      letterSpacing: 1.4,
    });
    assert.equal(style.color, LIGHT_THEME.textMuted);
  });

  it("a méret/vastagság/betűköz VÁLTOZATLANUL átmegy -- ez a tervkörönkénti eltérés helye", () => {
    const style = eyebrowStyle(LIGHT_THEME, {
      fontSize: 12,
      fontWeight: "600",
      letterSpacing: 1.2,
      textTransform: "uppercase",
    });
    assert.equal(style.fontSize, 12);
    assert.equal(style.fontWeight, "600");
    assert.equal(style.letterSpacing, 1.2);
    assert.equal(style.textTransform, "uppercase");
  });
});

describe("statusBadgeStyle", () => {
  it("a jelvény háttere és szövegszíne az akcent-lágy párból jön", () => {
    const style = statusBadgeStyle(LIGHT_THEME);
    assert.equal(style.backgroundColor, LIGHT_THEME.accentSoft);
    assert.equal(style.color, LIGHT_THEME.accentSoftText);
  });

  it("nem állít alignSelf-et -- ezt a hívó dönti el a saját elrendezésében", () => {
    const style = statusBadgeStyle(LIGHT_THEME);
    assert.equal("alignSelf" in style, false);
  });
});

describe("statusToneColors", () => {
  it("mind a négy tónus a saját, megkülönböztethető színpárját adja", () => {
    const neutral = statusToneColors(LIGHT_THEME, "neutral");
    const warning = statusToneColors(LIGHT_THEME, "warning");
    const accent = statusToneColors(LIGHT_THEME, "accent");
    const danger = statusToneColors(LIGHT_THEME, "danger");

    assert.deepEqual(neutral, {
      background: LIGHT_THEME.border,
      text: LIGHT_THEME.textSecondary,
    });
    assert.deepEqual(warning, {
      background: LIGHT_THEME.warningSoft,
      text: LIGHT_THEME.warning,
    });
    assert.deepEqual(accent, {
      background: LIGHT_THEME.accentSoft,
      text: LIGHT_THEME.accentSoftText,
    });
    assert.deepEqual(danger, {
      background: LIGHT_THEME.dangerSoft,
      text: LIGHT_THEME.danger,
    });

    // NÉGY KÜLÖNBÖZŐ HÁTTÉR: ha kettő egybeesne, két állapot ugyanúgy nézne ki.
    const backgrounds = [neutral, warning, accent, danger].map(
      (tone) => tone.background,
    );
    assert.equal(new Set(backgrounds).size, 4);
  });
});
