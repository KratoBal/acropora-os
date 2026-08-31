import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeFillState, measureFillState } from "./datasheet-fill-state.js";
import { runDatasheetFillStateCli } from "./datasheet-fill-state.cli.js";

const sheet = (id: string, genus: string | null, species: string | null) => ({
  id,
  genus,
  species,
});

function capture() {
  const lines: string[] = [];
  return {
    lines,
    out: {
      stdout: (value: string) => lines.push(value),
      stderr: (value: string) => lines.push(value),
    },
  };
}

describe("measureFillState", () => {
  it("counts a filled genus as groupable", () => {
    const state = measureFillState([sheet("a", "Acropora", "millepora")]);
    assert.equal(state.groupable, 1);
    assert.deepEqual(state.missingGenus, []);
  });

  it("names the sheets where the genus is missing", () => {
    const state = measureFillState([
      sheet("a", "Acropora", "millepora"),
      sheet("b", null, null),
      sheet("c", "   ", null),
    ]);
    assert.deepEqual(state.missingGenus, ["b", "c"]);
    assert.equal(state.groupable, 1);
  });

  /**
   * EZ A MÉRŐ LÉTEZÉSÉNEK A FŐ OKA. Három sor EGY nemzetségről szól, a gép
   * mégis háromnak látja - és ma semmi nem szól érte: nincs egyediségi
   * megkötés és nincs normalizáló.
   */
  it("finds a genus that is spelled several ways", () => {
    const state = measureFillState([
      sheet("a", "Acropora", "millepora"),
      sheet("b", "acropora", "tenuis"),
      sheet("c", "Acropora ", null),
    ]);
    assert.equal(state.inconsistentGenus.length, 1);
    assert.equal(state.inconsistentGenus[0]?.canonical, "acropora");
    assert.deepEqual(state.inconsistentGenus[0]?.spellings, [
      "Acropora",
      "Acropora ",
      "acropora",
    ]);
  });

  /**
   * A GENUS-SZINTŰ SOR NEM HIÁNY, ÉS EZT KÜLÖN SZÁMOLJUK. Ha hiányként
   * számolnánk, a mérő a helyesen kitöltött adatlapokat is sürgetné.
   */
  it("counts a genus-level row separately, not as a gap", () => {
    const state = measureFillState([sheet("a", "Acropora", null)]);
    assert.equal(state.groupable, 1);
    assert.equal(state.genusLevelOnly, 1);
    assert.deepEqual(state.missingGenus, []);
  });
});

describe("the fill-state report", () => {
  it("always states the two numbers, even when everything is fine", () => {
    const text = describeFillState(
      measureFillState([sheet("a", "Acropora", "millepora")]),
    );
    assert.match(text, /1 adatlap, ebből 1 csoportosítható/);
  });

  /**
   * A SZÖVEG NEM „HIBA" SZÓVAL BESZÉL, és ez mérhető: a jelentés a
   * nemzetség-szintű sorokról kimondja, hogy NEM hiányos kitöltés. Enélkül a
   * futtatója megtanulná figyelmen kívül hagyni a kimenetet.
   */
  it("says out loud that a genus-level row is not a gap", () => {
    const text = describeFillState(
      measureFillState([sheet("a", "Acropora", null)]),
    );
    assert.match(text, /NEM hiányos kitöltés/);
    assert.match(text, /soha nem/i);
  });
});

describe("the fill-state command", () => {
  it("exits 0 when every sheet can be grouped", async () => {
    const { out } = capture();
    const code = await runDatasheetFillStateCli(out, async () => [
      sheet("a", "Acropora", "millepora"),
    ]);
    assert.equal(code, 0);
  });

  it("exits 1 for a missing genus, and names the sheet", async () => {
    const { lines, out } = capture();
    const code = await runDatasheetFillStateCli(out, async () => [
      sheet("a", null, null),
    ]);
    assert.equal(code, 1);
    assert.match(lines.join(""), /NINCS genus/);
  });

  it("exits 1 for an inconsistently spelled genus", async () => {
    const { out } = capture();
    const code = await runDatasheetFillStateCli(out, async () => [
      sheet("a", "Acropora", null),
      sheet("b", "acropora", null),
    ]);
    assert.equal(code, 1);
  });

  /**
   * A 2-ES KÜLÖN ÁLL, ugyanabból az okból, mint az audit-nál: egy elérhetetlen
   * adatbázis nem ugyanaz, mint egy hibátlanul kitöltött. Ha a két eset közös
   * nem-nulla kódot adna, egy hálózati hiba úgy nézne ki, mint egy lelet.
   */
  it("exits 2 when the query itself fails, not 1", async () => {
    const { lines, out } = capture();
    const code = await runDatasheetFillStateCli(out, async () => {
      throw new Error("nincs kapcsolat");
    });
    assert.equal(code, 2);
    assert.match(lines.join(""), /nem \nx?tudjuk|nem tudjuk/);
  });
});
