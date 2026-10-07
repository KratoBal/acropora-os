import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MedusaShippingOnCreate } from "./medusa-shipping-on-create.js";
import type { ShippingAttributesCliDatabase } from "./medusa-shipping-attributes.cli.js";

/*
  A LÉTREHOZOTT TERMÉK SZÁLLÍTÁSI OSZTÁLYÁNAK FORRÁSAI (kártya 2a7f2313,
  acrobot 27099 döntései). MI PIROSÍT:
  - a UNAS felülírja a kézzel kitöltött sort;
  - a „csak Foxpost” UNAS-tétel (a Modern Reef is ilyen) nem bolti átvétel;
  - a „csak GLS házhoz” nem Foxpost-tiltás;
  - az élő állat kategóriája nem jelöl bolti átvételt;
  - a profilt és a kategória-fát termékenként kérdezi, vagy egy hibát megtart.
*/
const FOXPOST = "Foxpost csomagautomaták";
const GLS_HOME = "GLS házhozszállítás";
const GLS_POINT = "Átvétel a GLS csomagponton";
const denied = (...names: string[]) => ({
  ShippingMethods: { Denied: { Method: names.map((Name) => ({ Name })) } },
});

function setup(over: {
  handRow?: Record<string, boolean>;
  unas?: unknown;
  liveAnimal?: boolean;
}) {
  const projected: { profile: unknown; derived: boolean }[] = [];
  const counts = { category: 0, profile: 0 };
  const database = {
    category: {
      findMany: async () => {
        counts.category += 1;
        return [
          { id: "c_halak", name: "Halak", parentId: null },
          { id: "c_technika", name: "Technika", parentId: null },
        ];
      },
    },
    productCategory: {
      findMany: async () =>
        over.liveAnimal ? [{ productId: "p1", categoryId: "c_halak" }] : [],
    },
    productShippingProfile: {
      findMany: async () =>
        over.handRow
          ? [
              {
                productId: "p1",
                pickupOnly: false,
                foxpostForbidden: false,
                isHeavy: false,
                isFrozen: false,
                ...over.handRow,
              },
            ]
          : [],
    },
    unasProductSnapshot: {
      findMany: async () =>
        over.unas === undefined
          ? []
          : [{ productId: "p1", rawPayload: over.unas }],
    },
    productVariant: { findMany: async () => [] },
  } as unknown as ShippingAttributesCliDatabase;
  const helper = new MedusaShippingOnCreate(
    database,
    {
      defaultShippingProfileId: async () => {
        counts.profile += 1;
        return "sp_default";
      },
    },
    {
      project: async (
        _id: string,
        profile: unknown,
        apply: boolean,
        derived?: boolean,
      ) => {
        assert.equal(apply, true);
        projected.push({ profile, derived: derived ?? false });
        return { action: "applied", medusaProductId: "m1", flags: "x" };
      },
    },
  );
  return { helper, projected, counts };
}

const on = (p: unknown) =>
  p
    ? Object.entries(p as Record<string, boolean>)
        .filter(([key, value]) => value && key !== "productId")
        .map(([key]) => key)
    : null;

describe("the shipping class of a created product", () => {
  it("a hand-filled row wins over the UNAS override", async () => {
    const { helper, projected } = setup({
      handRow: { isHeavy: true },
      unas: denied(FOXPOST, GLS_HOME, GLS_POINT),
    });
    await helper.afterCreate("p1");
    assert.deepEqual(on(projected[0]!.profile), ["isHeavy"]);
  });

  it("UNAS 'Foxpost only' (Modern Reef) is store pickup; 'GLS home only' forbids Foxpost", async () => {
    const foxpostOnly = setup({ unas: denied(GLS_HOME, GLS_POINT) });
    await foxpostOnly.helper.afterCreate("p1");
    assert.deepEqual(on(foxpostOnly.projected[0]!.profile), ["pickupOnly"]);

    const glsHomeOnly = setup({ unas: denied(FOXPOST, GLS_POINT) });
    await glsHomeOnly.helper.afterCreate("p1");
    assert.deepEqual(on(glsHomeOnly.projected[0]!.profile), [
      "foxpostForbidden",
    ]);
  });

  it("a live animal is store pickup by its category, whatever UNAS says", async () => {
    const { helper, projected } = setup({ liveAnimal: true, unas: {} });
    await helper.afterCreate("p1");
    assert.deepEqual(projected[0], { profile: null, derived: true });
  });

  it("asks the profile and the category tree once per run", async () => {
    const { helper, counts } = setup({});
    await helper.afterCreate("p1");
    await helper.afterCreate("p1");
    assert.equal(await helper.defaultProfileId(), "sp_default");
    assert.equal(await helper.defaultProfileId(), "sp_default");
    assert.deepEqual(counts, { category: 1, profile: 1 });
  });

  it("a failed profile lookup is asked again, not kept", async () => {
    let calls = 0;
    const helper = new MedusaShippingOnCreate(
      {} as never,
      {
        defaultShippingProfileId: async () => {
          calls += 1;
          if (calls === 1) throw new Error("503");
          return "sp_default";
        },
      },
      { project: async () => ({ action: "skipped", reason: "no-profile" }) },
    );
    await assert.rejects(helper.defaultProfileId(), /503/);
    assert.equal(await helper.defaultProfileId(), "sp_default");
  });
});
