import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptedItemIds,
  allOptionsSelection,
  alternativeGroups,
  conflictingChoices,
  conflictSentence,
  replacedItemIds,
  type AcceptableItem,
} from "./quote-accepted-items.js";

const base = (id: string): AcceptableItem => ({
  id,
  isOptional: false,
  replacesItemId: null,
});
const optional = (id: string, replacesItemId: string | null = null) => ({
  id,
  isOptional: true,
  replacesItemId,
});
const ids = (set: Set<string>) => [...set].sort();

/*
  KIVÁLTOTT TÉTEL (Luca 2026-11-26, card 2540d9d4): a négy fogyasztó (megrendelés, készlet-átadás, díjbekérő, számla) EZT a döntést hívja.
  MI PIROSÍT: ha kiváltás nélkül más a szabály, mint a régi (nem opcionális VAGY kiválasztott); ha a kiválasztott opcionális nem szorítja ki a
  tételt; ha a ki nem választott opcionális kiszorít; ha egy nem opcionális azonosító a kiválasztottak között beleszámítana vagy kiszorítana.
*/
describe("acceptedItemIds", () => {
  it("without any replacement it is the old rule: every non-optional item plus the chosen optional ones", () => {
    const items = [base("a"), base("b"), optional("o1"), optional("o2")];
    assert.deepEqual(ids(acceptedItemIds(items, ["o2"])), ["a", "b", "o2"]);
    assert.deepEqual(ids(acceptedItemIds(items, [])), ["a", "b"]);
  });

  it("a chosen optional item that replaces a line takes its place: the replaced line drops out", () => {
    const items = [base("a"), base("b"), optional("o1", "b")];
    assert.deepEqual(ids(acceptedItemIds(items, ["o1"])), ["a", "o1"]);
  });

  it("an optional item that is NOT chosen replaces nothing", () => {
    const items = [base("a"), base("b"), optional("o1", "b")];
    assert.deepEqual(ids(acceptedItemIds(items, [])), ["a", "b"]);
  });

  it("two replacements are independent, and a supplement (no replaced line) only adds", () => {
    const items = [
      base("a"),
      base("b"),
      base("c"),
      optional("o1", "a"),
      optional("o2", "b"),
      optional("o3"),
    ];
    assert.deepEqual(ids(acceptedItemIds(items, ["o1", "o3"])), [
      "b",
      "c",
      "o1",
      "o3",
    ]);
    assert.deepEqual(ids(acceptedItemIds(items, ["o1", "o2", "o3"])), [
      "c",
      "o1",
      "o2",
      "o3",
    ]);
  });

  it("a selected id that is not an optional item neither counts twice nor replaces anything", () => {
    const items = [base("a"), optional("o1", "a")];
    assert.deepEqual(ids(acceptedItemIds(items, ["a"])), ["a"]);
  });

  it("a replacement pointing at a line that is not in the list changes nothing", () => {
    const items = [base("a"), optional("o1", "gone")];
    assert.deepEqual(ids(acceptedItemIds(items, ["o1"])), ["a", "o1"]);
  });

  it("takes the selection as a list or as a set", () => {
    const items = [base("a"), optional("o1", "a")];
    assert.deepEqual(
      ids(acceptedItemIds(items, new Set(["o1"]))),
      ids(acceptedItemIds(items, ["o1"])),
    );
  });
});

describe("replacedItemIds", () => {
  it("names exactly the lines a chosen optional item pushes out", () => {
    const items = [
      base("a"),
      base("b"),
      optional("o1", "a"),
      optional("o2", "b"),
    ];
    assert.deepEqual(ids(replacedItemIds(items, ["o1"])), ["a"]);
    assert.deepEqual(ids(replacedItemIds(items, [])), []);
    assert.deepEqual(ids(replacedItemIds(items, ["a"])), []);
  });
});

/*
  ALTERNATÍVÁK (Luca 2026-11-27, card 2540d9d4): egy tételt több opció is kiválthat, de az ügyfél közülük egyet választ. MI PIROSÍT: ha az egyetlen
  kiváltó alternatívának számít; ha a csoport nem minden tagját ismeri fel; ha két kiválasztott alternatívát nem jelez ütközésnek; ha egy kiválasztott
  alternatíva mellett a másik is beleszámít; ha az „összes opció” a csoport minden tagját adja a legdrágább helyett; ha a függetlenül kiváltó vagy önálló opció kiesik.
*/
describe("alternatives", () => {
  const items = [
    base("a"),
    base("b"),
    optional("x1", "a"),
    optional("x2", "a"),
    optional("x3", "a"),
    optional("y", "b"),
    optional("o"),
  ];

  it("only a line replaced by TWO or more options has a group; a single replacer is a plain replacement", () => {
    assert.deepEqual(
      [...alternativeGroups(items)],
      [["a", ["x1", "x2", "x3"]]],
    );
  });

  it("two chosen options of one line clash; one per line, or options of different lines, do not", () => {
    assert.deepEqual(conflictingChoices(items, ["x1", "x2"]), [
      { replacedItemId: "a", chosenItemIds: ["x1", "x2"] },
    ]);
    assert.deepEqual(conflictingChoices(items, ["x2", "y", "o"]), []);
    assert.deepEqual(conflictingChoices(items, []), []);
    assert.deepEqual(
      conflictingChoices([base("a"), optional("x", "a")], ["x"]),
      [],
    );
  });

  it("the chosen alternative takes the line's place and the other alternatives add nothing", () => {
    assert.deepEqual(ids(acceptedItemIds(items, ["x2"])), ["b", "x2"]);
    assert.deepEqual(ids(replacedItemIds(items, ["x2"])), ["a"]);
    // nothing chosen: the original stays, no alternative counts
    assert.deepEqual(ids(acceptedItemIds(items, [])), ["a", "b"]);
  });

  it("the all-options selection takes the dearest alternative per line, and every standalone or single replacing option", () => {
    const price: Record<string, number> = {
      x1: 20,
      x2: 30,
      x3: 25,
      y: 5,
      o: 1,
    };
    const dearer = (p: AcceptableItem, q: AcceptableItem) =>
      price[p.id]! > price[q.id]!;
    assert.deepEqual(allOptionsSelection(items, dearer), ["x2", "y", "o"]);
    // equal prices: the first one in the list stays
    assert.deepEqual(
      allOptionsSelection(
        [base("a"), optional("p", "a"), optional("q", "a")],
        () => false,
      ),
      ["p"],
    );
    // without any alternative it is every optional item
    assert.deepEqual(
      allOptionsSelection(
        [base("a"), optional("p", "a"), optional("o")],
        dearer,
      ),
      ["p", "o"],
    );
  });

  it("the clash sentence names the replaced line and the chosen options", () => {
    const named = items.map((item) => ({ ...item, name: `Név ${item.id}` }));
    assert.equal(
      conflictSentence(named, conflictingChoices(named, ["x1", "x3"])),
      "„Név a” helyett csak egy opciót választhatsz, ezek közül egyet: „Név x1”, „Név x3”.",
    );
    assert.equal(conflictSentence(named, []), null);
  });
});
