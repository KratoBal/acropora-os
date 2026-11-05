import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeShippingFill,
  planShippingFill,
} from "./shipping-profile-fill.js";

/**
 * THE FILL'S PREVIEW COUNTS THE NEW ROWS' TRUE FLAGS (acrobot 43066: on stage 1900 rows were to be created and the
 * preview said nothing about what they would carry, so the live run would be pressed blind). WHAT TURNS THIS RED: a
 * create that is not counted per flag; a false flag counted as true; an existing row's flags counted as created.
 */
const foxpostDenied = {
  ShippingMethods: {
    Denied: { Method: [{ Name: "Foxpost csomagautomaták" }] },
  },
};

function fakeDb(
  snapshots: { productId: string; rawPayload: unknown }[],
  profiles: Record<string, unknown>[] = [],
) {
  return {
    unasProductSnapshot: {
      findMany: async (args: { where: { productId?: { gt: string } } }) => {
        const after = args.where.productId?.gt;
        return after ? [] : snapshots;
      },
    },
    productShippingProfile: {
      findMany: async () => profiles,
    },
  } as never;
}

describe("the shipping fill's preview", () => {
  it("counts, per flag, how many of the new rows will carry it", async () => {
    const { report } = await planShippingFill(
      fakeDb([
        { productId: "a", rawPayload: foxpostDenied },
        { productId: "b", rawPayload: foxpostDenied },
        { productId: "c", rawPayload: {} },
      ]),
    );
    assert.equal(report.create, 3);
    assert.deepEqual(report.createdFlags, {
      pickupOnly: 0,
      foxpostForbidden: 2,
      isHeavy: 0,
      isFrozen: 0,
    });
    assert.match(describeShippingFill(report), /foxpostForbidden igaz: 2/);
  });

  it("an existing row is not counted as created", async () => {
    const { report } = await planShippingFill(
      fakeDb(
        [{ productId: "a", rawPayload: foxpostDenied }],
        [
          {
            productId: "a",
            pickupOnly: false,
            foxpostForbidden: false,
            isHeavy: false,
            isFrozen: false,
            pickupOnlySource: "UNAS",
            foxpostForbiddenSource: "UNAS",
            isHeavySource: "UNAS",
            isFrozenSource: "UNAS",
            lockerUnsuitable: false,
          },
        ],
      ),
    );
    assert.equal(report.create, 0);
    assert.equal(report.update, 1);
    assert.equal(report.createdFlags.foxpostForbidden, 0);
    assert.equal(report.updatedFlags.foxpostForbidden, 1);
  });
});
