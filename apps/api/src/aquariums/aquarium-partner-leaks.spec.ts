import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { AquariumMaintainersService } from "./aquarium-maintainers.service.js";
import { AquariumsService } from "./aquariums.service.js";
import { selectableCustomerWhere } from "./aquariums.repository.js";

/**
 * THE TWO AQUARIUM LISTS A PARTNER COULD READ (closed 2026-10-02).
 *
 *   GET /aquariums/customers             every active buyer's name and city,
 *                                        searchable, to any `aquariums.view`
 *   GET /aquariums/maintainers/selectable every internal colleague who may
 *                                        maintain an aquarium, by name, to
 *                                        any `aquariums.manage`
 *
 * PARTNER_SERVICE holds both permissions. What must fail: the picker giving a
 * partner anyone but its own customer; the staff list answering a partner.
 * The control: an internal caller gets exactly what it got before.
 */

const user = (over: Partial<AuthenticatedUser>): AuthenticatedUser => ({
  id: "u-1",
  email: "teszt@example.invalid",
  displayName: "Teszt Kolléga",
  role: "PARTNER_SERVICE",
  customerId: null,
  supplierId: null,
  ...over,
});

const INTERNAL = user({ role: "SERVICE" });
const PARTNER = user({ customerId: "sajat-ugyfel" });
const SUPPLIER_PARTNER = user({ supplierId: "szallito-1" });

function customersService() {
  const calls: { search?: string; onlyCustomerId?: string }[] = [];
  const repository = {
    searchSelectableCustomers: async (
      search?: string,
      onlyCustomerId?: string,
    ) => {
      calls.push({ search, onlyCustomerId });
      return { items: [{ id: "x", displayName: "Kitalált Kft." }] };
    },
  };
  return {
    calls,
    service: new AquariumsService(repository as never, {} as never),
  };
}

describe("aquarium customer picker: a partner sees only its own customer", () => {
  it("a partner's search is narrowed to its own customer", async () => {
    const { calls, service } = customersService();
    await service.searchSelectableCustomers("kft", PARTNER);
    assert.deepEqual(calls, [
      { search: "kft", onlyCustomerId: "sajat-ugyfel" },
    ]);
  });

  it("a supplier-linked account gets nothing, and nothing is queried", async () => {
    const { calls, service } = customersService();
    assert.deepEqual(
      await service.searchSelectableCustomers("kft", SUPPLIER_PARTNER),
      { items: [] },
    );
    assert.equal(calls.length, 0);
  });

  it("control: an internal caller is not narrowed", async () => {
    const { calls, service } = customersService();
    await service.searchSelectableCustomers("kft", INTERNAL);
    assert.deepEqual(calls, [{ search: "kft", onlyCustomerId: undefined }]);
  });

  it("the query: a partner's filter is its own id only, an internal one is every buyer", () => {
    assert.deepEqual(selectableCustomerWhere("kft", "sajat-ugyfel"), {
      id: "sajat-ugyfel",
      isActive: true,
      displayName: { contains: "kft", mode: "insensitive" },
    });
    assert.deepEqual(selectableCustomerWhere(undefined, undefined), {
      partner: null,
      isActive: true,
    });
  });
});

describe("selectable maintainers: internal staff are not listed to a partner", () => {
  function maintainersService() {
    let queried = 0;
    const repository = {
      selectable: async () => {
        queried += 1;
        return [{ userId: "s-1", displayName: "Belső Kolléga" }];
      },
    };
    return {
      queried: () => queried,
      service: new AquariumMaintainersService(repository as never, {} as never),
    };
  }

  for (const [name, caller] of [
    ["customer partner", PARTNER],
    ["supplier partner", SUPPLIER_PARTNER],
  ] as const)
    it(`a ${name} is refused, and nothing is queried`, () => {
      const { queried, service } = maintainersService();
      assert.throws(() => service.selectable(caller), ForbiddenException);
      assert.equal(queried(), 0);
    });

  it("control: an internal caller gets the list", async () => {
    const { service } = maintainersService();
    assert.deepEqual(await service.selectable(INTERNAL), [
      { userId: "s-1", displayName: "Belső Kolléga" },
    ]);
  });
});
