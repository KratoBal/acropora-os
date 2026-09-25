import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  describeSelectableAssets,
  describeWorksheetAssetsReadOnly,
  toggleWorksheetAsset,
  worksheetAssetsChanged,
} from "./worksheet-assets";

/** A FORRÁSFÁT olvassa; a `test-dist`-ben `.tsx` fájl nincs is. */
const KEPERNYO = join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "worksheets",
  "[id].tsx",
);

function kepernyo(): string {
  try {
    return readFileSync(KEPERNYO, "utf8");
  } catch {
    throw new Error(
      `Nem tudtam elolvasni: ${KEPERNYO}. Ez a KERESÉS hibája, nem a lefedettségé -- az alábbi állítások addig semmit nem mondanak.`,
    );
  }
}

describe("toggleWorksheetAsset", () => {
  it("adds an asset that was not on the list", () => {
    assert.deepEqual(toggleWorksheetAsset(["a"], "b"), ["a", "b"]);
  });

  it("removes an asset that was on it", () => {
    assert.deepEqual(toggleWorksheetAsset(["a", "b"], "a"), ["b"]);
  });

  it("keeps the order and appends at the end", () => {
    assert.deepEqual(toggleWorksheetAsset(["c", "a"], "b"), ["c", "a", "b"]);
  });

  it("does not change the list it was given", () => {
    const eredeti = ["a"];
    toggleWorksheetAsset(eredeti, "b");
    assert.deepEqual(eredeti, ["a"]);
  });
});

describe("worksheetAssetsChanged", () => {
  it("says no when nothing moved", () => {
    assert.equal(worksheetAssetsChanged(["a", "b"], ["a", "b"]), false);
  });

  it("ignores the order, because the server stores a set", () => {
    assert.equal(worksheetAssetsChanged(["b", "a"], ["a", "b"]), false);
  });

  it("sees an added asset", () => {
    assert.equal(worksheetAssetsChanged(["a", "b"], ["a"]), true);
  });

  it("sees a removed asset", () => {
    assert.equal(worksheetAssetsChanged(["a"], ["a", "b"]), true);
  });

  it("sees clearing the whole list", () => {
    assert.equal(worksheetAssetsChanged([], ["a"]), true);
  });

  it("is not fooled by a repeated id", () => {
    assert.equal(worksheetAssetsChanged(["a", "a"], ["a"]), false);
  });
});

describe("describeSelectableAssets", () => {
  it("says nothing when there is a list to show", () => {
    assert.equal(
      describeSelectableAssets({ loading: false, error: false, count: 3 }),
      null,
    );
  });

  it("tells the loading and the failed case apart", () => {
    const tolt = describeSelectableAssets({
      loading: true,
      error: false,
      count: 0,
    });
    const hiba = describeSelectableAssets({
      loading: false,
      error: true,
      count: 0,
    });
    const ures = describeSelectableAssets({
      loading: false,
      error: false,
      count: 0,
    });
    assert.notEqual(tolt, hiba);
    assert.notEqual(hiba, ures);
    assert.notEqual(tolt, ures);
    assert.match(ures ?? "", /nincs felvett eszköz/);
    assert.doesNotMatch(hiba ?? "", /nincs felvett eszköz/);
  });

  it("prefers the failure over the loading state", () => {
    assert.equal(
      describeSelectableAssets({ loading: true, error: true, count: 0 }),
      describeSelectableAssets({ loading: false, error: true, count: 0 }),
    );
  });
});

describe("describeWorksheetAssetsReadOnly", () => {
  it("says nothing to somebody who may edit", () => {
    assert.equal(describeWorksheetAssetsReadOnly(true), null);
  });

  it("says why the control is missing for a viewer", () => {
    const mondat = describeWorksheetAssetsReadOnly(false) ?? "";
    assert.match(mondat, /iroda/);
    assert.match(mondat, /látszik/);
  });
});

describe("az érintett eszközök a képernyőn", () => {
  it("POZITÍV KONTROLL: a képernyő olvasható és nem üres", () => {
    assert.ok(kepernyo().length > 2000, "a képernyő üres vagy gyanúsan rövid");
  });

  /**
   * UGYANAZ A MÉRÉS, MINT A FELELŐSÖKNÉL: a szerver az eszköz-listát sem köti
   * állapothoz (`setAssets`), mert a `WorksheetAsset` a MUNKALAPHOZ kötődik,
   * nem a verzióhoz.
   */
  it("az eszköz-választás nincs piszkozat-állapothoz kötve", () => {
    assert.doesNotMatch(
      kepernyo(),
      /assetDraft[\s\S]{0,400}?current\.status === "DRAFT"/,
      "az eszköz-választás piszkozat-feltételt kapott: a szerver ennél többet enged",
    );
  });

  it("a képernyő kimondja, miért nincs gombja annak, aki csak nézhet", () => {
    assert.match(
      kepernyo(),
      /<Text[^>]*>\{readOnlyAssetsNotice\}<\/Text>/,
      "a mondat nincs kirajzolva: a hiányzó gomb oka némán tűnne el",
    );
  });

  it("a képernyő kimondja, hogy a mentés a teljes eszköz-listát írja felül", () => {
    const forras = kepernyo();
    assert.match(forras, /Mentés után pontosan ez a/);
    assert.match(forras, /nem lesz érintett eszköze/);
  });
});
