import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type { AuthenticatedUser, WebshopOrderDetail } from "@acropora/types";

import { WebshopOrderTransferService } from "./webshop-order-transfer.service.js";

/*
  „UTALÁS BEÉRKEZETT” KÉZZEL (bb3a6bd5). MI PIROSÍT:
  - nem előre utalásos, vagy díjbekérő nélküli rendelésre is rögzít;
  - jövőbeli vagy nem létező nap, üres hivatkozás átmegy;
  - nem a díjbekérő összegét, nem a rögzítőt vagy nem a vágott hivatkozást írja;
  - a második rögzítés is értesít, vagy nem 409;
  - az értesítés nem a szerep birtokosainak, nem a rendelésszámmal megy.
*/
const USER = { id: "user_1" } as AuthenticatedUser;
// 2026-10-06 21:30 Budapest
const NOW = new Date("2026-10-06T19:30:00.000Z");

function setup(
  over: {
    provider?: string;
    proformaStatus?: string | null;
    exists?: boolean;
    /** A webshop válasza a lezárásra; ha Error, azt dobja. */
    shop?: Error;
    /** Már rögzített beérkezés (a lezárás újraküldéséhez). */
    receipt?: boolean;
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const notices: Record<string, unknown>[] = [];
  const shopCalls: { orderId: string; receipt: Record<string, unknown> }[] = [];
  const service = new WebshopOrderTransferService(
    {
      source: async () => ({
        order: {
          id: "order_55",
          display_id: 55,
          payment_collections: [
            {
              payments: [],
              payment_sessions: [
                {
                  provider_id: over.provider ?? "pp_acropora_transfer",
                  status: "pending_authorization",
                },
              ],
            },
          ],
        },
        status: { status: "pending_processing" },
      }),
      detail: async (id: string) => ({ id }) as WebshopOrderDetail,
      adminClient: async () => ({
        recordTransferReceipt: async (
          orderId: string,
          receipt: Record<string, unknown>,
        ) => {
          shopCalls.push({ orderId, receipt });
          if (over.shop) throw over.shop;
          return { recorded: true, payment_id: "pay_1" };
        },
      }),
    } as never,
    {
      proformas: async () =>
        new Map(
          over.proformaStatus === null
            ? []
            : [
                [
                  "order_55",
                  { id: "doc_p1", status: over.proformaStatus ?? "ISSUED" },
                ],
              ],
        ),
      proformaAmount: async () => ({
        amount: new Prisma.Decimal("4800"),
        currency: "HUF",
      }),
      createTransferReceipt: async (input: Record<string, unknown>) => {
        if (over.exists) return false;
        created.push(input);
        return true;
      },
      transferRecipients: async () => ["user_9", "user_7"],
      // a lezárás a TÁROLT beérkezést küldi: a rögzítés után ez már áll
      transferReceipts: async () =>
        new Map(
          created.length || over.receipt
            ? [
                [
                  "order_55",
                  {
                    source: "MANUAL",
                    receivedOn: "2026-10-06",
                    reference: "OTP 2026-10-06 0013",
                    amount: "4800.0000",
                    currency: "HUF",
                    recordedBy: "Teszt Elek",
                  },
                ],
              ]
            : [],
        ),
    } as never,
    {
      notifyWebshopTransferReceived: (notice: Record<string, unknown>) =>
        notices.push(notice),
    } as never,
  );
  return { service, created, notices, shopCalls };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (error) {
    return (error as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};

describe("recording a bank transfer by hand", () => {
  it("writes the proforma's amount, the person and the trimmed reference, then tells the role holders", async () => {
    const { service, created, notices } = setup();
    await service.recordManual(
      "order_55",
      { receivedOn: "2026-10-06", reference: "  OTP 2026-10-06 0013  " },
      USER,
      NOW,
    );
    assert.equal(created.length, 1);
    const row = created[0]!;
    assert.equal(row.orderId, "order_55");
    assert.equal(row.proformaId, "doc_p1");
    assert.equal(row.source, "MANUAL");
    assert.equal(row.bankTransactionId, null);
    assert.equal(row.reference, "OTP 2026-10-06 0013");
    assert.equal(row.receivedOn, "2026-10-06");
    assert.equal((row.amount as Prisma.Decimal).toFixed(0), "4800");
    assert.equal(row.recordedByUserId, "user_1");
    assert.deepEqual(notices, [
      {
        userIds: ["user_9", "user_7"],
        orderId: "order_55",
        displayId: 55,
        amount: "4 800 Ft",
      },
    ]);
  });

  it("only for a bank-transfer order with an issued proforma", async () => {
    for (const over of [
      { provider: "pp_acropora_cod" },
      { proformaStatus: null },
      { proformaStatus: "ISSUING" },
    ]) {
      const { service, created, notices } = setup(over);
      assert.equal(
        await status(
          service.recordManual(
            "order_55",
            { receivedOn: "2026-10-06", reference: "OTP" },
            USER,
            NOW,
          ),
        ),
        409,
        JSON.stringify(over),
      );
      assert.equal(created.length + notices.length, 0);
    }
  });

  it("refuses a day in the future, a day that does not exist, and an empty reference", async () => {
    for (const input of [
      { receivedOn: "2026-10-07", reference: "OTP" },
      { receivedOn: "2026-02-30", reference: "OTP" },
      { receivedOn: "2026-10-06", reference: "   " },
    ]) {
      const { service, created } = setup();
      assert.equal(
        await status(service.recordManual("order_55", input, USER, NOW)),
        422,
        JSON.stringify(input),
      );
      assert.equal(created.length, 0);
    }
  });

  it("a second record is refused and tells nobody again", async () => {
    const { service, notices } = setup({ exists: true });
    assert.equal(
      await status(
        service.recordManual(
          "order_55",
          { receivedOn: "2026-10-06", reference: "OTP" },
          USER,
          NOW,
        ),
      ),
      409,
    );
    assert.equal(notices.length, 0);
  });
});

/*
  A WEBSHOP OLDALA (commerce #509). MI PIROSÍT: a rögzítés után a webshop nem
  kapja meg a beérkezést, vagy nem a tárolt hivatkozást, napot és összeget
  kapja; a webshop hibája visszavonja vagy elnyeli az OS rögzítését; a
  lezárás újraküldése beérkezés nélkül is hív, vagy a hibáját elnyeli.
*/
describe("closing the payment in the shop", () => {
  it("after the record the shop gets the stored reference, day and amount", async () => {
    const { service, shopCalls } = setup();
    await service.recordManual(
      "order_55",
      { receivedOn: "2026-10-06", reference: "OTP 2026-10-06 0013" },
      USER,
      NOW,
    );
    assert.deepEqual(shopCalls, [
      {
        orderId: "order_55",
        receipt: {
          reference: "OTP 2026-10-06 0013",
          received_at: "2026-10-06",
          amount: 4800,
        },
      },
    ]);
  });

  it("a shop failure keeps the OS record and the notice", async () => {
    const { service, created, notices } = setup({ shop: new Error("503") });
    await service.recordManual(
      "order_55",
      { receivedOn: "2026-10-06", reference: "OTP" },
      USER,
      NOW,
    );
    assert.equal(created.length, 1);
    assert.equal(notices.length, 1);
  });

  it("the resend needs a record, and names the shop's refusal", async () => {
    const none = setup();
    assert.equal(await status(none.service.syncShop("order_55", NOW)), 409);
    assert.equal(none.shopCalls.length, 0);

    const failing = setup({
      receipt: true,
      shop: new Error("Az összeg eltér"),
    });
    await assert.rejects(failing.service.syncShop("order_55", NOW), {
      message: /webshop fizetése nem zárult le: Az összeg eltér/,
    });

    const ok = setup({ receipt: true });
    await ok.service.syncShop("order_55", NOW);
    assert.equal(ok.shopCalls.length, 1);
  });
});
