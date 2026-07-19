import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProductCreated } from "./domain-events.js";

describe("domain event contracts", () => {
  it("preserves envelope metadata and typed payload", () => {
    const event: ProductCreated = {
      eventId: "event-1",
      eventType: "product.created",
      aggregateType: "Product",
      aggregateId: "product-1",
      occurredAt: "2026-07-19T12:00:00.000Z",
      actorUserId: "user-1",
      correlationId: "request-1",
      payload: { name: "Reef Salt", productType: "PHYSICAL" },
      schemaVersion: 1,
    };

    assert.equal(event.eventType, "product.created");
    assert.equal(event.payload.productType, "PHYSICAL");
    assert.equal(event.schemaVersion, 1);
  });
});
