import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { AquariumMaintainersService } from "./aquarium-maintainers.service.js";
import { AquariumsService } from "./aquariums.service.js";

/**
 * A KÉT PARTNER-RÉS ZÁRÁSA (2026-10-02, docs/mobile-home/v1-discovery.md §10).
 *
 * A PARTNER_SERVICE eléri az `aquariums.view` és `aquariums.manage` jogot, és
 * ezzel két olyan listát is, ami nem neki szól:
 *   - `GET /aquariums/customers`: minden aktív ügyfél neve és városa;
 *   - `GET /aquariums/maintainers/selectable`: a belső kollégák listája.
 * Partnernek az első üres, a második 403. A belső dolgozónak mindkettő
 * változatlan.
 */
const internal = { id: "u-int", role: "SERVICE" } as AuthenticatedUser;
const partner = {
  id: "u-partner",
  role: "PARTNER_SERVICE",
  customerId: "c-allatkert",
} as AuthenticatedUser;
const supplier = {
  id: "u-supplier",
  role: "PARTNER_SERVICE",
  supplierId: "s-1",
} as AuthenticatedUser;

const customers = [
  { id: "c-1", displayName: "Más Ügyfél Kft.", city: "Szeged" },
];

function aquariums() {
  const calls: (string | undefined)[] = [];
  const repository = {
    searchSelectableCustomers: async (search?: string) => {
      calls.push(search);
      return { items: customers };
    },
  };
  const service = new AquariumsService(repository as never, {} as never);
  return { service, calls };
}

function maintainers() {
  let calls = 0;
  const repository = {
    selectable: async () => {
      calls += 1;
      return [{ id: "u-staff", displayName: "Belső Kolléga" }];
    },
  };
  const service = new AquariumMaintainersService(
    repository as never,
    {} as never,
  );
  return { service, calls: () => calls };
}

describe("partner nem látja a többi ügyfelet az akvárium ügyfélválasztóban", () => {
  it("a belső dolgozó a teljes listát kapja", async () => {
    const { service, calls } = aquariums();
    assert.deepEqual(await service.searchSelectableCustomers(internal, "x"), {
      items: customers,
    });
    assert.deepEqual(calls, ["x"]);
  });

  it("a vevő-partner üres listát kap, és a lekérdezés le sem fut", async () => {
    const { service, calls } = aquariums();
    assert.deepEqual(await service.searchSelectableCustomers(partner), {
      items: [],
    });
    assert.equal(calls.length, 0);
  });

  it("a szállító-partner is üres listát kap", async () => {
    const { service, calls } = aquariums();
    assert.deepEqual(await service.searchSelectableCustomers(supplier), {
      items: [],
    });
    assert.equal(calls.length, 0);
  });
});

describe("a karbantartó-választó csak belső dolgozónak elérhető", () => {
  it("a belső dolgozó megkapja a kollégák listáját", async () => {
    const { service, calls } = maintainers();
    const result = await service.selectable(internal);
    assert.equal(result.length, 1);
    assert.equal(calls(), 1);
  });

  it("a partner 403-at kap, és a lista le sem kérődik", async () => {
    const { service, calls } = maintainers();
    assert.throws(() => service.selectable(partner), ForbiddenException);
    assert.equal(calls(), 0);
  });
});
