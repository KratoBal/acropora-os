import { describe, expect, it } from "vitest";

import {
  UNIT_FILTER_PARAM,
  readUnitFilter,
  toggleUnitFilter,
  writeUnitFilter,
} from "./unit-filter";

const params = (search: string) => new URLSearchParams(search);

describe("readUnitFilter", () => {
  it("üres címsorból üres halmaz", () => {
    expect(readUnitFilter(params(""))).toEqual([]);
    expect(readUnitFilter(params("departmentIds="))).toEqual([]);
  });

  /** A szerver mindkét alakot elfogadja, tehát a címsor is jöhet bárhonnan. */
  it("vesszős és ismételt alakot is olvas", () => {
    expect(readUnitFilter(params("departmentIds=a,b"))).toEqual(["a", "b"]);
    expect(readUnitFilter(params("departmentIds=a&departmentIds=b"))).toEqual([
      "a",
      "b",
    ]);
  });

  /**
   * A DUPLIKÁTUM NEM ÁRTALMATLAN: a szerver `in` szűrőt épít belőle, és egy
   * kétszer szereplő azonosító ugyan nem hoz több sort, de a cím hosszabb lesz,
   * és a választó két bepipált sort mutatna ugyanarra.
   */
  it("ismétlődést és üres darabot kiszűr", () => {
    expect(readUnitFilter(params("departmentIds=a,,a,b"))).toEqual(["a", "b"]);
  });
});

describe("writeUnitFilter", () => {
  it("üres halmaz TÖRLI a paramétert, nem üres értéket ír", () => {
    const next = writeUnitFilter(params("departmentIds=a&status=ACTIVE"), []);
    expect(next.has(UNIT_FILTER_PARAM)).toBe(false);
    expect(next.get("status")).toBe("ACTIVE");
  });

  it("a többi szűrőt érintetlenül hagyja", () => {
    const next = writeUnitFilter(
      params("status=ACTIVE&ownerId=sup-1&search=szivattyu"),
      ["a", "b"],
    );
    expect(next.get(UNIT_FILTER_PARAM)).toBe("a,b");
    expect(next.get("ownerId")).toBe("sup-1");
    expect(next.get("search")).toBe("szivattyu");
  });

  /**
   * A LAPOZÁS VISSZAÁLL AZ ELSŐRE. Egy szűkített lista harmadik oldala üres
   * lehet, és a felhasználó üres képernyőt látna anélkül, hogy bármi megmondaná,
   * miért -- ugyanaz a szabály, mint a lista többi szűrőjénél.
   */
  it("a lapozást visszaállítja az elsőre", () => {
    expect(writeUnitFilter(params("page=3"), ["a"]).get("page")).toBe("1");
    expect(writeUnitFilter(params("page=3"), []).get("page")).toBe("1");
  });

  it("oda-vissza ugyanazt a halmazt adja", () => {
    const written = writeUnitFilter(params(""), ["b", "a", "b"]);
    expect(readUnitFilter(written)).toEqual(["b", "a"]);
  });
});

describe("toggleUnitFilter", () => {
  it("hozzáad, ha nincs benne, és elvesz, ha benne van", () => {
    expect(toggleUnitFilter([], "a")).toEqual(["a"]);
    expect(toggleUnitFilter(["a", "b"], "a")).toEqual(["b"]);
  });

  /** A többi választás megmarad: ez a „halmaz, nem egy érték" lényege. */
  it("a többi választást megtartja", () => {
    expect(toggleUnitFilter(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });
});
