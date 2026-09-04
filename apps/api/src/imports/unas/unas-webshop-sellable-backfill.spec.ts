import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideSellableBackfill,
  summarizeSellableBackfill,
} from "./unas-webshop-sellable-backfill.js";

describe("webshopos eladhatóság visszatöltése", () => {
  it("a meglévő szabállyal állítja helyre a listázott, nem árajánlatos terméket", () => {
    assert.deepEqual(
      decideSellableBackfill([
        {
          id: "p1",
          webshopSellable: false,
          externalStatus: "1",
          rawPayload: { Inquire: "0" },
        },
      ]),
      [{ id: "p1", webshopSellable: true }],
    );
  });
  it("külön számolja az átnézettet, az átírtat és a helyesen hamisat", () => {
    assert.deepEqual(
      summarizeSellableBackfill([
        {
          id: "p1",
          webshopSellable: false,
          externalStatus: "1",
          rawPayload: { Inquire: "0" },
        },
        {
          id: "p2",
          webshopSellable: false,
          externalStatus: "0",
          rawPayload: { Inquire: "1" },
        },
      ]),
      { inspected: 2, updated: 1, remainedFalse: 1 },
    );
  });
});
