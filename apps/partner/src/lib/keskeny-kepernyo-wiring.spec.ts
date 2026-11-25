import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * KESKENY KÉPERNYŐN SEMMI NEM TOLJA KI A LAPOT (partner-hibakör, 2026-11-20, 390 px):
 *   - a munkalap-lista státusz-fülei nem fértek el, 102 px-szel kilógtak;
 *   - az eszközlista szűrősora (kereső, helyszín, felső lapozó) nem tört, 161 px-szel kilógott.
 * A fülek a saját sorukban gördülnek, ahogy az eszközlistán már eddig is; a szűrősor törik.
 *
 * A HATÁR: forrást olvas (a csomagban nincs renderelő, lásd portal-wiring.spec.ts); a valódi bizonyíték a hibakör 390 px-es
 * kilógás-mérése (`partner-hibakor-stage.mjs`). MI PIROSIT: a fülek sorából lekerül a görgetés, vagy a szűrősorból a törés.
 * A minta a sor egyedi szomszédjára illeszt (a fülek `TABS.map`-je, a kereső `max-w-sm` doboza), nem egy puszta osztálynévre.
 */
const MUNKALAPOK = readFileSync("src/components/worksheet-list.tsx", "utf8");
const ESZKOZOK = readFileSync("src/components/asset-list.tsx", "utf8");

describe("keskeny képernyő: a partner-listák sorai", () => {
  it("a munkalap-lista státusz-fülei a saját sorukban gördülnek", () => {
    assert.match(
      MUNKALAPOK,
      /<div className="[^"]*\boverflow-x-auto\b[^"]*">\s*\{TABS\.map\(/,
    );
  });

  it("az eszközlista szűrősora törik (kereső, helyszín, felső lapozó)", () => {
    assert.match(
      ESZKOZOK,
      /<div className="[^"]*\bflex-wrap\b[^"]*">\s*<div className="relative max-w-sm flex-1">/,
    );
  });
});

/**
 * TELEFONON MENÜ ÉS KÁRTYALISTA (picasso képernyő-leltára, 2026-11-25, f0b70dbd, 390 px): a portálon `lg` alatt nem volt menü,
 * és a hibajegy-lista 720 px-es táblája jobbra kifutott. MI PIROSIT: a felső sáv menügombja nem az oldalsávot nyitja (más
 * azonosító, vagy az oldalsáv `lg` alatt nem válik láthatóvá a nyitott állapotban); a hibajegy-tábla `md` alatt nem vált
 * blokk-elrendezésre, vagy a fejléce látható marad.
 */
const HEJ = readFileSync("src/components/portal-shell.tsx", "utf8");
const HIBAJEGYEK = readFileSync("src/components/ticket-list.tsx", "utf8");

describe("keskeny képernyő: menü és hibajegy-kártyák", () => {
  it("a felső sáv gombja az oldalsávot nyitja, és nyitva az lg alatt is látszik", () => {
    assert.match(
      HEJ,
      /aria-expanded=\{menuOpen\}\s*aria-controls="partner-menu"/,
    );
    assert.match(HEJ, /<aside\s+id="partner-menu"/);
    assert.match(HEJ, /menuOpen \? "z-50 flex shadow-2xl" : "z-30 hidden"/);
  });

  it("a hibajegy-tábla md alatt kártyalista, a fejléce csak a képernyőolvasóé", () => {
    assert.match(
      HIBAJEGYEK,
      /<table className="[^"]*\bmax-md:block\b[^"]*\bmd:min-w-\[720px\][^"]*">\s*<thead className="max-md:sr-only">/,
    );
  });
});
