import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CustomersService } from "./customers.service.js";
import type { CustomersRepository } from "./customers.repository.js";
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
} from "./dto/customer.dto.js";

/** A repository that only remembers what it was given. */
function service() {
  const seen: Array<{ euTaxNumber?: string | null }> = [];
  const repository = {
    create: async (input: CreateCustomerDto) => {
      seen.push(input);
      return { id: "c1" };
    },
    update: async (_id: string, input: UpdateCustomerDto) => {
      seen.push(input);
      return { id: "c1" };
    },
    detail: async () => ({ id: "c1" }),
  } as unknown as CustomersRepository;
  return { customers: new CustomersService(repository), seen };
}

const company = (euTaxNumber?: string): CreateCustomerDto =>
  ({
    type: "COMPANY",
    displayName: "Slovak s.r.o.",
    euTaxNumber,
    addresses: [],
  }) as unknown as CreateCustomerDto;

describe("CustomersService: the community tax number", () => {
  it("stores it in one shape, clears it when empty, and refuses another shape", async () => {
    const { customers, seen } = service();
    await customers.create(company("sk 2020-123 456"), "u1");
    await customers.update(
      "c1",
      { euTaxNumber: "", expectedUpdatedAt: "x" } as UpdateCustomerDto,
      "u1",
    );
    await customers.update(
      "c1",
      { expectedUpdatedAt: "x" } as UpdateCustomerDto,
      "u1",
    );
    const refused = await customers.create(company("12345678"), "u1").then(
      () => null,
      (error: Error) => error.constructor.name,
    );
    assert.deepEqual(
      [seen.map((input) => input.euTaxNumber), refused, seen.length],
      [["SK2020123456", null, undefined], "BadRequestException", 3],
      "CUSTOMER-EU-TAX",
    );
  });
});
