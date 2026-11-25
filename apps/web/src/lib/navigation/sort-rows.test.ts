import { describe, expect, it } from "vitest";

import { sortRows } from "./sort-rows";

/**
 * A KLIENSOLDALI RENDEZÉS. Mi pirosít: ha a szám szövegként rendeződik ("250" az "1000" után); ha a számjegyek nem számként ("N-2" a
 * "N-10" előtt); ha az ékezetes betű a Z után áll; ha az üres érték csökkenőben az elejére kerül; ha az egyenlő sorok felcserélődnek;
 * ha az ismeretlen oszlop vagy a nincs rendezés megváltoztatja a sorrendet; ha az eredeti tömb módosul.
 */
type Row = {
  id: string;
  n: string;
  name: string;
  amount: number | null;
  day: string | null;
};
const rows: Row[] = [
  { id: "a", n: "N-10", name: "Zita", amount: 1000, day: "2026-09-02" },
  { id: "b", n: "N-2", name: "Ábel", amount: 250, day: "2026-09-03" },
  { id: "c", n: "N-1", name: "Béla", amount: null, day: null },
  { id: "d", n: "N-3", name: "Béla", amount: 250, day: "2026-09-03" },
];
const getters = {
  n: (r: Row) => r.n,
  name: (r: Row) => r.name,
  amount: (r: Row) => r.amount,
  day: (r: Row) => (r.day ? new Date(`${r.day}T00:00:00Z`) : null),
};
const ids = (list: readonly Row[]) => list.map((r) => r.id).join("");

describe("sortRows", () => {
  it("keeps the given order without a sort or for a column with no getter, and does not touch the input", () => {
    const copy = [...rows];
    expect(ids(sortRows(rows, null, getters))).toBe("abcd");
    expect(ids(sortRows(rows, { id: "nope", direction: "asc" }, getters))).toBe(
      "abcd",
    );
    expect(rows).toEqual(copy);
  });

  it("sorts numbers as numbers, an empty value last in both directions, equal rows keeping their order", () => {
    expect(
      ids(sortRows(rows, { id: "amount", direction: "asc" }, getters)),
    ).toBe("bdac");
    expect(
      ids(sortRows(rows, { id: "amount", direction: "desc" }, getters)),
    ).toBe("abdc");
  });

  it("sorts the digits in text as numbers and accented letters with their plain ones", () => {
    expect(ids(sortRows(rows, { id: "n", direction: "asc" }, getters))).toBe(
      "cbda",
    );
    expect(ids(sortRows(rows, { id: "name", direction: "asc" }, getters))).toBe(
      "bcda",
    );
  });

  it("sorts dates by time, the empty one last", () => {
    expect(ids(sortRows(rows, { id: "day", direction: "asc" }, getters))).toBe(
      "abdc",
    );
    expect(ids(sortRows(rows, { id: "day", direction: "desc" }, getters))).toBe(
      "bdac",
    );
  });
});
