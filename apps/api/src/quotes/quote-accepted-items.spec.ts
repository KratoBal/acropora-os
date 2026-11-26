import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  acceptedItemIds,
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
