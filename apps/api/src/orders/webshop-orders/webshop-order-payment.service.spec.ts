import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser, WebshopOrderDetail } from "@acropora/types";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { WebshopOrderPaymentService } from "./webshop-order-payment.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  A LEJÁRÓ ZÁROLÁS GOMBJAI. MI PIROSÍT: a gomb akkor is a webshopig megy,
  amikor az adatlap nem kínálja; a „Vevő értesítése” nem jut el; a webshop
  elutasítása 500, vagy elveszik a mondata; a bukott művelet is auditba kerül.
*/
const USER = { id: "user_1" } as AuthenticatedUser;

function setup(
  card: Partial<NonNullable<WebshopOrderDetail["cardPayment"]>> | null,
  fail?: MedusaAdminHttpError,
) {
  const calls: string[] = [];
  const audited: unknown[] = [];
  const client = {
    releaseHold: async (id: string, notify: boolean) => {
      calls.push(`release ${id} ${notify}`);
      if (fail) throw fail;
      return { sent: false, reason: "mail_off" };
    },
    sendPaymentLink: async (id: string, notify: boolean) => {
      calls.push(`link ${id} ${notify}`);
      if (fail) throw fail;
      return { sent: true };
    },
  } as unknown as MedusaAdminClient;
  const orders = {
    detail: async (id: string) =>
      ({
        id,
        cardPayment: card && { canRelease: false, canSendLink: false, ...card },
      }) as unknown as WebshopOrderDetail,
    adminClient: async () => client,
  } as unknown as WebshopOrdersService;
  const repository = {
    recordPaymentAction: async (input: unknown) => void audited.push(input),
  } as unknown as WebshopOrdersRepository;
  return {
    calls,
    audited,
    service: new WebshopOrderPaymentService(orders, repository),
  };
}

describe("WebshopOrderPaymentService", () => {
  it("Csúszik a szállítás releases the hold with the notify choice, audited", async () => {
    const { calls, audited, service } = setup({ canRelease: true });
    const result = await service.releaseHold("order_38", false, USER);
    assert.deepEqual(calls, ["release order_38 false"]);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        action: "release-hold",
        mail: { sent: false, reason: "mail_off" },
      },
    ]);
    assert.deepEqual(result.mail, { sent: false, reason: "mail_off" });
  });

  it("Fizetési link küldése sends the link, audited", async () => {
    const { calls, audited, service } = setup({ canSendLink: true });
    const result = await service.sendPaymentLink("order_38", true, USER);
    assert.deepEqual(calls, ["link order_38 true"]);
    assert.equal((audited[0] as { action: string }).action, "payment-link");
    assert.deepEqual(result.mail, { sent: true });
  });

  it("what the page does not offer never reaches the webshop", async () => {
    for (const card of [null, { canRelease: false }]) {
      const { calls, service } = setup(card);
      await assert.rejects(service.releaseHold("order_38", true, USER), {
        status: 409,
      });
      await assert.rejects(service.sendPaymentLink("order_38", true, USER), {
        status: 409,
      });
      assert.deepEqual(calls, []);
    }
  });

  it("a refusal keeps the webshop's sentence as 422, and is not audited; a 5xx is 503", async () => {
    const refused = setup(
      { canRelease: true },
      new MedusaAdminHttpError(
        400,
        JSON.stringify({ message: "A zárolás már levonva" }),
      ),
    );
    await assert.rejects(refused.service.releaseHold("order_38", true, USER), {
      status: 422,
      message: "A webshop elutasította: A zárolás már levonva",
    });
    assert.deepEqual(refused.audited, []);
    const down = setup(
      { canSendLink: true },
      new MedusaAdminHttpError(502, "bad gateway"),
    );
    await assert.rejects(down.service.sendPaymentLink("order_38", true, USER), {
      status: 503,
    });
  });
});
