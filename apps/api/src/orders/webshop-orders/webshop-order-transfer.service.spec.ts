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
  } = {},
) {
  const created: Record<string, unknown>[] = [];
  const notices: Record<string, unknown>[] = [];
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
    } as never,
    {
      notifyWebshopTransferReceived: (notice: Record<string, unknown>) =>
        notices.push(notice),
    } as never,
  );
  return { service, created, notices };
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
