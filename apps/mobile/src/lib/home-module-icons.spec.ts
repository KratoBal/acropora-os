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

/**
 * KÉT OSZLOP, A TERV SZERINT (Balázs kérdése, 2026-09-25 18:25, ugyanaz a
 * kör, mint az ikonoké): a modul-csempék rácsa két oszlopban álljon, a
 * csempe maga függőleges elrendezésű (ikon felül, alatta cím/leírás,
 * legalul a nyíl), és páratlan darabszámnál az utolsó csempe fél
 * szélességű marad, nem nyúlik ki.
 *
 * A FORRÁS-OLVASÓ ÁLLÍTÁS HATÁRA (lásd `forras-olvaso-allitas-hatara`
 * emlék): ez a spec a STÍLUS-SZÖVEGET méri, nem a renderelt képernyőt --
 * renderelő ehhez a csomaghoz ma nincs. Amit méri: a `modules` konténer
 * `flexWrap: "wrap"`-ot visel (két oszlop, nem egy), a `moduleCard`
 * `width: "48%"`-ot (rögzített fél szélesség, nem `flex: 1`, ami az
 * utolsó, pár nélküli csempét kinyújtaná), és a `moduleText` `flex: 1`-et
 * (ez tolja a nyilat a kártya aljára).
 */
describe("a modul-csempék két oszlopban, függőleges elrendezésben állnak", () => {
  const forras = kodSzoveg(readFileSync(HOME_SCREEN, "utf8"));

  it("a modulok konténere sortörő rácsot ad, nem egy oszlopot", () => {
    const blokk = forras.match(/modules:\s*\{[^}]*\}/)?.[0];
    assert.ok(blokk, "nem találom a `modules` stílust");
    assert.match(blokk!, /flexWrap:\s*"wrap"/);
  });

  it("a csempe rögzített fél szélességű, nem `flex: 1`", () => {
    const blokk = forras.match(/moduleCard:\s*\{[^}]*\}/)?.[0];
    assert.ok(blokk, "nem találom a `moduleCard` stílust");
    assert.match(blokk!, /width:\s*"48%"/);
    assert.doesNotMatch(
      blokk!,
      /flex:\s*1/,
      "a moduleCard flex: 1-et visel, ami az utolsó, pár nélküli csempét kinyújtaná",
    );
  });

  it("a szöveg-blokk `flex: 1`-et visel, ami a nyilat a kártya aljára tolja", () => {
    const blokk = forras.match(/moduleText:\s*\{[^}]*\}/)?.[0];
    assert.ok(blokk, "nem találom a `moduleText` stílust");
    assert.match(blokk!, /flex:\s*1/);
  });
});

/**
 * BALÁZS MÁSODIK KÉPE, 2026-09-25 18:51 -- kilenc elemenkénti eltérés a
 * kiment kezdőlap és a terv között (exchange/kezdolap-telefon-2026-09-25-1851.png
 * kontra exchange/kezdolap-terv-2026-09-25.png). Ez a blokk azokat az
 * állításokat méri, amik forrás-szövegből ellenőrizhetők: a doboz nélküli
 * ikon, a jelvény külön sora, a szürke nyíl/címke színek.
 */
describe("a kezdőlap a második képernyőfotó-kör elemenkénti javításait viseli", () => {
  const forras = kodSzoveg(readFileSync(HOME_SCREEN, "utf8"));

  it("a modul-ikonnak nincs saját (moduleCode) doboza többé", () => {
    assert.doesNotMatch(
      forras,
      /moduleCode:\s*\{/,
      "a moduleCode stílus még mindig létezik: az ikon dobozban áll, a terv puszta emojit ad",
    );
  });

  it("a szerepkör-jelvény saját sorban, balra igazítva áll", () => {
    const blokk = forras.match(/roleBadge:\s*\{[^}]*\}/)?.[0];
    assert.ok(blokk, "nem találom a `roleBadge` stílust");
    assert.match(
      blokk!,
      /alignSelf:\s*"flex-start"/,
      "a roleBadge nem flex-start, tehát nem saját tartalom-szélességű sorban áll",
    );
  });

  it("a nyíl és a szerepkör-jelvény nem az akcent-színt viseli", () => {
    const nyilBlokk = forras.match(/moduleArrow:\s*\{[^}]*\}/)?.[0];
    assert.ok(nyilBlokk, "nem találom a `moduleArrow` stílust");
    assert.doesNotMatch(nyilBlokk!, /t\.accent\b/);
    const jelvenyBlokk = forras.match(/roleBadgeText:\s*\{[^}]*\}/)?.[0];
    assert.ok(jelvenyBlokk, "nem találom a `roleBadgeText` stílust");
    assert.doesNotMatch(jelvenyBlokk!, /t\.accentSoftText\b/);
  });
});

describe("a kezdőlap fejléce balra igazított címet és beállítás-gombot visel", () => {
  const forras = kodSzoveg(
    readFileSync(join("src", "app", "_layout.tsx"), "utf8"),
  );

  it("az index képernyő fejléce balra igazított és headerRight-ot ad", () => {
    const blokk = forras.match(/<Stack\.Screen\s+name="index"[\s\S]*?\/>/)?.[0];
    assert.ok(blokk, "nem találom az index Stack.Screen-t");
    assert.match(blokk!, /headerTitleAlign:\s*"left"/);
    assert.match(blokk!, /headerRight:/);
  });
});
