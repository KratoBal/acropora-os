import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaOrderPayment } from "../../integrations/medusa/medusa-admin.client.js";
import {
  cardPaymentOf,
  holdWarningOf,
  parcelPaymentRefusal,
} from "./webshop-order-card-payment.rules.js";

/*
  A LEJÁRÓ ZÁROLÁS. MI PIROSÍT: az 5. napon nincs jelzés, vagy a 4. napon már
  van; a lejárt zárolás nem lejártként áll; a kiszállított rendelésen jelez;
  a „Csúszik a szállítás” visszaigazolás előtt vagy feloldott zárolásnál
  áll; a link zárolt vagy kifizetett rendelésnél áll; csomag megy a fizetés
  előtt.
*/
const AUTHORIZED = new Date("2026-10-01T10:00:00.000Z");
const EXPIRES = "2026-10-08T10:00:00.000Z"; // + 7 nap
const day = (n: number) => new Date(AUTHORIZED.getTime() + n * 24 * 3_600_000);

const payment = (
  over: Partial<MedusaOrderPayment> = {},
): MedusaOrderPayment => ({
  state: "hold",
  hold: {
    authorized_at: AUTHORIZED.toISOString(),
    expires_at: EXPIRES,
    amount: 22150,
  },
  link: null,
  paid_at: null,
  ...over,
});

describe("the hold's warning", () => {
  it("from the 5th day it is soon, after the 7th it is expired; on the 4th nothing", () => {
    assert.equal(holdWarningOf(EXPIRES, "stocking", day(4)), null);
    assert.equal(holdWarningOf(EXPIRES, "stocking", day(5)), "soon");
    assert.equal(holdWarningOf(EXPIRES, "confirmed", day(6.9)), "soon");
    assert.equal(holdWarningOf(EXPIRES, "stocking", day(7)), "expired");
  });

  it("an order out for delivery or closed, or without a hold, does not warn", () => {
    for (const status of [
      "out_for_delivery",
      "closed",
      "closed_unsuccessfully",
    ] as const)
      assert.equal(holdWarningOf(EXPIRES, status, day(6)), null);
    assert.equal(holdWarningOf(null, "stocking", day(6)), null);
  });
});

describe("the card payment on the page", () => {
  it("a hold: its expiry and warning, and Csúszik a szállítás once confirmed", () => {
    const card = cardPaymentOf(payment(), "stocking", day(5));
    assert.deepEqual(card, {
      state: "hold",
      holdExpiresAt: EXPIRES,
      holdWarning: "soon",
      link: null,
      paidAt: null,
      due: null,
      canRelease: true,
      canSendLink: false,
    });
    assert.equal(
      cardPaymentOf(payment(), "pending_processing", day(1))!.canRelease,
      false,
    );
    assert.equal(
      cardPaymentOf(payment(), "out_for_delivery", day(1))!.canRelease,
      false,
    );
  });

  it("released: the link can go (again too), not after payment or on a closed order", () => {
    for (const state of [
      "awaiting_payment",
      "link_sent",
      "reminded",
      "expired",
    ]) {
      const card = cardPaymentOf(
        payment({ state, hold: null }),
        "stocking",
        day(8),
      )!;
      assert.deepEqual(
        [card.canSendLink, card.canRelease, card.holdWarning],
        [true, false, null],
      );
    }
    assert.equal(
      cardPaymentOf(payment({ state: "paid", hold: null }), "stocking", day(8))!
        .canSendLink,
      false,
    );
    assert.equal(
      cardPaymentOf(
        payment({ state: "link_sent", hold: null }),
        "closed_unsuccessfully",
        day(8),
      )!.canSendLink,
      false,
    );
  });

  it("the link's facts are carried; an unknown state or no payment is no card payment", () => {
    const card = cardPaymentOf(
      payment({
        state: "link_sent",
        hold: null,
        link: {
          sent_at: "2026-10-09T08:00:00.000Z",
          expires_at: "2026-10-12T08:00:00.000Z",
          reminded_at: null,
          amount: 11650,
          url: "https://shop.example/fizetes/tok",
        },
      }),
      "stocking",
      day(8),
    )!;
    assert.deepEqual(card.link, {
      sentAt: "2026-10-09T08:00:00.000Z",
      expiresAt: "2026-10-12T08:00:00.000Z",
      remindedAt: null,
      amount: 11650,
      url: "https://shop.example/fizetes/tok",
    });
    assert.equal(
      cardPaymentOf(payment({ state: "something_new" }), "stocking", day(1)),
      null,
    );
    assert.equal(cardPaymentOf(null, "stocking", day(1)), null);
  });

  it("an added line over the hold: the hold stays and still warns, the link is for the difference", () => {
    // murena L2b, Balázs „Mehet” 18:01 UTC
    const card = cardPaymentOf(
      payment({
        state: "awaiting_payment",
        due: { amount: 3500, reason: "difference" },
      }),
      "stocking",
      day(5),
    )!;
    assert.deepEqual(
      [
        card.holdExpiresAt,
        card.holdWarning,
        card.due,
        card.canSendLink,
        card.canRelease,
      ],
      [EXPIRES, "soon", { amount: 3500, reason: "difference" }, true, false],
    );
    assert.match(parcelPaymentRefusal(card) ?? "", /kifizetése után/);
  });

  it("none (cash on delivery, pay at store, cancelled) is no card payment, and blocks nothing", () => {
    const card = cardPaymentOf(
      payment({ state: "none", hold: null }),
      "stocking",
      day(1),
    );
    assert.equal(card, null);
    assert.equal(parcelPaymentRefusal(card), null);
  });

  it("a parcel waits for the payment after a released hold", () => {
    assert.equal(parcelPaymentRefusal(null), null);
    assert.equal(
      parcelPaymentRefusal(cardPaymentOf(payment(), "stocking", day(1))),
      null,
    );
    assert.equal(
      parcelPaymentRefusal(
        cardPaymentOf(
          payment({ state: "paid", hold: null }),
          "stocking",
          day(9),
        ),
      ),
      null,
    );
    for (const state of [
      "awaiting_payment",
      "link_sent",
      "reminded",
      "expired",
    ])
      assert.match(
        parcelPaymentRefusal(
          cardPaymentOf(payment({ state, hold: null }), "stocking", day(8)),
        ) ?? "",
        /fizetési link kifizetése után/,
      );
  });
});
