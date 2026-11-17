import { describe, expect, it } from "vitest";

import {
  addAssets,
  addSummary,
  assetLabel,
  removeAsset,
  type ListedAsset,
} from "./template-asset-list";

/*
  A SABLON ESZKÖZLISTÁJA. MI PIROSIT: ha egy eszköz kétszer kerülne a listába; ha a hozzáadás sorrendje felborulna; ha a határon túl is
  bekerülne elem, vagy a kimaradás némán történne; ha az eltávolítás mást is elvenne; ha a bemeneti lista módosulna.
*/
const item = (n: number): ListedAsset => ({
  id: `a${n}`,
  label: `V${n} · Eszköz ${n}`,
});

describe("addAssets", () => {
  it("a sorrend a hozzáadás sorrendje, az ismétlés nem kerül be kétszer és meg van számolva", () => {
    const current = [item(1), item(2)];
    const result = addAssets(current, [item(3), item(2), item(4)]);
    expect(result.list.map((x) => x.id)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(result).toMatchObject({ added: 2, alreadyListed: 1, overLimit: 0 });
    // a bemenet érintetlen
    expect(current.map((x) => x.id)).toEqual(["a1", "a2"]);
  });

  it("a határon túl nem kerül be elem, és a kimaradás meg van számolva (nem néma)", () => {
    const result = addAssets(
      [item(1), item(2)],
      [item(3), item(4), item(5)],
      3,
    );
    expect(result.list.map((x) => x.id)).toEqual(["a1", "a2", "a3"]);
    expect(result).toMatchObject({ added: 1, alreadyListed: 0, overLimit: 2 });
  });

  it("CONTROL: az ismétlés a teli listán nem számít kimaradásnak, és az üres hozzáadás nem változtat", () => {
    const full = [item(1), item(2)];
    expect(addAssets(full, [item(1)], 2)).toMatchObject({
      added: 0,
      alreadyListed: 1,
      overLimit: 0,
    });
    expect(addAssets(full, [], 2).list).toEqual(full);
  });
});

describe("removeAsset és assetLabel", () => {
  it("csak a megnevezett eszközt veszi el", () => {
    expect(
      removeAsset([item(1), item(2), item(3)], "a2").map((x) => x.id),
    ).toEqual(["a1", "a3"]);
    expect(removeAsset([item(1)], "nincs").map((x) => x.id)).toEqual(["a1"]);
  });

  it("a felirat a leltári szám és a név", () => {
    expect(assetLabel({ assetNumber: "V2196", name: "Homokszűrő" })).toBe(
      "V2196 · Homokszűrő",
    );
  });
});

describe("addSummary", () => {
  it("megmondja, mi került be, mi volt már ott, és mi nem fért be; üres, ha nincs mit mondani", () => {
    expect(
      addSummary({ list: [], added: 3, alreadyListed: 0, overLimit: 0 }),
    ).toBe("3 eszköz bekerült a listába.");
    const text = addSummary({
      list: [],
      added: 1,
      alreadyListed: 2,
      overLimit: 4,
    });
    expect(text).toContain("1 eszköz bekerült");
    expect(text).toContain("2 már a listában volt");
    expect(text).toContain("4 eszköz nem fért be");
    expect(
      addSummary({ list: [], added: 0, alreadyListed: 0, overLimit: 0 }),
    ).toBe("");
  });
});
