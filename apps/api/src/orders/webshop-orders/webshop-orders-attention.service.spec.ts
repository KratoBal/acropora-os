import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
  type MedusaOrderAttention,
} from "../../integrations/medusa/medusa-admin.client.js";
import { MedusaConnectionError } from "../../integrations/medusa/medusa-connection.types.js";
import type { MedusaCredentialProvider } from "../../integrations/medusa/medusa-credential.provider.js";
import type { WebshopParcelService } from "../../integrations/carriers/webshop-parcel.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersController } from "./webshop-orders.controller.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  A FIGYELMET KÉRŐ RENDELÉSEK (commerce-audit-p1, P1/6). MI PIROSÍT: ha a
  várakozás nem percben jön át; ha egy rendelés nélküli sor eldobódik; ha a
  webshop hibája vagy a hiányzó kapcsolat elviszi a rendelés-lista oldalát
  (500) ahelyett, hogy `available: false` lenne; ha a hiba "nincs teendő"-nek
  látszik (üres lista, `available: true`); ha az OS a figyelmeztetésből bármit
  ír vagy zár; ha a végpont a `:id` útvonal alatt olvasódna rendelés-azonosítónak.
*/
const ATTENTION: MedusaOrderAttention = {
  generated_at: "2026-10-27T16:00:00.000Z",
  count: 2,
  items: [
    {
      kind: "pickup_missing",
      order_id: "order_1",
      display_id: 57,
      parent_cart_id: "cart_s",
      pickup_cart_id: "cart_p",
      since: "2026-10-27T15:00:00.000Z",
      minutes: 60,
    },
    {
      kind: "pickup_missing",
      order_id: null,
      display_id: null,
      parent_cart_id: "cart_s2",
      pickup_cart_id: "cart_p2",
      since: "2026-10-27T14:00:00.000Z",
      minutes: 120,
    },
  ],
};

function service(options: {
  body?: MedusaOrderAttention;
  fail?: "http404" | "http502" | "credential";
}) {
  const client = {
    orderAttention: async () => {
      if (options.fail === "http404")
        throw new MedusaAdminHttpError(404, "not found");
      if (options.fail === "http502")
        throw new MedusaAdminHttpError(502, "bad gateway");
      return options.body ?? ATTENTION;
    },
  } as unknown as MedusaAdminClient;
  const credentials = {
    resolve: async () => {
      if (options.fail === "credential")
        throw new MedusaConnectionError(
          "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
        );
      return { apiKey: "sk_test", source: "database", revision: "r1" };
    },
  } as unknown as MedusaCredentialProvider;
  return new WebshopOrdersService(
    credentials,
    {} as unknown as WebshopOrdersRepository,
    {} as unknown as WebshopParcelService,
    () => client,
  );
}

describe("WebshopOrdersService.attention", () => {
  it("gives the webshop's list on the OS's names, the wait in minutes", async () => {
    const result = await service({}).attention();
    assert.equal(result.available, true);
    assert.equal(result.count, 2);
    assert.deepEqual(result.items, [
      {
        kind: "pickup_missing",
        orderId: "order_1",
        displayId: 57,
        since: "2026-10-27T15:00:00.000Z",
        waiting: 60,
      },
      {
        kind: "pickup_missing",
        orderId: null,
        displayId: null,
        since: "2026-10-27T14:00:00.000Z",
        waiting: 120,
      },
    ]);
  });

  it("an empty list from the webshop is available and empty: nothing needs attention", async () => {
    const result = await service({
      body: { generated_at: "x", count: 0, items: [] },
    }).attention();
    assert.deepEqual(result, { available: true, count: 0, items: [] });
  });

  it("a webshop that does not know the endpoint yet, fails, or has no connection: unavailable, not 'nothing to do', and not an error", async () => {
    for (const fail of ["http404", "http502", "credential"] as const) {
      const result = await service({ fail }).attention();
      assert.deepEqual(result, { available: false, count: 0, items: [] }, fail);
    }
  });
});

describe("the attention route", () => {
  it("is declared before the :id routes, so the word is not read as an order id", () => {
    const methods = Object.getOwnPropertyNames(
      WebshopOrdersController.prototype,
    );
    assert.ok(methods.includes("attention"));
    // Nest registers routes in the order the methods were declared
    assert.ok(
      methods.indexOf("attention") < methods.indexOf("detail") ||
        !methods.includes("detail"),
    );
  });
});
