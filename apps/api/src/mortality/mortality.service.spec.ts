import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import type { MortalityRepository } from "./mortality.repository.js";
import {
  LIVE_ANIMAL_ONLY_MESSAGE,
  MortalityService,
  OWN_AQUARIUM_ONLY_MESSAGE,
  SUPPLIER_NOT_FOUND_MESSAGE,
  mergedSource,
} from "./mortality.service.js";

type Current = {
  productId: string;
  aquariumId: string;
  sourceType: "SUPPLIER" | "LOCAL_BREEDER" | "TRADE" | "OWN_BREEDING" | "OTHER";
  supplierId: string | null;
  sourceNote: string | null;
};

function fakeRepository(current: Current | null = null) {
  const calls = {
    create: [] as unknown[],
    update: [] as unknown[],
    checked: [] as string[],
  };
  const repository = {
    isLiveAnimalProduct: async (id: string) => {
      calls.checked.push(`product:${id}`);
      return id.startsWith("live");
    },
    isOwnAquarium: async (id: string) => {
      calls.checked.push(`aquarium:${id}`);
      return id.startsWith("own");
    },
    isSupplier: async (id: string) => {
      calls.checked.push(`supplier:${id}`);
      return id.startsWith("sup");
    },
    current: async () => current,
    create: async (input: unknown) => {
      calls.create.push(input);
      return { id: "rec-1" };
    },
    update: async (id: string, data: unknown, actor: string) => {
      calls.update.push({ id, data, actor });
      return current !== null;
    },
    detail: async (id: string) => ({ id }),
  } as unknown as MortalityRepository;
  return { service: new MortalityService(repository), calls };
}

const VALID = {
  productId: "live-1",
  quantity: 2,
  aquariumId: "own-1",
  sourceType: "SUPPLIER" as const,
  supplierId: "sup-1",
};

async function rejects(
  promise: Promise<unknown>,
  type: Function,
  message?: RegExp | string,
) {
  await assert.rejects(promise, (error: Error) => {
    assert.ok(
      error instanceof type,
      `${error.constructor.name}: ${error.message}`,
    );
    if (typeof message === "string") assert.equal(error.message, message);
    else if (message) assert.match(error.message, message);
    return true;
  });
}

describe("MortalityService.create", () => {
  it("rögzít, a rögzítő a hívó, a forrás normalizált", async () => {
    const { service, calls } = fakeRepository();
    await service.create(
      { ...VALID, sourceNote: "eldobva", note: "  " },
      "user-1",
    );
    assert.deepEqual(calls.create, [
      {
        productId: "live-1",
        quantity: 2,
        aquariumId: "own-1",
        sourceType: "SUPPLIER",
        supplierId: "sup-1",
        sourceNote: null,
        note: null,
        recordedById: "user-1",
      },
    ]);
  });

  it("nem élő állat terméket elutasít", async () => {
    const { service, calls } = fakeRepository();
    await rejects(
      service.create({ ...VALID, productId: "dry-1" }, "u"),
      BadRequestException,
      LIVE_ANIMAL_ONLY_MESSAGE,
    );
    assert.equal(calls.create.length, 0);
  });

  it("ügyfél-akváriumot elutasít", async () => {
    const { service } = fakeRepository();
    await rejects(
      service.create({ ...VALID, aquariumId: "cust-1" }, "u"),
      BadRequestException,
      OWN_AQUARIUM_ONLY_MESSAGE,
    );
  });

  it("nem létező beszállítót elutasít", async () => {
    const { service } = fakeRepository();
    await rejects(
      service.create({ ...VALID, supplierId: "nobody" }, "u"),
      BadRequestException,
      SUPPLIER_NOT_FOUND_MESSAGE,
    );
  });

  it("a forrás-szabályt még a hivatkozások előtt ellenőrzi", async () => {
    const { service, calls } = fakeRepository();
    await rejects(
      service.create({ ...VALID, sourceType: "OTHER", supplierId: null }, "u"),
      BadRequestException,
      /meg kell nevezni/,
    );
    assert.deepEqual(calls.checked, []);
  });

  it("nulla példányt elutasít", async () => {
    const { service } = fakeRepository();
    await rejects(
      service.create({ ...VALID, quantity: 0 }, "u"),
      BadRequestException,
      /legalább 1/,
    );
  });
});

describe("MortalityService.update", () => {
  const CURRENT: Current = {
    productId: "live-1",
    aquariumId: "own-1",
    sourceType: "SUPPLIER",
    supplierId: "sup-1",
    sourceNote: null,
  };

  it("nem létező bejegyzésre 404", async () => {
    const { service } = fakeRepository(null);
    await rejects(service.update("x", { quantity: 3 }, "u"), NotFoundException);
  });

  it("csak a megadott mezőket adja tovább, a hívóval", async () => {
    const { service, calls } = fakeRepository(CURRENT);
    await service.update("rec-1", { quantity: 3, note: " kész " }, "user-2");
    assert.deepEqual(calls.update, [
      { id: "rec-1", data: { quantity: 3, note: "kész" }, actor: "user-2" },
    ]);
  });

  it("a változatlan hivatkozást nem ellenőrzi újra", async () => {
    const { service, calls } = fakeRepository({
      ...CURRENT,
      productId: "dry-old",
    });
    await service.update("rec-1", { productId: "dry-old", note: "x" }, "u");
    assert.deepEqual(calls.checked, []);
  });

  it("a megváltoztatott terméket ellenőrzi", async () => {
    const { service, calls } = fakeRepository(CURRENT);
    await rejects(
      service.update("rec-1", { productId: "dry-2" }, "u"),
      BadRequestException,
      LIVE_ANIMAL_ONLY_MESSAGE,
    );
    assert.equal(calls.update.length, 0);
  });

  it("a megváltoztatott akváriumot ellenőrzi", async () => {
    const { service } = fakeRepository(CURRENT);
    await rejects(
      service.update("rec-1", { aquariumId: "cust-9" }, "u"),
      BadRequestException,
      OWN_AQUARIUM_ONLY_MESSAGE,
    );
  });

  it("forrás-típus váltásnál a régi beszállító nem öröklődik", async () => {
    const { service, calls } = fakeRepository(CURRENT);
    await service.update("rec-1", { sourceType: "TRADE" }, "u");
    assert.deepEqual(calls.update, [
      {
        id: "rec-1",
        data: { sourceType: "TRADE", supplierId: null, sourceNote: null },
        actor: "u",
      },
    ]);
  });

  it("„Egyéb”-re váltás megnevezés nélkül 400", async () => {
    const { service } = fakeRepository(CURRENT);
    await rejects(
      service.update("rec-1", { sourceType: "OTHER" }, "u"),
      BadRequestException,
      /meg kell nevezni/,
    );
  });

  it("új beszállítót ellenőriz, a régit nem", async () => {
    const one = fakeRepository(CURRENT);
    await rejects(
      one.service.update("rec-1", { supplierId: "nobody" }, "u"),
      BadRequestException,
      SUPPLIER_NOT_FOUND_MESSAGE,
    );
    const two = fakeRepository(CURRENT);
    await two.service.update("rec-1", { supplierId: "sup-1" }, "u");
    assert.deepEqual(two.calls.checked, []);
  });
});

describe("mergedSource", () => {
  it("azonos típusnál a meg nem adott mező öröklődik", () => {
    assert.deepEqual(
      mergedSource(
        { sourceType: "OTHER", supplierId: null, sourceNote: "Pista" },
        { sourceType: "OTHER" },
      ),
      { sourceType: "OTHER", supplierId: null, sourceNote: "Pista" },
    );
  });

  it("a megadott null törlést jelent", () => {
    assert.deepEqual(
      mergedSource(
        { sourceType: "TRADE", supplierId: null, sourceNote: "Béla" },
        { sourceNote: null },
      ),
      { sourceType: "TRADE", supplierId: null, sourceNote: null },
    );
  });
});
