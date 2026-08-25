import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";

import type { AiUserContextRepository } from "./ai-user-context.repository.js";
import { AiUserContextService } from "./ai-user-context.service.js";

const repository = (findCustomerIdentity: unknown) =>
  ({ findCustomerIdentity }) as unknown as AiUserContextRepository;

describe("AiUserContextService", () => {
  it("returns the customer identity and nothing else", async () => {
    const service = new AiUserContextService(
      repository(async () => ({ id: "cus_1", customerNumber: "V-00123" })),
    );

    const context = await service.forCustomer("cus_1");

    assert.deepEqual(context, {
      subjectType: "customer",
      customerId: "cus_1",
      customerNumber: "V-00123",
      entitlements: {},
      entitlementsStatus: "not-modelled",
      entitlementsNote: context.entitlementsNote,
    });
  });

  it("returns no name, e-mail, phone or address", async () => {
    // A deepEqual above would already fail on an extra key, but this states
    // the privacy rule as its own assertion so that a future reader sees it
    // was a decision rather than an omission.
    const service = new AiUserContextService(
      repository(async () => ({ id: "cus_1", customerNumber: "V-00123" })),
    );

    const keys = Object.keys(await service.forCustomer("cus_1")).sort();

    assert.deepEqual(keys, [
      "customerId",
      "customerNumber",
      "entitlements",
      "entitlementsNote",
      "entitlementsStatus",
      "subjectType",
    ]);
  });

  it("reports an empty entitlement set as not modelled, not as denied", async () => {
    const service = new AiUserContextService(
      repository(async () => ({ id: "cus_1", customerNumber: "V-00123" })),
    );

    const context = await service.forCustomer("cus_1");

    // The shape is the contract: an object a caller can already query, so
    // that the model arriving later changes contents, not types.
    assert.equal(typeof context.entitlements, "object");
    assert.notEqual(context.entitlements, null);
    assert.deepEqual(context.entitlements, {});
    assert.equal(context.entitlementsStatus, "not-modelled");
    assert.match(context.entitlementsNote, /nem létezik/);
  });

  it("refuses an unknown customer", async () => {
    const service = new AiUserContextService(repository(async () => null));

    await assert.rejects(
      () => service.forCustomer("cus_missing"),
      NotFoundException,
    );
  });

  it("asks the repository for the id it was given", async () => {
    let asked: string | undefined;
    const service = new AiUserContextService(
      repository(async (id: string) => {
        asked = id;
        return { id, customerNumber: "V-00123" };
      }),
    );

    await service.forCustomer("cus_42");
    assert.equal(asked, "cus_42");
  });
});
