import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildUnitPaths, sharedAncestor } from "./unit-path.js";

describe("the unit's full path", () => {
  /**
   * A KÉRT NEGATÍV KONTROLL: ha az út a LEVÉL NEVÉT adja vissza a teljes út
   * helyett, ennek pirosra kell váltania. A listán ezt nem lehetett megírni --
   * ott nem volt mihez hasonlítani --, itt viszont van.
   *
   * A bemenet pontosan az az eset, amiért az egész mező készül: KÉT távoli ág
   * alatt UGYANAZ a név. A levél neve önmagában mindkettőre ugyanazt adná.
   */
  it("names every ancestor, so two same-named units differ", () => {
    const paths = buildUnitPaths([
      { id: "fank", name: "Fankó", parentId: null },
      { id: "korall", name: "Korallszirt", parentId: null },
      { id: "bio-1", name: "Biodóm", parentId: "fank" },
      { id: "bio-2", name: "Biodóm", parentId: "korall" },
    ]);

    assert.deepEqual(paths.get("bio-1"), ["Fankó", "Biodóm"]);
    assert.deepEqual(paths.get("bio-2"), ["Korallszirt", "Biodóm"]);
    assert.notDeepEqual(paths.get("bio-1"), paths.get("bio-2"));
  });

  /**
   * A MÉLY FA VÉGIG FELÉPÜL. Ez azért külön állítás, mert a kézenfekvő
   * megvalósítás (rögzített mélységű `include`) pont itt vágna csendben: a
   * fának NINCS mélység-korlátja, tehát egy három szintre írt lekérdezés a
   * negyediket elhagyná, és a hiba a hosszú útnál jelenne meg először.
   */
  it("walks a deep tree all the way to the root", () => {
    const paths = buildUnitPaths([
      { id: "a", name: "Fankó", parentId: null },
      { id: "b", name: "Biodóm", parentId: "a" },
      { id: "c", name: "Nagy főkamedence", parentId: "b" },
      { id: "d", name: "Szűrőgépház", parentId: "c" },
    ]);

    assert.deepEqual(paths.get("d"), [
      "Fankó",
      "Biodóm",
      "Nagy főkamedence",
      "Szűrőgépház",
    ]);
  });

  it("keeps a root unit's path to its own name", () => {
    const paths = buildUnitPaths([{ id: "a", name: "Fankó", parentId: null }]);

    assert.deepEqual(paths.get("a"), ["Fankó"]);
  });

  /** Hiányzó szülőnél sem tűnhet el a sor: rövidebb utat kap, de van útja. */
  it("stops at a parent that is not in the batch", () => {
    const paths = buildUnitPaths([
      { id: "b", name: "Biodóm", parentId: "ismeretlen" },
    ]);

    assert.deepEqual(paths.get("b"), ["Biodóm"]);
  });

  /** Kör esetén megáll: egy hibás adat ne fagyassza le a lekérdezést. */
  it("stops on a cycle instead of looping", () => {
    const paths = buildUnitPaths([
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ]);

    assert.deepEqual(paths.get("a"), ["B", "A"]);
    assert.deepEqual(paths.get("b"), ["A", "B"]);
  });
});

/*
  A KÖZÖS FELSŐ HELYSZÍN (kártya 1806e061). MI PIROSÍT: ha a legalsó helyett
  egy feljebb álló közös őst adna; ha a megnevezett egység maga nem lehetne a
  közös helyszín; ha két külön gyökér vagy egy ismeretlen egység közös ősnek
  látszana; ha egy kör végtelen ciklust adna.
*/
describe("sharedAncestor", () => {
  const units = [
    { id: "zoo", name: "Állatkert", parentId: null },
    { id: "capasuli", name: "Cápasuli", parentId: "zoo" },
    { id: "karanten", name: "Karantén medence", parentId: "capasuli" },
    { id: "nagymedence", name: "Nagymedence", parentId: "capasuli" },
    { id: "trop", name: "Trópusi ház", parentId: "zoo" },
    { id: "other", name: "Másik ügyfél telephelye", parentId: null },
    { id: "loop-a", name: "A", parentId: "loop-b" },
    { id: "loop-b", name: "B", parentId: "loop-a" },
  ];
  it("the lowest shared ancestor, itself included", () => {
    assert.equal(
      sharedAncestor(["karanten", "nagymedence"], units),
      "capasuli",
    );
    assert.equal(sharedAncestor(["capasuli", "karanten"], units), "capasuli");
    assert.equal(sharedAncestor(["karanten", "trop"], units), "zoo");
    assert.equal(sharedAncestor(["karanten"], units), "karanten");
  });
  it("none for separate roots, an unknown unit, or nothing", () => {
    assert.equal(sharedAncestor(["karanten", "other"], units), null);
    assert.equal(sharedAncestor(["karanten", "gone"], units), null);
    assert.equal(sharedAncestor([], units), null);
  });
  it("a cycle stops instead of looping", () => {
    assert.equal(sharedAncestor(["loop-a", "karanten"], units), null);
  });
});
