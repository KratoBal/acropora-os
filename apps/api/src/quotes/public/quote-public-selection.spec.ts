import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  selectionTotals,
  withAllOptionals,
  type SelectableItem,
} from "./quote-public-selection.js";

const d = (value: string) => new Prisma.Decimal(value);
const line = (
  id: string,
  price: string,
  over: Partial<SelectableItem> = {},
): SelectableItem => ({
  id,
  isOptional: false,
  replacesItemId: null,
  quantity: d("1"),
  unitNetPrice: d(price),
  ...over,
});

/*
  KIVÁLTOTT TÉTEL (card 2540d9d4): a nyilvános oldal végösszege a szerveren, ugyanazzal a döntéssel, mint a megrendelés és a számla. MI PIROSÍT: ha a
  kiváltott tétel benne marad az összegben; ha a ki nem választott opcionális beleszámít; ha a kiváltott helye rossz sorra mutat (az oldal azt húzza át);
  ha a darabszám nem szorzódik; ha az "összes opcionálissal" összeg kiváltás mellett összeadja a kiváltottat is.
*/
const ITEMS = [
  line("a", "1000"),
  line("b", "5000"),
  line("o1", "3000", { isOptional: true, replacesItemId: "b" }),
  line("o2", "700", { isOptional: true }),
];

describe("selectionTotals", () => {
  it("with nothing chosen it is the offered lines' total", () => {
    const r = selectionTotals(ITEMS, []);
    assert.equal(r.net.toString(), "6000");
    assert.deepEqual(r.replacedIndexes, []);
    assert.deepEqual(r.chosenIndexes, []);
  });

  it("a chosen optional line that replaces a line takes its place in the total, and the replaced line's place is named", () => {
    const r = selectionTotals(ITEMS, ["o1"]);
    assert.equal(r.net.toString(), "4000"); // 1000 + 3000, not 6000 + 3000
    assert.deepEqual(r.replacedIndexes, [1]);
    assert.deepEqual(r.chosenIndexes, [2]);
  });

  it("a supplement only adds, an unchosen replacer replaces nothing", () => {
    const r = selectionTotals(ITEMS, ["o2"]);
    assert.equal(r.net.toString(), "6700");
    assert.deepEqual(r.replacedIndexes, []);
    assert.deepEqual(r.chosenIndexes, [3]);
  });

  it("multiplies the quantity", () => {
    const items = [line("a", "250", { quantity: d("4") })];
    assert.equal(selectionTotals(items, []).net.toString(), "1000");
  });
});

describe("withAllOptionals", () => {
  it("is the total with every optional line chosen, replaced lines left out", () => {
    assert.equal(withAllOptionals(ITEMS).net.toString(), "4700"); // 1000 + 3000 + 700
  });
});

/*
  ALTERNATÍVÁK (Luca 2026-11-27): az „összes opcionálissal” összeg csoportonként a legdrágább alternatívát számolja, és a kiválasztott összeg a bejelöltet.
  MI PIROSÍT: ha az „összes” összeg mindkét alternatívát hozzáadja; ha a legolcsóbbat veszi a legdrágább helyett; ha a kiválasztott alternatíva mellett a
  másik is beleszámít a kiválasztás összegébe.
*/
describe("alternatives in the totals", () => {
  const ALT = [
    line("a", "1000"),
    line("b", "5000"),
    line("o1", "3000", { isOptional: true, replacesItemId: "b" }),
    line("o2", "4000", { isOptional: true, replacesItemId: "b" }),
    line("o3", "700", { isOptional: true }),
  ];

  it("with every option chosen the dearest alternative counts, once, and the replaced line drops out", () => {
    const r = withAllOptionals(ALT);
    // 1000 + 4000 + 700, not 1000 + 3000 + 4000 + 700 and not 1000 + 5000 + ...
    assert.equal(r.net.toString(), "5700");
    assert.deepEqual(r.replacedIndexes, [1]);
    assert.deepEqual(r.chosenIndexes, [3, 4]);
  });

  it("a chosen alternative counts alone: the other alternative of the same line adds nothing", () => {
    assert.equal(selectionTotals(ALT, ["o1"]).net.toString(), "4000"); // 1000 + 3000
    assert.equal(selectionTotals(ALT, ["o2"]).net.toString(), "5000"); // 1000 + 4000
    assert.equal(selectionTotals(ALT, ["o2", "o3"]).net.toString(), "5700");
    assert.equal(selectionTotals(ALT, []).net.toString(), "6000");
  });
});
