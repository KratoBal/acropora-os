import { describe, expect, it } from "vitest";

import {
  BULK_SELECTION_MAX,
  bulkSummary,
  pageSelection,
  toggleSelected,
  togglePage,
} from "./worksheet-bulk";

/**
 * A TÖBBES KIJELÖLÉS SEGÉDEI (kártya a785e580). MI PIROSÍT: ha a kapcsoló nem fordít (második kattintás nem
 * vesz ki); ha az 50. fölé be lehet jelölni; ha az „oldal mind" kapcsoló a már kijelölt más oldalit is törölné;
 * ha a részleges kijelölés „mind"-nek látszik; ha a kimaradt lap sorszáma vagy a sorszám nélküliek száma
 * eltűnne az összefoglalóból.
 */
const ids = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `w${from + i}`);

describe("toggleSelected", () => {
  it("bejelöl, majd a második kattintás kiveszi; az eredeti halmazt nem módosítja", () => {
    const start = new Set<string>();
    const on = toggleSelected(start, "a");
    expect([...on.selected]).toEqual(["a"]);
    expect(start.size).toBe(0);
    expect(toggleSelected(on.selected, "a").selected.size).toBe(0);
  });

  it("az 50. fölé nem megy, és jelzi, hogy a határ állította meg; a kivétel a teljes halmazon is megy", () => {
    const full = new Set(ids(BULK_SELECTION_MAX));
    const blocked = toggleSelected(full, "extra");
    expect(blocked.full).toBe(true);
    expect(blocked.selected.size).toBe(BULK_SELECTION_MAX);
    expect(toggleSelected(full, "w0").selected.size).toBe(
      BULK_SELECTION_MAX - 1,
    );
  });
});

describe("togglePage", () => {
  it("az oldal mind kijelölve: a második kapcsolás csak az oldal lapjait törli, a más oldaliakat nem", () => {
    const page = ids(3, 10);
    const other = new Set(["x1", "x2"]);
    const all = togglePage(other, page);
    expect(all.selected.size).toBe(5);
    const none = togglePage(all.selected, page);
    expect([...none.selected].sort()).toEqual(["x1", "x2"]);
  });

  it("részleges kijelölésből mindet bejelöli", () => {
    const page = ids(3);
    expect(togglePage(new Set(["w1"]), page).selected.size).toBe(3);
  });

  it("az 50-es határnál megáll, és jelzi", () => {
    const selected = new Set(ids(48, 100));
    const result = togglePage(selected, ids(5));
    expect(result.selected.size).toBe(BULK_SELECTION_MAX);
    expect(result.full).toBe(true);
  });

  it("üres oldalnál nem történik semmi", () => {
    expect(togglePage(new Set(["a"]), []).selected.size).toBe(1);
  });
});

describe("pageSelection", () => {
  it("none, some, all", () => {
    const page = ids(3);
    expect(pageSelection(new Set(), page)).toBe("none");
    expect(pageSelection(new Set(["w0"]), page)).toBe("some");
    expect(pageSelection(new Set(page), page)).toBe("all");
    expect(pageSelection(new Set(["other"]), page)).toBe("none");
  });
});

describe("bulkSummary", () => {
  it("kihagyott nélkül csak a fejmondat", () => {
    expect(
      bulkSummary({
        action: "download",
        included: 3,
        skipped: 0,
        skippedNumbers: [],
      }),
    ).toBe("A zip 3 munkalap PDF-jét tartalmazza.");
    expect(
      bulkSummary({
        action: "print",
        included: 2,
        skipped: 0,
        skippedNumbers: [],
      }),
    ).toBe("A nyomtatható PDF 2 munkalapot tartalmaz.");
  });

  it("a kihagyott lapokat sorszámmal, a sorszám nélkülieket számmal nevezi meg", () => {
    expect(
      bulkSummary({
        action: "download",
        included: 2,
        skipped: 3,
        skippedNumbers: ["ML-2", "ML-5"],
      }),
    ).toBe(
      "A zip 2 munkalap PDF-jét tartalmazza. 3 lapnak még nincs kiadott PDF-je, kimaradt: ML-2, ML-5 és 1 sorszám nélküli.",
    );
    expect(
      bulkSummary({
        action: "download",
        included: 1,
        skipped: 2,
        skippedNumbers: [],
      }),
    ).toContain("kimaradt: 2 sorszám nélküli.");
  });
});
