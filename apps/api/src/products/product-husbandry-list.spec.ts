import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  husbandryFilterMembers,
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
    assert.deepEqual(husbandryFilterMembers(undefined), []);
  });

  it("mindkét érték elő állatra szűkít az elsődleges kategóriával; két tagot ad, felső szintű kulcs nélkül (az AND-gyűjtő tagjai)", () => {
    for (const filter of ["verified", "unverified"] as const) {
      const members = husbandryFilterMembers(filter);
      assert.equal(members.length, 2);
      assert.deepEqual(members[0], {
        categories: {
          some: { isPrimary: true, category: underLiveAnimalRoot() },
        },
      });
      // no member carries an AND key of its own: the list's one AND array is the only place an AND stands
      for (const member of members) assert.equal("AND" in member, false);
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
    const verified = husbandryFilterMembers("verified");
    assert.deepEqual(verified[1], {
      datasheet: { is: { ellenorizveAt: { not: null } } },
    });
    const unverified = husbandryFilterMembers("unverified");
    assert.deepEqual(unverified[1], {
      OR: [
        { datasheet: { is: null } },
        { datasheet: { is: { ellenorizveAt: null } } },
      ],
    });
  });
});

type TestCategory = {
  name: string;
  parentId: string | null;
  parent: TestCategory | null;
};

/**
 * A chain as the list loads it: the category and the parents above it, each with its own `parentId`. `loaded` is how many levels are
 * loaded (the list loads four); a chain deeper than that is cut, and the topmost loaded node keeps a non-null `parentId`.
 */
const category = (...path: string[]): TestCategory =>
  category_(path, path.length);
const category_ = (path: string[], loaded: number): TestCategory => {
  let node: TestCategory | null = null;
  const cut = Math.max(0, path.length - loaded);
  for (let index = cut; index < path.length; index += 1)
    node = {
      name: path[index]!,
      parentId: index === 0 ? null : `id-of-${path[index - 1]}`,
      parent: node,
    };
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

describe("a veszély jelzése a lista során (V2.2 követés)", () => {
  const categories = [{ isPrimary: true, category: category("Korallok") }];
  const state = (sting: boolean | null) =>
    husbandryListState({
      categories,
      datasheet: { ...baseSheet, stingOrVenom: sting },
    })!;

  it("csak a tárolt IGAZ csípés vagy méreg veszély, a nem és az ismeretlen nem", () => {
    assert.equal(state(true).hazard, true);
    assert.equal(state(false).hazard, false);
    assert.equal(state(null).hazard, false);
  });

  it("a datasheet nélküli sor nem veszélyes, és a veszély nem módosítja a hiányszámot", () => {
    const none = husbandryListState({ categories, datasheet: null })!;
    assert.equal(none.hazard, false);
    assert.equal(state(true).missing, state(false).missing);
  });
});

describe("a sor gyökér-olvasata (barracuda a #2386-on)", () => {
  const row = (chain: TestCategory) => ({
    categories: [{ isPrimary: true, category: chain }],
    datasheet: null,
  });

  it("a valódi gyökér (szülő nélküli) ad fajtát, a betöltött lánc hossza nem számít, ha eléri a gyökeret", () => {
    for (const chain of [
      category("Halak"),
      category("Korallok", "SPS"),
      category("Gerinctelenek", "Rákok", "Garnélák"),
      category("Korallok", "SPS", "Acropora", "Fajok"),
    ])
      assert.notEqual(husbandryListState(row(chain)), null);
  });

  it("egy mélyebb fa belső 'Halak' csomópontja nem gyökér: a lánc nem éri el a gyökeret, tehát nincs állapot", () => {
    // five levels: Szűrők > A > B > Halak > Alsó. The list loads four: Alsó, Halak, B, A; the topmost loaded node (A) has a parent.
    const deep = category_(["Szűrők", "A", "B", "Halak", "Alsó"], 4);
    assert.equal(deep.parent?.parent?.parent?.name, "A");
    assert.notEqual(deep.parent?.parent?.parent?.parentId, null);
    assert.equal(husbandryListState(row(deep)), null);
    // and a loaded chain whose topmost node is a "Halak" that is NOT a root
    const innerHalak = category_(["Szűrők", "Halak", "Alsó"], 2);
    assert.equal(innerHalak.parent?.name, "Halak");
    assert.equal(husbandryListState(row(innerHalak)), null);
  });

  it("a gyökér-nevű de szülővel bíró csúcs sem gyökér, és a hiányzó parentId (nem betöltött mező) sem hamisít élő állatot", () => {
    assert.equal(
      husbandryListState(row({ name: "Halak", parentId: "x", parent: null })),
      null,
    );
    assert.equal(
      husbandryListState({
        categories: [
          { isPrimary: true, category: { name: "Halak" } as TestCategory },
        ],
        datasheet: null,
      }),
      null,
    );
  });
});

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
