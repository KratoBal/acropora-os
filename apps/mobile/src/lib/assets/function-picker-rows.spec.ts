import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { functionPickerPlan } from "./function-picker-rows";

const AKTIV = [
  { id: "fun-adagolas", name: "Automata adagolás" },
  { id: "fun-szurees", name: "Mechanikai szűrés" },
];

describe("funkció-választó", () => {
  it("üres értéknél a „Nincs megadva” áll a csukott soron", () => {
    const terv = functionPickerPlan({ options: AKTIV, value: "" });

    assert.equal(terv.summary, "Nincs megadva");
    assert.deepEqual(terv.rows, AKTIV);
  });

  it("választott funkciónál a neve áll ott", () => {
    const terv = functionPickerPlan({ options: AKTIV, value: "fun-szurees" });

    assert.equal(terv.summary, "Mechanikai szűrés");
    assert.equal(terv.rows.length, 2);
  });

  it("kivezetett funkciónál a MOSTANI név áll a csukott soron", () => {
    const terv = functionPickerPlan({
      options: AKTIV,
      value: "fun-regi",
      currentName: "Régi funkció",
    });

    assert.equal(terv.summary, "Régi funkció");
  });

  it("a kivezetett funkció a lista ELEJÉRE kerül, megjelölve", () => {
    const terv = functionPickerPlan({
      options: AKTIV,
      value: "fun-regi",
      currentName: "Régi funkció",
    });

    assert.equal(terv.rows.length, 3);
    assert.deepEqual(terv.rows[0], {
      id: "fun-regi",
      name: "Régi funkció (kivezetett)",
    });
    assert.deepEqual(terv.rows.slice(1), AKTIV);
  });

  it("név nélkül az azonosító áll ott, nem a „Nincs megadva”", () => {
    const terv = functionPickerPlan({ options: AKTIV, value: "fun-regi" });

    assert.equal(terv.summary, "fun-regi");
    assert.notEqual(terv.summary, "Nincs megadva");
  });
});
