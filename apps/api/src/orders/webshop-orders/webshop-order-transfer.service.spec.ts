import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { MedusaAdminHttpError } from "../../integrations/medusa/medusa-admin.client.js";
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
    /** only the FIRST call to the shop throws this (a shop that refuses a field, then takes the receipt without it) */
    shopFirst?: Error;
    /** Már rögzített beérkezés (a lezárás újraküldéséhez). */
    receipt?: boolean;
    /** A beérkezés díjbekérője előleg-díjbekérő (2b). */
    advance?: boolean;
    /** the advance proforma's number; `undefined`: "D-CRPR-7" */
    advanceNumber?: string | null;
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
          if (over.shopFirst && shopCalls.length === 1) throw over.shopFirst;
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
      receiptAdvanceProforma: async () =>
        over.advance
          ? {
              number:
                over.advanceNumber === undefined
                  ? "D-CRPR-7"
                  : over.advanceNumber,
            }
          : null,
      // no balance in these cases (S3 has its own setup below)
      balanceReceipts: async () => new Map(),
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
                    advance: false,
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

  /*
    AN ADVANCE PROFORMA'S TRANSFER (2b; barracuda on commerce #908). MI PIROSÍT: the shop is not told it is an advance (it would
    refuse the smaller amount), or a full proforma's transfer is marked as one (an underpaid order would read partly paid).
  */
  it("an advance proforma's transfer goes to the shop marked as the advance; a full one is not marked", async () => {
    const { service, shopCalls } = setup({ advance: true });
    await service.recordManual(
      "order_55",
      { receivedOn: "2026-10-06", reference: "ELO-1" },
      USER,
      NOW,
    );
    assert.equal(shopCalls[0]!.receipt.advance, true);
    const full = setup();
    await full.service.recordManual(
      "order_55",
      { receivedOn: "2026-10-06", reference: "OTP 1" },
      USER,
      NOW,
    );
    assert.equal("advance" in full.shopCalls[0]!.receipt, false);
  });

  /*
    THE NUMBER FOR THE BALANCE'S TRANSFER (acrobot 63071, commerce #914). MI PIROSÍT: the advance's receipt goes to the shop without
    the advance proforma's number; a full proforma's receipt carries one; or a number the shop would refuse is sent (the shop
    answers 400, and the whole advance would stay unrecorded there).
  */
  it("an advance's receipt carries the proforma's number; a full one carries none, nor does a number the shop would refuse", async () => {
    const { service, shopCalls } = setup({ advance: true });
    await service.recordManual(
      "order_55",
      { receivedOn: "2026-10-06", reference: "ELO-1" },
      USER,
      NOW,
    );
    assert.equal(shopCalls[0]!.receipt.balance_reference, "D-CRPR-7");

    const full = setup();
    await full.service.recordManual(
      "order_55",
      { receivedOn: "2026-10-06", reference: "OTP 1" },
      USER,
      NOW,
    );
    assert.equal("balance_reference" in full.shopCalls[0]!.receipt, false);

    for (const advanceNumber of [null, "D CRPR 7", "<7>"]) {
      const odd = setup({ advance: true, advanceNumber });
      await odd.service.recordManual(
        "order_55",
        { receivedOn: "2026-10-06", reference: "ELO-1" },
        USER,
        NOW,
      );
      // still an advance for the shop, only without the number
      assert.equal(odd.shopCalls[0]!.receipt.advance, true);
      assert.equal(
        "balance_reference" in odd.shopCalls[0]!.receipt,
        false,
        String(advanceNumber),
      );
    }
  });

  /*
    A SHOP WITHOUT commerce #914 (acrobot 63083: the live OS goes out daily, the live shop on Balázs's word). MI PIROSÍT: such a
    shop's 400 for the unknown field leaves the advance open; or any OTHER refusal is retried (a real refusal would be hidden).
  */
  it("a shop that does not know the number takes the advance without it; any other refusal stands", async () => {
    const unknownField = new MedusaAdminHttpError(
      400,
      JSON.stringify({
        type: "invalid_data",
        message: "Invalid request: Unrecognized fields: 'balance_reference'",
      }),
    );
    const old = setup({
      receipt: true,
      advance: true,
      shopFirst: unknownField,
    });
    await old.service.syncShop("order_55", NOW);
    assert.equal(old.shopCalls.length, 2);
    assert.equal(old.shopCalls[0]!.receipt.balance_reference, "D-CRPR-7");
    assert.equal("balance_reference" in old.shopCalls[1]!.receipt, false);
    assert.equal(old.shopCalls[1]!.receipt.advance, true);

    const refused = setup({
      receipt: true,
      advance: true,
      shopFirst: new MedusaAdminHttpError(
        400,
        JSON.stringify({
          message: "Invalid request: Unrecognized fields: 'amount_x'",
        }),
      ),
    });
    await assert.rejects(refused.service.syncShop("order_55", NOW));
    assert.equal(refused.shopCalls.length, 1);

    const conflict = setup({
      receipt: true,
      advance: true,
      shopFirst: new MedusaAdminHttpError(
        409,
        JSON.stringify({ message: "Az összeg eltér" }),
      ),
    });
    await assert.rejects(conflict.service.syncShop("order_55", NOW), {
      message: /Az összeg eltér/,
    });
    assert.equal(conflict.shopCalls.length, 1);
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

  /*
    A VALÓDI HIBA ALAKJA (stage-próba 2026-10-07, #56): a kliens
    MedusaAdminHttpError-t dob, a törzsben JSON-nal. A kezelő mondatában a
    webshop mondata áll, nem a hibakód és a JSON. MI PIROSÍT: a nyers üzenet
    (MEDUSA_ADMIN_HTTP_409 és a JSON) visszakerül a mondatba.
  */
  it("the operator gets the shop's own sentence, not the raw HTTP error", async () => {
    const shopSentence =
      "Az összeg eltér: a rendelés 5950 HUF, a beérkezés 5900.";
    const cases: Array<[MedusaAdminHttpError, string]> = [
      [
        new MedusaAdminHttpError(
          409,
          JSON.stringify({ type: "not_allowed", message: shopSentence }),
        ),
        shopSentence,
      ],
      [new MedusaAdminHttpError(409, "<html>nope</html>"), "HTTP 409"],
      [
        new MedusaAdminHttpError(503, "upstream down"),
        "a webshop nem érhető el (HTTP 503)",
      ],
    ];
    for (const [error, tail] of cases) {
      const failing = setup({ receipt: true, shop: error });
      await assert.rejects(failing.service.syncShop("order_55", NOW), (e) => {
        const message = (e as Error).message;
        assert.equal(
          message,
          `A beérkezés az OS-ben rögzítve van, de a webshop fizetése nem zárult le: ${tail}`,
        );
        assert.equal(/MEDUSA_ADMIN_HTTP|\{/.test(message), false);
        return true;
      });
    }
  });
});

/*
  „HÁTRALÉK BEÉRKEZETT” (kártya d31a66a3, S3). MI PIROSÍT:
  - előleg nélkül (nincs beérkezés, vagy egész díjbekérőé) is rögzít;
  - a második hátralék is rögzít vagy értesít, és nem 409;
  - az összeg nem a rendelés végösszege mínusz az előleg, vagy a kezelőtől jön;
  - az előleg napja előtti hátralék átmegy;
  - a webshopnak `advance` jellel, más hivatkozással vagy más összeggel megy;
  - a "Webshop fizetés lezárása" a rögzített hátralékot nem küldi újra.
*/
describe("Hátralék beérkezett (S3)", () => {
  function balanceSetup(
    over: {
      receipt?: "advance" | "whole" | null;
      balance?: boolean;
      exists?: boolean;
      total?: number;
      /** Medusa's own order state (barracuda N3a) */
      orderStatus?: string;
      business?: string;
    } = {},
  ) {
    const created: Record<string, unknown>[] = [];
    const notices: Record<string, unknown>[] = [];
    const shopCalls: Record<string, unknown>[] = [];
    const receiptKind = over.receipt === undefined ? "advance" : over.receipt;
    const balanceRow = () =>
      created.length || over.balance
        ? new Map([
            [
              "order_55",
              {
                source: "MANUAL",
                receivedOn: "2026-10-06",
                reference: "OTP hátralék 77",
                amount: "8200.0000",
                currency: "HUF",
                recordedBy: "Teszt Elek",
              },
            ],
          ])
        : new Map();
    const service = new WebshopOrderTransferService(
      {
        source: async () => ({
          order: {
            id: "order_55",
            display_id: 55,
            total: over.total ?? 13000,
            status: over.orderStatus ?? "pending",
          },
          status: { status: over.business ?? "pending_processing" },
        }),
        detail: async (id: string) => ({ id }) as WebshopOrderDetail,
        adminClient: async () => ({
          recordTransferReceipt: async (
            _orderId: string,
            receipt: Record<string, unknown>,
          ) => {
            shopCalls.push(receipt);
            return { recorded: true, payment_id: "pay_1" };
          },
        }),
      } as never,
      {
        transferReceipts: async () =>
          new Map(
            receiptKind === null
              ? []
              : [
                  [
                    "order_55",
                    {
                      source: "BANK_PAIRING",
                      receivedOn: "2026-10-02",
                      reference: "OTP előleg 12",
                      amount: "4800.0000",
                      currency: "HUF",
                      recordedBy: null,
                      advance: receiptKind === "advance",
                    },
                  ],
                ],
          ),
        balanceReceipts: async () => balanceRow(),
        createBalanceReceipt: async (input: Record<string, unknown>) => {
          if (over.exists) return false;
          created.push(input);
          return true;
        },
        receiptAdvanceProforma: async () =>
          receiptKind === "advance" ? { number: "D-CRPR-7" } : null,
        transferRecipients: async () => ["user_9"],
      } as never,
      {
        notifyWebshopTransferReceived: (notice: Record<string, unknown>) =>
          notices.push(notice),
      } as never,
    );
    return { service, created, notices, shopCalls };
  }
  const input = { receivedOn: "2026-10-06", reference: "  OTP hátralék 77 " };

  it("az összeg a végösszeg mínusz az előleg, a webshopnak advance nélkül, a hátralék hivatkozásával megy", async () => {
    const { service, created, notices, shopCalls } = balanceSetup();
    await service.recordBalanceManual("order_55", input, USER, NOW);
    assert.equal(created.length, 1);
    assert.equal(
      (created[0]!.amount as Prisma.Decimal).toFixed(4),
      "8200.0000",
    );
    assert.equal(created[0]!.currency, "HUF");
    assert.equal(created[0]!.reference, "OTP hátralék 77");
    assert.equal(created[0]!.recordedByUserId, "user_1");
    assert.equal(created[0]!.source, "MANUAL");
    assert.deepEqual(shopCalls, [
      { reference: "OTP hátralék 77", received_at: "2026-10-06", amount: 8200 },
    ]);
    assert.equal(notices.length, 1);
    assert.equal(notices[0]!.displayId, 55);
  });

  // barracuda N3a: on a cancelled order the money that came in is a refund case, not a balance
  it("a lemondott vagy sikertelenül lezárt rendelésre nem rögzít, nem értesít, nem szól a webshopnak", async () => {
    for (const over of [
      { orderStatus: "canceled" },
      { business: "closed_unsuccessfully" },
    ]) {
      const { service, created, notices, shopCalls } = balanceSetup(over);
      let message = "";
      try {
        await service.recordBalanceManual("order_55", input, USER, NOW);
      } catch (error) {
        message = (error as Error).message;
      }
      assert.match(message, /hátralék nem rögzíthető/, JSON.stringify(over));
      assert.deepEqual([created, notices, shopCalls], [[], [], []]);
    }
  });

  it("előleg nélkül nem rögzít: nincs beérkezés, vagy az egész díjbekérőé volt", async () => {
    for (const receipt of [null, "whole"] as const) {
      const { service, created, shopCalls } = balanceSetup({ receipt });
      await assert.rejects(
        service.recordBalanceManual("order_55", input, USER, NOW),
        /csak előleg után/,
      );
      assert.equal(created.length + shopCalls.length, 0, String(receipt));
    }
  });

  it("a második hátralék 409, nem ír és nem értesít; ha a verseny a táblán dől el, ugyanígy", async () => {
    const already = balanceSetup({ balance: true });
    await assert.rejects(
      already.service.recordBalanceManual("order_55", input, USER, NOW),
      /már rögzítve/,
    );
    assert.equal(already.created.length + already.notices.length, 0);
    const race = balanceSetup({ exists: true });
    await assert.rejects(
      race.service.recordBalanceManual("order_55", input, USER, NOW),
      /már rögzítve/,
    );
    assert.equal(race.notices.length + race.shopCalls.length, 0);
  });

  it("nincs hátralék, ha az előleg a teljes végösszeg; az előleg napja előtti nap nem megy át", async () => {
    const whole = balanceSetup({ total: 4800 });
    await assert.rejects(
      whole.service.recordBalanceManual("order_55", input, USER, NOW),
      /nincs fizetendő hátralék/,
    );
    const early = balanceSetup();
    await assert.rejects(
      early.service.recordBalanceManual(
        "order_55",
        { receivedOn: "2026-10-01", reference: "x" },
        USER,
        NOW,
      ),
      /nem érkezhetett az előleg \(2026-10-02\) előtt/,
    );
    assert.equal(early.created.length, 0);
  });

  it("a Webshop fizetés lezárása az előleg után a rögzített hátralékot is újraküldi", async () => {
    const { service, shopCalls } = balanceSetup({ balance: true });
    await service.syncShop("order_55", NOW);
    assert.deepEqual(shopCalls, [
      {
        reference: "OTP előleg 12",
        received_at: "2026-10-02",
        amount: 4800,
        advance: true,
        // the resend brings the proforma's number too: an order recorded before it gets it this way (commerce #914)
        balance_reference: "D-CRPR-7",
      },
      { reference: "OTP hátralék 77", received_at: "2026-10-06", amount: 8200 },
    ]);
  });
});
