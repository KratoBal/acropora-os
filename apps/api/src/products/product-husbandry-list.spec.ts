import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  husbandryFilterWhere,
  husbandryListState,
  underLiveAnimalRoot,
} from "./product-husbandry-list.js";

/*
  WHAT TURNS THESE RED (V2.2 S6, card d2fc06e7): a filter that does not restrict to live animals (an accessory would read as "unverified"
  and bury the real work); a root matched by NAME at any depth (a "Halak" subcategory of an accessory tree would count) instead of the
  root with no parent; "unverified" that misses the product with no datasheet row at all; "verified" that matches the stamp-less; the
  filter colliding with the search's `OR`; a row of a product that is not a live animal given a state; the missing count taken over
  something other than the detail's rule; a verified block counted as unverified.
*/
describe("a tartási szűrő feltétele", () => {
  it("szűrő nélkül nincs feltétel", () => {
    assert.deepEqual(husbandryFilterWhere(undefined), {});
  });

  it("mindkét érték elő állatra szűkít az elsődleges kategóriával, és az AND-ben áll (a keresés OR-jával nem ütközik)", () => {
    for (const filter of ["verified", "unverified"] as const) {
      const where = husbandryFilterWhere(filter) as {
        AND: Record<string, unknown>[];
        OR?: unknown;
      };
      assert.equal(
        "OR" in where,
        false,
        "no top-level OR: it would collide with the search",
      );
      assert.equal(where.AND.length, 2);
      assert.deepEqual(where.AND[0], {
        categories: {
          some: { isPrimary: true, category: underLiveAnimalRoot() },
        },
      });
    }
  });

  it("a gyökér az szülő nélküli ős, a három névvel; a mélység a betöltött lánc (maga + három szülő)", () => {
    const where = underLiveAnimalRoot() as { OR: Record<string, unknown>[] };
    assert.equal(where.OR.length, 4);
    // depth 0: the category IS a root
    assert.deepEqual(where.OR[0], {
      name: { in: ["Korallok", "Halak", "Gerinctelenek"] },
      parentId: null,
    });
    // depth 3: the root is the third ancestor
    assert.deepEqual(where.OR[3], {
      parent: {
        is: {
          parent: {
            is: {
              parent: {
                is: {
                  name: { in: ["Korallok", "Halak", "Gerinctelenek"] },
                  parentId: null,
                },
              },
            },
          },
        },
      },
    });
    // every level requires the root to have no parent: a "Halak" subcategory of another tree does not count
    assert.equal(JSON.stringify(where).split('"parentId":null').length - 1, 4);
  });

  it("az ellenőrzött a bélyeges blokk, a nem ellenőrzött a bélyeg nélküli ÉS a datasheet-sor nélküli", () => {
    const verified = husbandryFilterWhere("verified") as {
      AND: Record<string, unknown>[];
    };
    assert.deepEqual(verified.AND[1], {
      datasheet: { is: { ellenorizveAt: { not: null } } },
    });
    const unverified = husbandryFilterWhere("unverified") as {
      AND: Record<string, unknown>[];
    };
    assert.deepEqual(unverified.AND[1], {
      OR: [
        { datasheet: { is: null } },
        { datasheet: { is: { ellenorizveAt: null } } },
      ],
    });
  });
});

const category = (...path: string[]) => {
  // path from the root down: build the nested parent chain the list loads
  let node: { name: string; parent: unknown } | null = null;
  for (const name of path) node = { name, parent: node };
  return node!;
};

const baseSheet = {
  magyarNev: null,
  genus: null,
  species: null,
  careDifficulty: null,
  minLiter: null,
  medenceErettsegHonap: null,
  elhelyezesZona: null,
  reefSafe: null,
  reefSafeIndok: null,
  socialKeeping: null,
  aggression: [],
  korallevo: null,
  gerinctelenevo: null,
  feedingType: [],
  etetesGyakorisag: null,
  eloEleseg: null,
  fenyIgeny: null,
  aramlasIgeny: null,
  meretMax: null,
  meretDimenzio: null,
  szarmazas: null,
  kinekNem: null,
  forrasTipus: null,
  forrasHivatkozas: null,
  tempMinC: null,
  tempMaxC: null,
  salinityMinSg: null,
  salinityMaxSg: null,
  khMinDkh: null,
  khMaxDkh: null,
  lifespanYears: null,
  stingOrVenom: null,
  handlingWarning: null,
  quarantineWeeks: null,
  acclimatization: null,
  breedsInTank: null,
  ellenorizteUserId: null,
  ellenorizveAt: null,
};

describe("a lista sorának tartási állapota", () => {
  it("nem elő állat: nincs állapot (null), és az elsődleges kategória nélküli sor sem kap", () => {
    assert.equal(
      husbandryListState({
        categories: [
          { isPrimary: true, category: category("Víztisztítók", "Szűrők") },
        ],
        datasheet: null,
      }),
      null,
    );
    assert.equal(
      husbandryListState({
        categories: [{ isPrimary: false, category: category("Korallok") }],
        datasheet: null,
      }),
      null,
    );
  });

  it("elő állat datasheet nélkül: nem ellenőrzött, és a hiány a detail szabálya szerint számolt", () => {
    const state = husbandryListState({
      categories: [
        { isPrimary: true, category: category("Korallok", "SPS", "Acropora") },
      ],
      datasheet: null,
    })!;
    assert.equal(state.verified, false);
    // the required fields (magyarNev ... forrasHivatkozas) + the coral's zone + the verification: not the optional ones
    assert.ok(
      state.missing >= 20 && state.missing <= 30,
      String(state.missing),
    );
  });

  it("az ellenőrzött blokk ellenőrzött, és a bélyeg levonja a hiányt eggyel", () => {
    const category1 = [{ isPrimary: true, category: category("Halak") }];
    const unstamped = husbandryListState({
      categories: category1,
      datasheet: { ...baseSheet, ellenorizveAt: null },
    })!;
    const stamped = husbandryListState({
      categories: category1,
      datasheet: {
        ...baseSheet,
        ellenorizveAt: new Date("2026-11-10T10:00:00Z"),
      },
    })!;
    assert.equal(unstamped.verified, false);
    assert.equal(stamped.verified, true);
    assert.equal(stamped.missing, unstamped.missing - 1);
  });

  it("a tartási adat beírása csökkenti a hiányt, az opcionális mező nem számít bele", () => {
    const categories = [{ isPrimary: true, category: category("Halak") }];
    const empty = husbandryListState({ categories, datasheet: baseSheet })!;
    const filled = husbandryListState({
      categories,
      datasheet: {
        ...baseSheet,
        careDifficulty: "HALADO",
        kinekNem: "Kis medencébe nem.",
      },
    })!;
    const optionalOnly = husbandryListState({
      categories,
      datasheet: {
        ...baseSheet,
        quarantineWeeks: 4,
        tempMinC: new Prisma.Decimal("24"),
      },
    })!;
    assert.equal(filled.missing, empty.missing - 2);
    assert.equal(optionalOnly.missing, empty.missing);
  });
});
