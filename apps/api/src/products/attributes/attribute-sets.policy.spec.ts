import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  keszletKor,
  orokoltAttributumok,
  type SetAttributeRow,
  type SetRow,
} from "./attribute-sets.policy.js";

/**
 * A KESZLETEK FAJA (SEO P0 PR 2, C1): az alkeszlet orokli a szulo attributumait,
 * es a fa kormentes.
 *
 * MI PIROSIT: a szulo attributuma hianyzik a gyereknel; a gyerek felulirasa nem
 * nyer; egy kor nem latszik, vagy az orokles egy korben vegtelen.
 */
const pump: SetRow = { id: "s1", key: "pump", parentId: null };
const returnPump: SetRow = { id: "s2", key: "return_pump", parentId: "s1" };
const link = (
  attributeSetId: string,
  attributeKey: string,
  extra: Partial<SetAttributeRow> = {},
): SetAttributeRow => ({
  attributeSetId,
  attributeKey,
  required: false,
  filterable: null,
  group: null,
  sortOrder: 0,
  ...extra,
});

describe("attribute sets", () => {
  it("a child inherits its parent's attributes, and its own override wins", () => {
    const links = [
      link("s1", "flowRate", { required: true, sortOrder: 1 }),
      link("s1", "power", { sortOrder: 2 }),
      link("s2", "power", { required: true, sortOrder: 2 }),
      link("s2", "voltage", { sortOrder: 3 }),
    ];
    const gyerek = orokoltAttributumok("s2", [pump, returnPump], links);
    assert.deepEqual(
      gyerek.map((l) => [l.attributeKey, l.attributeSetId, l.required]),
      [
        ["flowRate", "s1", true],
        ["power", "s2", true],
        ["voltage", "s2", false],
      ],
    );
    // a szulo nem kapja meg a gyerek sajatjat
    assert.deepEqual(
      orokoltAttributumok("s1", [pump, returnPump], links).map(
        (l) => l.attributeKey,
      ),
      ["flowRate", "power"],
    );
  });

  it("no cycle in a healthy tree; a cycle is named and refused", () => {
    assert.equal(keszletKor([pump, returnPump]), null);
    const korben = [{ ...pump, parentId: "s2" }, returnPump];
    assert.deepEqual(keszletKor(korben)?.sort(), ["pump", "return_pump"]);
    assert.throws(() => orokoltAttributumok("s2", korben, []), /cycle/);
    const onmaga = [{ id: "s3", key: "maga", parentId: "s3" }];
    assert.deepEqual(keszletKor(onmaga), ["maga"]);
  });
});
