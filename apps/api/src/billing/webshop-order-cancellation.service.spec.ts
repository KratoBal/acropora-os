import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WebshopOrderCancellationService } from "./webshop-order-cancellation.service.js";

/*
  IS THE WEBSHOP ORDER CANCELLED, FOR THE SHARED ISSUE (card ba6b8256). WHAT TURNS RED: Medusa's canceled or the unsuccessful
  close is not seen; an order in progress counts as cancelled; a shop that does not answer (an error, or no order) passes as
  not cancelled.
*/
const reader = (
  answer: { order: { status?: string } | null; business?: string } | Error,
) =>
  new WebshopOrderCancellationService(
    { resolve: async () => ({ apiKey: "k" }) } as never,
    (() => ({
      order: async () => {
        if (answer instanceof Error) throw answer;
        return answer.order;
      },
      orderBusinessStatus: async () =>
        answer instanceof Error || !answer.business
          ? null
          : { status: answer.business },
    })) as never,
  );

describe("the webshop order's cancel state for the shared issue", () => {
  it("Medusa's canceled, the unsuccessful close, or nothing", async () => {
    assert.equal(
      await reader({ order: { status: "canceled" } }).of("o1"),
      "canceled",
    );
    assert.equal(
      await reader({
        order: { status: "pending" },
        business: "closed_unsuccessfully",
      }).of("o1"),
      "closed_unsuccessfully",
    );
    assert.equal(
      await reader({ order: { status: "pending" }, business: "confirmed" }).of(
        "o1",
      ),
      null,
    );
  });

  it("a shop that does not answer is unreadable, never not cancelled", async () => {
    assert.equal(await reader(new Error("down")).of("o1"), "unreadable");
    assert.equal(await reader({ order: null }).of("o1"), "unreadable");
  });
});
