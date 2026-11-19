import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  couponState,
  toMedusaPromotion,
  toWebshopCoupon,
  type MedusaPromotionRow,
} from "./webshop-coupons.rules.js";

/*
  A KUPON ÉS A MEDUSA PROMÓCIÓ KÖZÖTT (kártya 393ae5cb). MI PIROSÍT: a cél nem a rendelés (a szállításra is jutna kedvezmény,
  Balázs 790da0cd); a fix összeg forint és bruttó nélkül megy; az érvényesség nem a budapesti nap egésze (téli és nyári
  időben); a lista egy nem-kupon promóciót kuponnak mutat; az állapot rossz sorrendben dönt.
*/

describe("toMedusaPromotion", () => {
  it("a percent coupon: the order's lines only, across them, active, with a code and the limit", () => {
    const body = toMedusaPromotion({
      code: "TAVASZ10",
      kind: "PERCENT",
      value: 10,
      validFrom: null,
      validUntil: null,
      usageLimit: 50,
    });
    assert.deepEqual(body, {
      code: "TAVASZ10",
      type: "standard",
      status: "active",
      is_automatic: false,
      is_tax_inclusive: true,
      limit: 50,
      application_method: {
        type: "percentage",
        target_type: "order",
        allocation: "across",
        value: 10,
      },
    });
  });

  it("an amount coupon carries forints, and a window becomes one campaign covering whole Budapest days", () => {
    const winter = toMedusaPromotion({
      code: "EZER",
      kind: "AMOUNT",
      value: 1000,
      validFrom: "2026-01-10",
      validUntil: "2026-01-12",
      usageLimit: null,
    });
    assert.deepEqual(winter.application_method, {
      type: "fixed",
      target_type: "order",
      allocation: "across",
      value: 1000,
      currency_code: "huf",
    });
    assert.deepEqual(winter.campaign, {
      name: "Kupon EZER",
      campaign_identifier: "kupon-ezer",
      starts_at: "2026-01-09T23:00:00.000Z",
      ends_at: "2026-01-12T22:59:59.999Z",
    });
    // summer time: the day starts two hours earlier in UTC
    const summer = toMedusaPromotion({
      code: "NYAR",
      kind: "PERCENT",
      value: 5,
      validFrom: "2026-07-01",
      validUntil: null,
      usageLimit: null,
    });
    assert.equal(summer.campaign?.starts_at, "2026-06-30T22:00:00.000Z");
    assert.equal(summer.campaign?.ends_at, null);
  });
});

const row = (over: Partial<MedusaPromotionRow> = {}): MedusaPromotionRow => ({
  id: "promo_1",
  code: "TAVASZ10",
  status: "active",
  is_automatic: false,
  limit: 10,
  used: 3,
  application_method: { type: "percentage", target_type: "order", value: 10 },
  campaign: {
    starts_at: "2026-03-01T00:00:00+01:00",
    ends_at: "2026-03-31T23:59:59.999+02:00",
  },
  ...over,
});
const now = new Date("2026-03-15T12:00:00Z");

describe("toWebshopCoupon and couponState", () => {
  it("reads a coupon back with its Budapest days", () => {
    assert.deepEqual(toWebshopCoupon(row(), now), {
      id: "promo_1",
      code: "TAVASZ10",
      kind: "PERCENT",
      value: 10,
      validFrom: "2026-03-01",
      validUntil: "2026-03-31",
      usageLimit: 10,
      used: 3,
      state: "ACTIVE",
    });
  });

  it("does not show what this page could not describe: automatic, codeless, or not on the order", () => {
    assert.equal(toWebshopCoupon(row({ is_automatic: true }), now), null);
    assert.equal(toWebshopCoupon(row({ code: null }), now), null);
    assert.equal(
      toWebshopCoupon(
        row({
          application_method: {
            type: "percentage",
            target_type: "items",
            value: 10,
          },
        }),
        now,
      ),
      null,
    );
    assert.equal(
      toWebshopCoupon(
        row({
          application_method: {
            type: "percentage",
            target_type: "shipping_methods",
            value: 10,
          },
        }),
        now,
      ),
      null,
    );
  });

  it("the state: switched off first, then the dates, then the used-up limit", () => {
    assert.equal(couponState(row({ status: "inactive" }), now), "INACTIVE");
    assert.equal(couponState(row({ status: "draft" }), now), "INACTIVE");
    assert.equal(
      couponState(row({ status: "inactive", used: 10 }), now),
      "INACTIVE",
    );
    assert.equal(
      couponState(row(), new Date("2026-04-01T12:00:00Z")),
      "EXPIRED",
    );
    assert.equal(
      couponState(row(), new Date("2026-02-01T12:00:00Z")),
      "SCHEDULED",
    );
    assert.equal(couponState(row({ used: 10 }), now), "USED_UP");
    assert.equal(couponState(row({ limit: null, used: 99 }), now), "ACTIVE");
    assert.equal(couponState(row({ campaign: null }), now), "ACTIVE");
  });
});
