import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import type {
  MedusaGiftCardClient,
  MedusaGiftCardRow,
} from "./webshop-gift-cards.client.js";
import { toWebshopGiftCardTransaction } from "./webshop-gift-cards.rules.js";
import {
  type GiftCardAudit,
  WebshopGiftCardsService,
} from "./webshop-gift-cards.service.js";

/*
  A WEBSHOP AJÁNDÉKKÁRTYÁI (kártya 495c0007). MI PIROSÍT: kapcsoló nélkül a webshophoz nyúl; a kiadás nem adja vissza
  a kódot, vagy hibás bemenet a webshopig jut; a webshop sorai nem a lap alakjában jönnek; egy ismeretlen naplósor
  eltűnik; a webshop elutasítása nem a webshop szavával jön vissza; a kiadás vagy a kikapcsolás nem a felhasználó nevén
  áll az OS naplójában, a kiadás napló-sor nélkül is megy, vagy a teljes kód a naplóba kerül.
*/
const row = (over: Partial<MedusaGiftCardRow> = {}): MedusaGiftCardRow => ({
  id: "gcard_1",
  code_last4: "H4BW",
  initial_amount: 10000,
  balance: 4000,
  status: "active",
  expires_at: null,
  recipient_email: "vevo@example.test",
  note: "születésnap",
  created_at: "2026-11-19T05:00:00.000Z",
  ...over,
});

function fakeClient(fail?: MedusaAdminHttpError) {
  const calls: string[] = [];
  const client: MedusaGiftCardClient = {
    list: async () => {
      calls.push("list");
      return {
        gift_cards: [row(), row({ id: "gcard_2", status: "disabled" })],
        truncated: false,
      };
    },
    get: async (id) => {
      calls.push(`get:${id}`);
      return {
        ...row(),
        transactions: [
          {
            id: "t1",
            kind: "issue",
            amount: 10000,
            balance_after: 10000,
            reference: null,
            created_at: "x",
          },
          {
            id: "t2",
            kind: "redeem",
            amount: -6000,
            balance_after: 4000,
            reference: "cart_1",
            created_at: "y",
          },
        ],
      };
    },
    issue: async (body) => {
      calls.push(`issue:${JSON.stringify(body)}`);
      if (fail) throw fail;
      return {
        gift_card: row({ balance: body.amount, initial_amount: body.amount }),
        code: "7K3M-QX9P-2ZRT-H4BW",
      };
    },
    disable: async (id) => {
      calls.push(`disable:${id}`);
      return row({ status: "disabled" });
    },
  };
  return { client, calls };
}

/** The audit table: its writes go into the same call list as the shop's, so their order is checked too. */
function fakeAudit(calls: string[], fail?: "create" | "update") {
  const audit: GiftCardAudit = {
    auditLog: {
      create: async ({ data }) => {
        calls.push(`audit.create:${JSON.stringify(data)}`);
        if (fail === "create") throw new Error("db down");
        return { id: "audit_1" };
      },
      update: async ({ where, data }) => {
        calls.push(`audit.update:${where.id}:${JSON.stringify(data)}`);
        if (fail === "update") throw new Error("db down");
        return {};
      },
    },
  };
  return audit;
}

const service = (
  client: MedusaGiftCardClient,
  env: Record<string, string> = { MEDUSA_WEBSHOP_GIFT_CARDS: "true" },
  audit: GiftCardAudit = fakeAudit([]),
) => new WebshopGiftCardsService(async () => client, env, audit);

describe("the gift card service", () => {
  it("off: every call is 404 and the shop is not asked", async () => {
    const { client, calls } = fakeClient();
    const svc = service(client, {}, fakeAudit(calls));
    await assert.rejects(svc.list(), NotFoundException);
    await assert.rejects(svc.get("gcard_1"), NotFoundException);
    await assert.rejects(
      svc.issue({ amount: 10000 }, "user_1"),
      NotFoundException,
    );
    await assert.rejects(svc.disable("gcard_1", "user_1"), NotFoundException);
    assert.deepEqual(calls, []);
  });

  it("the list and one card with its ledger, in the screen's shape", async () => {
    const { client } = fakeClient();
    const list = await service(client).list();
    assert.deepEqual(
      list.giftCards.map((c) => [
        c.id,
        c.codeLast4,
        c.initialAmount,
        c.balance,
        c.status,
      ]),
      [
        ["gcard_1", "H4BW", 10000, 4000, "active"],
        ["gcard_2", "H4BW", 10000, 4000, "disabled"],
      ],
    );
    const one = await service(client).get("gcard_1");
    assert.deepEqual(
      one.transactions.map((t) => [
        t.kind,
        t.amount,
        t.balanceAfter,
        t.reference,
      ]),
      [
        ["issue", 10000, 10000, null],
        ["redeem", -6000, 4000, "cart_1"],
      ],
    );
  });

  it("issuing sends the parsed input and hands the code back once; bad input stops before the shop", async () => {
    const { client, calls } = fakeClient();
    const issued = await service(client, undefined, fakeAudit(calls)).issue(
      { amount: 15000, recipientEmail: " Vevo@Example.TEST ", note: "" },
      "user_1",
    );
    assert.equal(issued.code, "7K3M-QX9P-2ZRT-H4BW");
    assert.equal(issued.giftCard.initialAmount, 15000);
    // the person is on record BEFORE the shop is asked, and the card id is added after it answered
    assert.deepEqual(calls, [
      'audit.create:{"userId":"user_1","action":"webshop_gift_card.issue","entityType":"WebshopGiftCard","entityId":null,"metadata":{"amount":15000,"status":"requested"}}',
      'issue:{"amount":15000,"recipient_email":"vevo@example.test","note":null}',
      'audit.update:audit_1:{"entityId":"gcard_1","metadata":{"amount":15000,"status":"issued","codeLast4":"H4BW"}}',
    ]);
    // the full code is a secret: only its last four characters reach the log
    assert.ok(!calls.some((c) => c.startsWith("audit") && c.includes("7K3M")));
    const bad = fakeClient();
    await assert.rejects(
      service(bad.client, undefined, fakeAudit(bad.calls)).issue(
        { amount: 0 },
        "user_1",
      ),
      BadRequestException,
    );
    assert.deepEqual(bad.calls, []);
  });

  it("no audit row, no card: when the row cannot be written the shop is not asked", async () => {
    const { client, calls } = fakeClient();
    await assert.rejects(
      service(client, undefined, fakeAudit(calls, "create")).issue(
        { amount: 15000 },
        "user_1",
      ),
      /db down/,
    );
    assert.deepEqual(
      calls.map((c) => c.split(":")[0]),
      ["audit.create"],
    );
  });

  it("a card that exists keeps its code even if completing the row fails", async () => {
    const { client, calls } = fakeClient();
    const issued = await service(
      client,
      undefined,
      fakeAudit(calls, "update"),
    ).issue({ amount: 15000 }, "user_1");
    assert.equal(issued.code, "7K3M-QX9P-2ZRT-H4BW");
    assert.deepEqual(
      calls.map((c) => c.split(":")[0]),
      ["audit.create", "issue", "audit.update"],
    );
  });

  it("switching off is on record with the person and the card, after the shop did it", async () => {
    const { client, calls } = fakeClient();
    const card = await service(client, undefined, fakeAudit(calls)).disable(
      "gcard_1",
      "user_2",
    );
    assert.equal(card.status, "disabled");
    assert.deepEqual(calls, [
      "disable:gcard_1",
      'audit.create:{"userId":"user_2","action":"webshop_gift_card.disable","entityType":"WebshopGiftCard","entityId":"gcard_1","metadata":{"balance":4000,"codeLast4":"H4BW"}}',
    ]);
    // the card is already off in the shop: a failed row does not turn that into an error
    const failing = fakeClient();
    const off = await service(
      failing.client,
      undefined,
      fakeAudit(failing.calls, "create"),
    ).disable("gcard_1", "user_2");
    assert.equal(off.status, "disabled");
  });

  it("the shop's refusal comes back in its words", async () => {
    const { client } = fakeClient(
      new MedusaAdminHttpError(
        400,
        JSON.stringify({ message: "amount too large" }),
      ),
    );
    await assert.rejects(
      service(client).issue({ amount: 10000 }, "user_1"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /amount too large/.test(error.message),
    );
  });

  it("an unknown ledger kind shows as a hand correction, not dropped", () => {
    assert.equal(
      toWebshopGiftCardTransaction({
        id: "t",
        kind: "transfer",
        amount: 1,
        balance_after: 1,
      }).kind,
      "adjust",
    );
  });
});
