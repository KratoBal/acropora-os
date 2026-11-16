import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpException } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { MedusaConfigurationError } from "./medusa-admin.client.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import { MedusaPickupAdoptionController } from "./medusa-pickup-adoption.controller.js";
import type { MedusaPickupAdoptionService } from "./medusa-pickup-adoption.service.js";

/*
  A VEGPONT (kartya c603774e, acrobot 45855). MI PIROSIT: a lista joga nem a vetito sor olvasasa (INVENTORY_VIEW), vagy az iras
  joga nem SETTINGS_MANAGE; a torzs szuk kapuja szelesebb (egy elgepelt mezo csendben "terv" helyett "apply"-t jelentene, vagy
  fordítva); az `apply` nelkuli kerés ir; az azonositok nincsenek vágva és egyedivé téve; egy bolti hiba 500-nak latszik a
  hivonak, vagy egy hivo hibaja 503-nak.
*/
const USER = { id: "user-1" } as AuthenticatedUser;

function fake() {
  const hivasok: { ids: readonly string[]; apply: boolean; actor?: string }[] =
    [];
  const service = {
    list: async () => ({
      markKnown: true,
      rows: 0,
      marked: 0,
      counts: {},
      entries: [],
    }),
    adopt: async (ids: readonly string[], apply: boolean, actor?: string) => {
      hivasok.push({ ids, apply, actor });
      return { apply, adopted: [], refused: [] };
    },
  } as unknown as MedusaPickupAdoptionService;
  return { controller: new MedusaPickupAdoptionController(service), hivasok };
}

describe("a múltbeli átvétel végpontja", () => {
  it("a lista a vetítő sor olvasásának jogát kéri, az adoptálás a beállítás kezelését", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        MedusaPickupAdoptionController.prototype.list,
      ),
      [PERMISSIONS.INVENTORY_VIEW],
    );
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        MedusaPickupAdoptionController.prototype.adopt,
      ),
      [PERMISSIONS.SETTINGS_MANAGE],
    );
  });

  it("a rossz törzs 400, és semmit nem hív", async () => {
    const rosszak: unknown[] = [
      null,
      [],
      "x",
      {},
      { osProductIds: [] },
      { osProductIds: "a" },
      { osProductIds: [""] },
      { osProductIds: ["  "] },
      { osProductIds: [1] },
      { osProductIds: ["a"], extra: true },
      { osProductIds: ["a"], dryRun: false },
      { osProductIds: ["a"], apply: "true" },
      { osProductIds: Array.from({ length: 501 }, (_, i) => `os-${i}`) },
      { osProductIds: ["x".repeat(201)] },
    ];
    for (const body of rosszak) {
      const f = fake();
      await assert.rejects(
        () => f.controller.adopt(body, USER),
        (error: unknown) =>
          error instanceof HttpException &&
          error.getStatus() === 400 &&
          error.message === "MEDUSA_PICKUP_ADOPTION_INPUT_INVALID",
        JSON.stringify(body).slice(0, 60),
      );
      assert.deepEqual(f.hivasok, []);
    }
  });

  it("az apply nélküli kérés terv (nem ír); csak a kifejezett apply: true ír; az azonosító vágva és egyedi; a felhasználó átmegy", async () => {
    const terv = fake();
    await terv.controller.adopt(
      { osProductIds: [" os-a ", "os-a", "os-b"] },
      USER,
    );
    assert.deepEqual(terv.hivasok, [
      { ids: ["os-a", "os-b"], apply: false, actor: "user-1" },
    ]);

    const hamis = fake();
    await hamis.controller.adopt(
      { osProductIds: ["os-a"], apply: false },
      USER,
    );
    assert.equal(hamis.hivasok[0]?.apply, false);

    const ir = fake();
    await ir.controller.adopt({ osProductIds: ["os-a"], apply: true }, USER);
    assert.equal(ir.hivasok[0]?.apply, true);
  });

  it("a bolt elérhetetlensége 503, a hívó hibája nem; más hiba továbbmegy", async () => {
    const hiba = (error: Error) =>
      new MedusaPickupAdoptionController({
        list: async () => {
          throw error;
        },
        adopt: async () => {
          throw error;
        },
      } as unknown as MedusaPickupAdoptionService);
    for (const hivas of [
      (c: MedusaPickupAdoptionController) => c.list(),
      (c: MedusaPickupAdoptionController) =>
        c.adopt({ osProductIds: ["a"] }, USER),
    ]) {
      await assert.rejects(
        () =>
          hivas(hiba(new MedusaConnectionError("MEDUSA_CONNECTION_COOLDOWN"))),
        (e: unknown) =>
          e instanceof HttpException &&
          e.getStatus() === 503 &&
          e.message === "MEDUSA_CONNECTION_COOLDOWN",
      );
      await assert.rejects(
        () => hivas(hiba(new MedusaConfigurationError("x"))),
        (e: unknown) =>
          e instanceof HttpException &&
          e.getStatus() === 503 &&
          e.message === "MEDUSA_NOT_CONFIGURED",
      );
      await assert.rejects(
        () => hivas(hiba(new Error("váratlan"))),
        /váratlan/,
      );
    }
  });
});
