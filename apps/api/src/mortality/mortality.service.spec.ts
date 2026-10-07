import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import type { MortalityRepository } from "./mortality.repository.js";
import {
  LIVE_ANIMAL_ONLY_MESSAGE,
  LOCATION_NOT_FOUND_MESSAGE,
  MortalityService,
  OWN_AQUARIUM_ONLY_MESSAGE,
  SUPPLIER_NOT_FOUND_MESSAGE,
  mergedSource,
} from "./mortality.service.js";
import { PLACE_REQUIRED_MESSAGE } from "./mortality.policy.js";

type Current = {
  productId: string | null;
  productName?: string | null;
  aquariumId: string | null;
  sourceType: "SUPPLIER" | "LOCAL_BREEDER" | "TRADE" | "OWN_BREEDING" | "OTHER";
  supplierId: string | null;
  sourceNote: string | null;
  locationId?: string | null;
};

/** A „ma” a tesztekben: 2026-10-07 00:30 Budapest (UTC szerint még 10-06). */
const NOW = new Date("2026-10-06T22:30:00Z");

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
    isActiveLocation: async (id: string) => {
      calls.checked.push(`location:${id}`);
      return id.startsWith("loc");
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
  const service = new MortalityService(repository);
  service.now = () => NOW;
  return { service, calls };
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
    await service.create({ ...VALID, note: "  " }, "user-1");
    assert.deepEqual(calls.create, [
      {
        productId: "live-1",
        productName: null,
        quantity: 2,
        aquariumId: "own-1",
        sourceType: "SUPPLIER",
        supplierId: "sup-1",
        sourceNote: null,
        note: null,
        // nap nélkül a mai nap, Budapest szerint (UTC szerint még tegnap lenne)
        occurredOn: new Date("2026-10-07T00:00:00.000Z"),
        locationId: null,
        recordedById: "user-1",
      },
    ]);
  });

  it("a megadott elhullási napot és halas racket tárolja", async () => {
    const { service, calls } = fakeRepository();
    await service.create(
      { ...VALID, occurredOn: "2026-10-03", locationId: "loc-jobb-1" },
      "u",
    );
    const created = calls.create[0] as {
      occurredOn: Date;
      locationId: string;
    };
    assert.deepEqual(created.occurredOn, new Date("2026-10-03T00:00:00Z"));
    assert.equal(created.locationId, "loc-jobb-1");
    assert.ok(calls.checked.includes("location:loc-jobb-1"));
  });

  it("jövőbeli napot elutasít, a mait elfogadja", async () => {
    const { service, calls } = fakeRepository();
    await rejects(
      service.create({ ...VALID, occurredOn: "2026-10-08" }, "u"),
      BadRequestException,
      "Az elhullás napja nem lehet a jövőben.",
    );
    assert.equal(calls.create.length, 0);
    await service.create({ ...VALID, occurredOn: "2026-10-07" }, "u");
    assert.equal(calls.create.length, 1);
  });

  it("nem létező naptári napot elutasít", async () => {
    const { service } = fakeRepository();
    await rejects(
      service.create({ ...VALID, occurredOn: "2026-02-30" }, "u"),
      BadRequestException,
      "Az elhullás napja érvénytelen dátum.",
    );
  });

  it("akvárium és halas rack nélkül 400, és semmit nem ellenőriz előtte", async () => {
    const { service, calls } = fakeRepository();
    await rejects(
      service.create({ ...VALID, aquariumId: null }, "u"),
      BadRequestException,
      PLACE_REQUIRED_MESSAGE,
    );
    await rejects(
      service.create({ ...VALID, aquariumId: "", locationId: "" }, "u"),
      BadRequestException,
      PLACE_REQUIRED_MESSAGE,
    );
    assert.equal(calls.create.length, 0);
    assert.deepEqual(calls.checked, []);
  });

  it("csak halas rackkel rögzít: akvárium nélkül, akvárium-ellenőrzés nélkül", async () => {
    const { service, calls } = fakeRepository();
    await service.create(
      { ...VALID, aquariumId: undefined, locationId: "loc-rakos-1" },
      "u",
    );
    const created = calls.create[0] as {
      aquariumId: unknown;
      locationId: unknown;
    };
    assert.equal(created.aquariumId, null);
    assert.equal(created.locationId, "loc-rakos-1");
    assert.equal(
      calls.checked.some((c) => c.startsWith("aquarium:")),
      false,
    );
  });

  it("csak akváriummal is rögzít (rack nélkül)", async () => {
    const { service, calls } = fakeRepository();
    await service.create({ ...VALID, locationId: null }, "u");
    const created = calls.create[0] as {
      aquariumId: unknown;
      locationId: unknown;
    };
    assert.equal(created.aquariumId, "own-1");
    assert.equal(created.locationId, null);
  });

  it("akvárium és rack együtt is megadható", async () => {
    const { service, calls } = fakeRepository();
    await service.create({ ...VALID, locationId: "loc-1" }, "u");
    assert.deepEqual(
      calls.checked.filter((c) => !c.startsWith("product:")),
      ["aquarium:own-1", "supplier:sup-1", "location:loc-1"],
    );
  });

  it("ismeretlen vagy kivezetett halas racket elutasít", async () => {
    const { service, calls } = fakeRepository();
    await rejects(
      service.create({ ...VALID, locationId: "archived-1" }, "u"),
      BadRequestException,
      LOCATION_NOT_FOUND_MESSAGE,
    );
    assert.equal(calls.create.length, 0);
  });

  it("beszállító és szabad szöveges név együtt: 400, nem dobjuk el csendben", async () => {
    const { service, calls } = fakeRepository();
    await rejects(
      service.create({ ...VALID, sourceNote: "eldobva" }, "u"),
      BadRequestException,
      /a kettőt együtt nem/,
    );
    assert.equal(calls.create.length, 0);
  });

  it("szabad szöveges élőlény: nincs termék-ellenőrzés, a név tárolódik", async () => {
    const { service, calls } = fakeRepository();
    await service.create(
      { ...VALID, productId: null, productName: "  Ismeretlen gébféle " },
      "u",
    );
    assert.equal(
      calls.checked.some((c) => c.startsWith("product:")),
      false,
    );
    assert.deepEqual(
      calls.create[0] as { productId: unknown; productName: unknown },
      {
        ...(calls.create[0] as object),
        productId: null,
        productName: "Ismeretlen gébféle",
      },
    );
  });

  it("élőlény nélkül, vagy terméket ÉS nevet adva: 400", async () => {
    const { service, calls } = fakeRepository();
    await rejects(
      service.create({ ...VALID, productId: null }, "u"),
      BadRequestException,
      /Válaszd ki az élőlényt, vagy írd be a nevét/,
    );
    await rejects(
      service.create({ ...VALID, productName: "x" }, "u"),
      BadRequestException,
      /a kettőt együtt nem/,
    );
    assert.equal(calls.create.length, 0);
  });

  it("szabad szöveges beszállító: nincs beszállító-ellenőrzés, a név a megnevezésbe kerül", async () => {
    const { service, calls } = fakeRepository();
    await service.create(
      { ...VALID, supplierId: null, sourceNote: "Kis Pál" },
      "u",
    );
    assert.equal(
      calls.checked.some((c) => c.startsWith("supplier:")),
      false,
    );
    const created = calls.create[0] as {
      supplierId: unknown;
      sourceNote: unknown;
    };
    assert.equal(created.supplierId, null);
    assert.equal(created.sourceNote, "Kis Pál");
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

  it("szabad szövegre váltás: a termék törlődik, ellenőrzés nincs", async () => {
    const { service, calls } = fakeRepository(CURRENT);
    await service.update("rec-1", { productName: " Gébféle " }, "u");
    assert.deepEqual(calls.checked, []);
    assert.deepEqual(calls.update, [
      {
        id: "rec-1",
        data: { productId: null, productName: "Gébféle" },
        actor: "u",
      },
    ]);
  });

  it("szabad szövegről termékre váltás: a név törlődik, a termék ellenőrzött", async () => {
    const { service, calls } = fakeRepository({
      ...CURRENT,
      productId: null,
      productName: "Gébféle",
    });
    await service.update("rec-1", { productId: "live-9" }, "u");
    assert.deepEqual(calls.checked, ["product:live-9"]);
    assert.deepEqual(calls.update, [
      {
        id: "rec-1",
        data: { productId: "live-9", productName: null },
        actor: "u",
      },
    ]);
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

  it("az elhullás napja módosítható, de nem a jövőbe", async () => {
    const { service, calls } = fakeRepository(CURRENT);
    await service.update("rec-1", { occurredOn: "2026-09-30" }, "u");
    assert.deepEqual(calls.update, [
      {
        id: "rec-1",
        data: { occurredOn: new Date("2026-09-30T00:00:00Z") },
        actor: "u",
      },
    ]);
    await rejects(
      service.update("rec-1", { occurredOn: "2026-10-08" }, "u"),
      BadRequestException,
      /nem lehet a jövőben/,
    );
  });

  it("a halas rack törölhető, az új ellenőrzött, a régi (akár kivezetett) nem", async () => {
    const one = fakeRepository({ ...CURRENT, locationId: "archived-old" });
    await one.service.update("rec-1", { locationId: "archived-old" }, "u");
    assert.deepEqual(one.calls.checked, []);
    await one.service.update("rec-1", { locationId: null }, "u");
    assert.deepEqual((one.calls.update[1] as { data: unknown }).data, {
      locationId: null,
    });
    await rejects(
      one.service.update("rec-1", { locationId: "nowhere" }, "u"),
      BadRequestException,
      LOCATION_NOT_FOUND_MESSAGE,
    );
  });

  it("az akvárium törölhető, ha rack áll (vagy most kerül) helyette", async () => {
    const one = fakeRepository({ ...CURRENT, locationId: "loc-1" });
    await one.service.update("rec-1", { aquariumId: null }, "u");
    assert.deepEqual((one.calls.update[0] as { data: unknown }).data, {
      aquariumId: null,
    });
    const two = fakeRepository(CURRENT);
    await two.service.update(
      "rec-1",
      { aquariumId: null, locationId: "loc-2" },
      "u",
    );
    assert.deepEqual((two.calls.update[0] as { data: unknown }).data, {
      aquariumId: null,
      locationId: "loc-2",
    });
  });

  it("az utolsó helyszín nem törölhető: se az akvárium rack nélkül, se a rack akvárium nélkül", async () => {
    const one = fakeRepository({ ...CURRENT, locationId: null });
    await rejects(
      one.service.update("rec-1", { aquariumId: null }, "u"),
      BadRequestException,
      PLACE_REQUIRED_MESSAGE,
    );
    const two = fakeRepository({
      ...CURRENT,
      aquariumId: null,
      locationId: "loc-1",
    });
    await rejects(
      two.service.update("rec-1", { locationId: null }, "u"),
      BadRequestException,
      PLACE_REQUIRED_MESSAGE,
    );
    assert.equal(one.calls.update.length + two.calls.update.length, 0);
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
