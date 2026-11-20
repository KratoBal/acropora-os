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
