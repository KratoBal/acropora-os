import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";

import { AssetFunctionsService } from "./asset-functions.service.js";
import {
  AssetFunctionsRepository,
  AssetFunctionDuplicateError,
} from "./asset-functions.repository.js";

/**
 * A FUNKCIO-TORZSADAT KET SZABALYA -- SZO SZERINT AZ
 * `asset-categories.service.spec.ts` NEGY ALLITASA, mas tablan.
 *
 * A VARRAT A VALODI SZERZODES TIPUSAT KAPJA: ha barmelyik tarolo-metodus
 * szignaturaja elmozdul, a fordito szoljon, ne a felhasznalo.
 */

type Hivas = { id: string };

function keszit(be?: { duplikatum?: boolean; letezik?: boolean }) {
  const kivezetettek: Hivas[] = [];
  const repository: Pick<
    AssetFunctionsRepository,
    "list" | "create" | "update" | "retire"
  > = {
    list: async () => [],
    create: async (input) => {
      if (be?.duplikatum) throw new AssetFunctionDuplicateError();
      return { id: "fun-1", isActive: true, ...input };
    },
    update: async () => null,
    retire: async (id) => {
      kivezetettek.push({ id });
      return be?.letezik ?? true;
    },
  };
  return {
    service: new AssetFunctionsService(repository as AssetFunctionsRepository),
    kivezetettek,
  };
}

describe("a funkció-törzsadat", () => {
  it("F1: a nevet körülvágja mentés előtt", async () => {
    const { service } = keszit();

    const created = await service.create({ name: "  Automata adagolás  " });

    assert.equal(created?.name, "Automata adagolás");
  });

  it("F2: a duplikátum 400, és megnevezi a kivezetetteket", async () => {
    const { service } = keszit({ duplikatum: true });

    await assert.rejects(
      () => service.create({ name: "Automata adagolás" }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /kivezetettek/i.test(error.message),
    );
  });

  it("F3: a törlés kivezetés, és a válasz ezt mondja", async () => {
    const { service, kivezetettek } = keszit();

    const valasz = await service.retire("fun-1");

    assert.deepEqual(valasz, { retired: true });
    assert.deepEqual(kivezetettek, [{ id: "fun-1" }]);
  });

  /**
   * F4: KONTROLL -- a nem letezo sor 404, hogy az F3 ne egy mindig
   * `{ retired: true }`-t ado megvalositason is zold maradjon.
   */
  it("F4: KONTROLL: a nem létező funkció 404", async () => {
    const { service } = keszit({ letezik: false });

    await assert.rejects(() => service.retire("nincs"), NotFoundException);
  });
});
