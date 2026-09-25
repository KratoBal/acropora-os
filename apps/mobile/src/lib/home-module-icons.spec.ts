import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * A KEZDŐLAP MODUL-CSEMPÉI IKONT VISELNEK, NEM BETŰKÓDOT (Balázs kérése,
 * 2026-09-25 18:23, `exchange/figma-telefon-make-12/src/MobileAppScreen.tsx`
 * 264-269. sor). A HAT megnevezett modul emojija onnan jön BETŰRE EGYEZŐEN --
 * ez az állítás ezt a hat sort méri, nem a saját ízlésemet.
 *
 * A `code` prop VÁLTOZATLAN MARADT (lásd `nav-tile-roles.spec.ts`, ami a
 * `code="NAV"` alakra illeszkedik): a kód a szerver menütételéhez kötött
 * azonosító, az `icon` egy ÚJ, KIZÁRÓLAG megjelenítési prop mellette.
 */
const HOME_SCREEN = join("src", "app", "index.tsx");

const FIGMA_IKONOK: Record<string, string> = {
  HJ: "🎫",
  MU: "📋",
  AI: "📦",
  ES: "🔧",
  AK: "🐟",
  PA: "🤝",
};

/** A NÉGY TOVÁBBI MODUL, AMI NEM SZEREPEL A FIGMA-TERVBEN: csak azt mérjük,
 * hogy van SAJÁT, NEM ÜRES ikonjuk, nem a konkrét emojit -- azt Balázs
 * kifejezetten "illő ikonnak" nevezte, nem előírt értéknek. */
const TOVABBI_KODOK = ["RE", "BE", "TE", "NAV"];

function kodSzoveg(forras: string): string {
  return forras
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

function iconFor(forras: string, code: string): string | undefined {
  const match = new RegExp(`code="${code}"[\\s\\S]*?icon="([^"]+)"`).exec(
    forras,
  );
  return match?.[1];
}

describe("a kezdőlap modul-csempéi a terv szerinti ikont viselik", () => {
  const forras = kodSzoveg(readFileSync(HOME_SCREEN, "utf8"));

  it("ISMERT POZITÍV KONTROLL: a Figma-lista tényleg nem üres", () => {
    assert.ok(Object.keys(FIGMA_IKONOK).length >= 6);
  });

  for (const [code, ikon] of Object.entries(FIGMA_IKONOK)) {
    it(`${code}: az ikon betűre egyezik a Figma tervvel (${ikon})`, () => {
      assert.equal(
        iconFor(forras, code),
        ikon,
        `a ${code} csempe ikonja nem a tervezett ${ikon}`,
      );
    });
  }

  for (const code of TOVABBI_KODOK) {
    it(`${code}: van saját, nem üres ikonja (a terv ezt a modult nem nevezi meg)`, () => {
      const ikon = iconFor(forras, code);
      assert.ok(ikon && ikon.trim().length > 0, `${code}: nincs icon prop`);
    });
  }

  it("a régi betűkód-szöveg nem jelenik meg többé a csempén", () => {
    assert.doesNotMatch(
      forras,
      /\{code\}/,
      "a ModuleCard még mindig a code prop szövegét jeleníti meg",
    );
  });
});
