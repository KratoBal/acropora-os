import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildUnitOptions,
  selectableUnitOptions,
  unitPathLabel,
  type PartnerUnitLike,
} from "./site-tree";

/**
 * AZ AZONOS NEVŰ TESTVÉR-ÁGAK A TÉT.
 *
 * A helyszín kódja és neve csak testvérek között egyedi, tehát két távoli ág
 * alatt ugyanaz a „Biodóm (BIO)" megengedett. Egy lapos listában a puszta név
 * ilyenkor két különböző helyszínre ugyanazt a sort adja, és a szerelő úgy
 * választ rosszat, hogy semmi nem jelzi neki: van miben tévedni.
 */

const units: PartnerUnitLike[] = [
  { id: "root", parentId: null, code: "FANK", name: "Fánk", isActive: true },
  { id: "bio", parentId: "root", code: "BIO", name: "Biodóm", isActive: true },
  {
    id: "pp",
    parentId: "root",
    code: "APP",
    name: "PP Üzemeltetés",
    isActive: true,
  },
  {
    id: "bio-deep",
    parentId: "pp",
    code: "BIO",
    name: "Biodóm",
    isActive: false,
  },
];

describe("buildUnitOptions", () => {
  it("tells two same-named branches apart by their whole path", () => {
    const labels = buildUnitOptions(units).map((option) => option.label);

    assert.ok(labels.includes("Fánk / Biodóm (BIO)"));
    assert.ok(labels.includes("Fánk / PP Üzemeltetés / Biodóm (BIO)"));
  });

  it("walks the tree from the root down, siblings by code", () => {
    assert.deepEqual(
      buildUnitOptions(units).map((option) => option.id),
      ["root", "pp", "bio-deep", "bio"],
    );
  });

  it("carries the active flag through, so the screen can mark what is retired", () => {
    const deep = buildUnitOptions(units).find(
      (option) => option.id === "bio-deep",
    );
    assert.equal(deep?.isActive, false);
  });

  /**
   * A HIÁNYZÓ SZÜLŐ nem tünteti el a sort. Egy szűrt vagy félig betöltött válasz
   * után a lista rövidebb lenne, és semmi nem mondaná meg, hogy hiányzik belőle
   * valami -- pontosan az a hibaosztály, ami nem hibásnak látszik.
   */
  it("keeps a unit whose parent is not in the list", () => {
    const options = buildUnitOptions([
      {
        id: "orphan",
        parentId: "nincs",
        code: "X",
        name: "Árva",
        isActive: true,
      },
    ]);

    assert.equal(options.length, 1);
    assert.equal(options[0]?.label, "Árva (X)");
  });

  /** A KÖR sem végtelen ciklus, hanem rövidebb út. */
  it("survives a cycle in the data", () => {
    const options = buildUnitOptions([
      { id: "a", parentId: "b", code: "A", name: "A", isActive: true },
      { id: "b", parentId: "a", code: "B", name: "B", isActive: true },
    ]);

    assert.equal(options.length, 2);
    for (const option of options) assert.ok(option.label.length > 0);
  });

  it("gives an empty list for an empty tree, not a crash", () => {
    assert.deepEqual(buildUnitOptions([]), []);
  });
});

describe("unitPathLabel", () => {
  it("joins the path the server already built", () => {
    assert.equal(
      unitPathLabel({ name: "Biodóm", path: ["Fánk", "PP", "Biodóm"] }),
      "Fánk / PP / Biodóm",
    );
  });

  /**
   * VISSZAESÉS, ha az út hiányzik (régebbi szerver, szűrt válasz): kevesebb, de
   * igaz. Üres felirat helyén a szerelő azt hinné, nincs megadva a helyszín.
   */
  it("falls back to the name when there is no path", () => {
    assert.equal(unitPathLabel({ name: "Biodóm" }), "Biodóm");
    assert.equal(unitPathLabel({ name: "Biodóm", path: [] }), "Biodóm");
    assert.equal(unitPathLabel({ name: "Biodóm", path: ["  "] }), "Biodóm");
  });
});

describe("selectableUnitOptions", () => {
  /**
   * A KIVEZETETT HELYSZÍNT A SZERVER ELUTASÍTJA (`INACTIVE`). Felkínálni csapda:
   * a szerelő kiválasztja, kitölti az űrlapot, és a mentés végén kap egy
   * elutasítást arról, amit a lista maga ajánlott.
   */
  it("keeps the retired units out of the picker", () => {
    const { options } = selectableUnitOptions(units);

    assert.deepEqual(
      options.map((option) => option.id),
      ["root", "pp", "bio"],
    );
  });

  /**
   * DE NEM NÉMÁN. Aki tudja, hogy négy helyszín van, és hármat lát, a listát
   * fogja hibásnak hinni -- vagy rosszat választ a maradékból.
   */
  it("counts what it left out, so the screen can say so", () => {
    assert.equal(selectableUnitOptions(units).hiddenCount, 1);
    assert.equal(selectableUnitOptions([]).hiddenCount, 0);
  });
});
