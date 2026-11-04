import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CustomersService } from "./customers.service.js";
import type { CustomersRepository } from "./customers.repository.js";
import type {
  CreateCustomerDto,
  UpdateCustomerDto,
} from "./dto/customer.dto.js";

/** A repository that only remembers what it was given. */
function service(existing: Record<string, unknown> = {}) {
  const seen: Array<{
    euTaxNumber?: string | null;
    taxNumber?: string | null;
  }> = [];
  const repository = {
    create: async (input: CreateCustomerDto) => {
      seen.push(input);
      return { id: "c1" };
    },
    update: async (_id: string, input: UpdateCustomerDto) => {
      seen.push(input);
      if (existing.failWith) throw new Error(String(existing.failWith));
      return { id: "c1" };
    },
    detail: async () => ({ id: "c1", ...existing }),
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

  it("refuses a Hungarian community number: a Hungarian company has a tax number", async () => {
    const { customers, seen } = service();
    const refused = await customers.create(company("hu 12345678"), "u1").then(
      () => null,
      (error: Error & { message: string }) => error.message,
    );
    assert.deepEqual(
      [refused, seen.length],
      ["Magyar cégnél az adószám mezőt töltsd ki.", 0],
      "CUSTOMER-EU-TAX-HU",
    );
  });
});

describe("CustomersService: editing an existing customer (acrobot 42510)", () => {
  const edit = (input: Record<string, unknown>) =>
    ({ expectedUpdatedAt: "x", ...input }) as unknown as UpdateCustomerDto;

  it("stores the Hungarian tax number in the dotted shape and clears it when empty", async () => {
    const { customers, seen } = service();
    await customers.update("c1", edit({ taxNumber: "12345678142" }), "u1");
    await customers.update("c1", edit({ taxNumber: "" }), "u1");
    await customers.update("c1", edit({}), "u1");
    assert.deepEqual(
      seen.map((input) => input.taxNumber),
      ["12345678-1-42", null, undefined],
    );
  });

  it("refuses a Hungarian tax number of another shape, with the sentence", async () => {
    const { customers, seen } = service();
    for (const typed of ["1234", "SK2020123456", "12345678"])
      await assert.rejects(
        customers.update("c1", edit({ taxNumber: typed }), "u1"),
        (error: Error) =>
          error.constructor.name === "BadRequestException" &&
          /közösségi adószám/.test(error.message),
        typed,
      );
    assert.equal(seen.length, 0, "nothing reached the repository");
  });

  it("lets an old, oddly typed number that is already stored stay, so saving another field is not blocked", async () => {
    const { customers, seen } = service({ taxNumber: "12 34 56 78-1-42x" });
    await customers.update(
      "c1",
      edit({ taxNumber: "12 34 56 78-1-42x", phone: "+36 1" }),
      "u1",
    );
    assert.equal(
      seen[0]!.taxNumber,
      undefined,
      "the stored value is not rewritten",
    );
  });

  it("refuses an edit of a partner's customer mirror, naming where to do it", async () => {
    const { customers, seen } = service({ partnerMirror: true });
    await assert.rejects(
      customers.update("c1", edit({ phone: "+36 1" }), "u1"),
      (error: Error) =>
        error.constructor.name === "ConflictException" &&
        /Partnerek képernyőn/.test(error.message),
    );
    assert.equal(seen.length, 0);
  });

  it("passes the type and the addresses to the repository", async () => {
    const { customers, seen } = service();
    const addresses = [
      {
        type: "BILLING",
        postalCode: "1146",
        city: "Budapest",
        line1: "Állatkerti krt. 6",
      },
    ];
    await customers.update("c1", edit({ type: "COMPANY", addresses }), "u1");
    assert.deepEqual(
      [
        (seen[0] as { type?: string }).type,
        (seen[0] as { addresses?: unknown }).addresses,
      ],
      ["COMPANY", addresses],
    );
  });

  it("says so in a sentence when an address does not belong to the customer", async () => {
    const { customers } = service({ failWith: "ADDRESS_NOT_OWNED" });
    await assert.rejects(
      customers.update("c1", edit({ addresses: [{ id: "a-other" }] }), "u1"),
      (error: Error) =>
        error.constructor.name === "BadRequestException" &&
        /nem ehhez a vevőhöz tartozik/.test(error.message),
    );
  });

  it("keeps the stale-edit sentence for a customer changed by someone else", async () => {
    const { customers } = service({ failWith: "STALE_UPDATE" });
    await assert.rejects(
      customers.update("c1", edit({ phone: "+36 1" }), "u1"),
      (error: Error) => error.constructor.name === "ConflictException",
    );
  });
});
