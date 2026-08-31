import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectUnitSubtreeIds } from "./unit-subtree.js";
import type { UnitRow } from "./unit-path.js";

/** Fánk -> Biodóm -> Nagy főkamedence, plusz egy testvér ág. */
const units: readonly UnitRow[] = [
  { id: "fank", name: "Fánk", parentId: null },
  { id: "bio", name: "Biodóm", parentId: "fank" },
  { id: "fnm", name: "Nagy főkamedence", parentId: "bio" },
  { id: "quarantine", name: "Karantén", parentId: "bio" },
  { id: "shop", name: "Bolt", parentId: "fank" },
  { id: "korall", name: "Korallszirt", parentId: null },
  { id: "korall-bio", name: "Biodóm", parentId: "korall" },
];

describe("collectUnitSubtreeIds", () => {
  it("includes the node itself", () => {
    assert.deepEqual(collectUnitSubtreeIds(units, "fnm"), ["fnm"]);
  });

  /**
   * EZ A TESZT AZ EGÉSZ FÜGGVÉNY LÉTEZÉSÉNEK AZ OKA. Pontos egyezéssel a
   * Biodómra kérdezve a `fnm` és a `quarantine` eszközei kimaradnának, és a
   * válasz attól még szabályos listának látszana.
   */
  it("reaches every level below the node, not just its direct children", () => {
    const ids = collectUnitSubtreeIds(units, "bio");
    assert.deepEqual([...ids].sort(), ["bio", "fnm", "quarantine"]);
  });

  it("does not cross into a sibling branch", () => {
    const ids = collectUnitSubtreeIds(units, "bio");
    assert.equal(ids.includes("shop"), false);
  });

  /**
   * A fa lényege, hogy két ág alatt ugyanaz a KÓD megengedett (lásd ADR-010).
   * A másik ág azonos nevű csomópontja tehát nem kerülhet bele.
   */
  it("keeps two same-named nodes on different branches apart", () => {
    assert.deepEqual(collectUnitSubtreeIds(units, "korall"), [
      "korall",
      "korall-bio",
    ]);
  });

  /**
   * ISMERETLEN AZONOSÍTÓ: egyetlen elem, nem üres lista. Az üres lista a
   * hívónál `{ in: [] }` helyett üres szűrővé olvadhatna, ami a TELJES listát
   * adná vissza -- pontosan az a néma ág, amit el akarunk kerülni.
   */
  it("returns the unknown id alone rather than nothing", () => {
    assert.deepEqual(collectUnitSubtreeIds(units, "nincs-ilyen"), [
      "nincs-ilyen",
    ]);
  });

  it("stops on a cycle instead of looping forever", () => {
    const broken: readonly UnitRow[] = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    assert.deepEqual([...collectUnitSubtreeIds(broken, "a")].sort(), [
      "a",
      "b",
    ]);
  });
});
