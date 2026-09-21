import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasHeaderInjection, headerSafe } from "./mail-header.js";

/*
  A BEMENET FUTASIDOBEN EPUL, NEM A FORRASBAN ALL.

  Egy `\r\n` a forrasba irva LITERALIS vezerlobajtta valhat a fajlban (sajat
  meres, 2026-09-18), es akkor a szerkeszto nem mutatja, a formazo atengedi, a
  sajat Bash-hivasom viszont megall rajta. Ezert a sortorest itt a kod allitja
  elo.
*/
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const NUL = String.fromCharCode(0);

describe("fejlec-injekcio", () => {
  it("a sortorest tartalmazo erteket felismeri", () => {
    assert.equal(
      hasHeaderInjection(`Szivattyú zúg${CR}${LF}Bcc: x@y.hu`),
      true,
    );
    assert.equal(hasHeaderInjection(`csak ${LF} soremeles`), true);
    assert.equal(hasHeaderInjection(`NUL${NUL}bajt`), true);
  });

  /**
   * A LEGKOZELEBBI TEVESZTES: a rendes, ekezetes magyar cim NE bukjon el.
   * Egy tul szeles szuro ugyanugy elveszi az eszkozt, mint egy hianyzo.
   */
  it("a rendes cimet nem tekinti tamadasnak", () => {
    assert.equal(hasHeaderInjection("Szivattyú zúg a nagymedencénél"), false);
    assert.equal(
      hasHeaderInjection("Árvíztűrő tükörfúrógép (3. emelet)"),
      false,
    );
  });

  /**
   * A SORTORES SZOKOZRE VALT, NEM TUNIK EL. Ha torolnenk, ket szo
   * osszeragadna, es a Targy CSENDBEN mast mondana.
   */
  it("a sortorest szokozre valtja, nem torli", () => {
    assert.equal(headerSafe(`Szivattyú${CR}${LF}zúg`), "Szivattyú zúg");
    assert.ok(!headerSafe(`a${LF}b`).includes("ab"));
  });

  it("a megtisztitott ertekben mar nincs injekcio", () => {
    const tamadas = `Szivattyú zúg${CR}${LF}Bcc: idegen@example.com`;
    assert.equal(hasHeaderInjection(headerSafe(tamadas)), false);
    // ES A SZOVEG MEGMARAD: a vedelem nem nemithatja el a Targyat.
    assert.match(headerSafe(tamadas), /Szivattyú zúg/);
  });
});
