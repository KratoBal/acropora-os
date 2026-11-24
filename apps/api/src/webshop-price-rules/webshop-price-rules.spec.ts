import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import type { MedusaCommerceSetting } from "../webshop-shipping-settings/webshop-shipping-settings.client.js";
import type {
  MedusaLoyaltySettings,
  PriceRulesClient,
} from "./webshop-price-rules.client.js";
import { toPriceRules } from "./webshop-price-rules.rules.js";
import { WebshopPriceRulesService } from "./webshop-price-rules.service.js";

/*
  A WEBSHOP HŰSÉGPONT- ÉS ÁRSZABÁLYAI (acrobot 60467; commerce #880, #881). MI PIROSÍT: kapcsoló nélkül a webshophoz nyúl; a
  beváltás nem azt mutatja, amit a webshop használ (a teszt kirakaton a környezet kapcsolja be: barracuda, #2824); a forrás
  elvész; egy határon kívüli érték számként jelenik meg; a mentés olyan mezőt is ír, amit senki nem változtatott meg (egy
  környezetből jövő bekapcsolást így csendben kikapcsolna); hibás bemenet a webshopig jut; egy régebbi webshop (404) "nincs
  ilyen" hibának látszik; a webshop elutasítása nem a webshop szavával jön vissza.
*/

/** The test shop as barracuda measured it: the redemption switched on by `LOYALTY_REDEMPTION_ENABLED=true`, one stored row. */
const testShopLoyalty = (): MedusaLoyaltySettings => ({
  settings: {
    enabled: true,
    value: 1,
    minOrder: 30000,
    minPoints: 100,
    maxPercent: 40,
  },
  sources: {
    enabled: "env",
    value: "default",
    minOrder: "default",
    minPoints: "default",
    maxPercent: "row",
  },
  accrual: {
    settings: { enabled: false, percent: 3, onSaleItems: false },
    sources: { enabled: "default", percent: "default", onSaleItems: "row" },
  },
});
const omnibusDefault = (): MedusaCommerceSetting => ({
  key: "omnibus_min_history_days",
  value: 15,
  is_default: true,
  is_configured: false,
});

function fakeClient(state: {
  loyalty: MedusaLoyaltySettings;
  omnibus: MedusaCommerceSetting;
  failSet?: MedusaAdminHttpError;
  failLoyalty?: MedusaAdminHttpError;
}) {
  const calls: string[] = [];
  const client: PriceRulesClient = {
    getSetting: async (key) => {
      calls.push(`get:${key}`);
      return state.omnibus;
    },
    setSetting: async (key, value) => {
      calls.push(`set:${key}=${value}`);
      if (state.failSet) throw state.failSet;
      if (key === "omnibus_min_history_days")
        state.omnibus = { key, value: String(value), is_configured: true };
      return { key, value: String(value), is_configured: true };
    },
    getLoyaltySettings: async () => {
      calls.push("loyalty");
      if (state.failLoyalty) throw state.failLoyalty;
      return state.loyalty;
    },
  };
  return { client, calls };
}

const service = (
  client: PriceRulesClient,
  env: Record<string, string | undefined> = {
    MEDUSA_WEBSHOP_PRICE_RULES: "true",
  },
) => new WebshopPriceRulesService(async () => client, env);

/** What the test shop shows, as the form sends it back unchanged. */
const shown = {
  loyaltyAccrualEnabled: 0,
  loyaltyAccrualPercent: 3,
  loyaltyAccrualOnSaleItems: 0,
  loyaltyRedemptionEnabled: 1,
  loyaltyPointValueHuf: 1,
  loyaltyMinOrderHuf: 30000,
  loyaltyMinPoints: 100,
  loyaltyMaxPercent: 40,
  omnibusMinHistoryDays: 15,
};

describe("toPriceRules", () => {
  it("shows what the shop uses, the switch as 1, with each value's source", () => {
    assert.deepEqual(toPriceRules(testShopLoyalty(), omnibusDefault()), {
      values: shown,
      sources: {
        loyaltyAccrualEnabled: "default",
        loyaltyAccrualPercent: "default",
        loyaltyAccrualOnSaleItems: "row",
        loyaltyRedemptionEnabled: "env",
        loyaltyPointValueHuf: "default",
        loyaltyMinOrderHuf: "default",
        loyaltyMinPoints: "default",
        loyaltyMaxPercent: "row",
        omnibusMinHistoryDays: "default",
      },
    });
  });

  it("a value outside the bounds is not set; an unknown source is the least it can claim; a failed read keeps its word", () => {
    const loyalty = testShopLoyalty();
    loyalty.settings.maxPercent = 140;
    loyalty.settings.enabled = false;
    loyalty.sources.enabled = "read_failed";
    loyalty.sources.minPoints = "from_the_future";
    const rules = toPriceRules(loyalty, {
      key: "omnibus_min_history_days",
      value: "10",
      is_configured: true,
    });
    assert.equal(rules.values.loyaltyMaxPercent, null);
    assert.equal(rules.values.loyaltyRedemptionEnabled, 0);
    assert.equal(rules.sources.loyaltyRedemptionEnabled, "read_failed");
    assert.equal(rules.sources.loyaltyMinPoints, "default");
    assert.equal(rules.values.omnibusMinHistoryDays, null);
    assert.equal(rules.sources.omnibusMinHistoryDays, "row");
  });

  it("a shop from before the accrual (#882) gives no accrual part: those fields are not set, the rest is read", () => {
    const old = testShopLoyalty();
    delete old.accrual;
    const rules = toPriceRules(old, omnibusDefault());
    assert.equal(rules.values.loyaltyAccrualEnabled, null);
    assert.equal(rules.values.loyaltyAccrualPercent, null);
    assert.equal(rules.sources.loyaltyAccrualPercent, "default");
    assert.equal(rules.values.loyaltyRedemptionEnabled, 1);
  });
});

describe("WebshopPriceRulesService", () => {
  it("without the switch it touches nothing and answers 404", async () => {
    const { client, calls } = fakeClient({
      loyalty: testShopLoyalty(),
      omnibus: omnibusDefault(),
    });
    for (const env of [{}, { MEDUSA_WEBSHOP_PRICE_RULES: "1" }]) {
      await assert.rejects(service(client, env).get(), NotFoundException);
      await assert.rejects(service(client, env).save(shown), NotFoundException);
    }
    assert.deepEqual(calls, []);
  });

  it("saving only the Omnibus days writes only that key: the switch on from the environment gets no row (barracuda, #2824)", async () => {
    const { client, calls } = fakeClient({
      loyalty: testShopLoyalty(),
      omnibus: omnibusDefault(),
    });
    const saved = await service(client).save({
      ...shown,
      omnibusMinHistoryDays: 20,
    });
    assert.deepEqual(
      calls.filter((call) => call.startsWith("set:")),
      ["set:omnibus_min_history_days=20"],
    );
    assert.equal(saved.values.loyaltyRedemptionEnabled, 1);
    assert.equal(saved.sources.loyaltyRedemptionEnabled, "env");
    assert.equal(saved.values.omnibusMinHistoryDays, 20);
  });

  it("a changed redemption field is written, as a number, and nothing else", async () => {
    const { client, calls } = fakeClient({
      loyalty: testShopLoyalty(),
      omnibus: omnibusDefault(),
    });
    await service(client).save({
      ...shown,
      loyaltyRedemptionEnabled: 0,
      loyaltyMaxPercent: 50,
    });
    assert.deepEqual(
      calls.filter((call) => call.startsWith("set:")),
      ["set:loyalty_redemption_enabled=0", "set:loyalty_max_percent=50"],
    );
  });

  it("switching the accrual on at 5 percent writes those two keys only (commerce #882)", async () => {
    const { client, calls } = fakeClient({
      loyalty: testShopLoyalty(),
      omnibus: omnibusDefault(),
    });
    await service(client).save({
      ...shown,
      loyaltyAccrualEnabled: 1,
      loyaltyAccrualPercent: 5,
    });
    assert.deepEqual(
      calls.filter((call) => call.startsWith("set:")),
      ["set:loyalty_accrual_enabled=1", "set:loyalty_accrual_percent=5"],
    );
  });

  it("an unchanged save writes nothing", async () => {
    const { client, calls } = fakeClient({
      loyalty: testShopLoyalty(),
      omnibus: omnibusDefault(),
    });
    await service(client).save(shown);
    assert.deepEqual(
      calls.filter((call) => call.startsWith("set:")),
      [],
    );
  });

  it("refuses a bad input before the shop, naming the field", async () => {
    const { client, calls } = fakeClient({
      loyalty: testShopLoyalty(),
      omnibus: omnibusDefault(),
    });
    await assert.rejects(
      service(client).save({ ...shown, omnibusMinHistoryDays: 14 }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        Object.keys(
          (error.getResponse() as { errors: Record<string, string> }).errors,
        ).join() === "omnibusMinHistoryDays",
    );
    assert.deepEqual(calls, []);
  });

  it("an older shop (404) is a 503 that says so; a refusal (400) carries the shop's words", async () => {
    const old = fakeClient({
      loyalty: testShopLoyalty(),
      omnibus: omnibusDefault(),
      failLoyalty: new MedusaAdminHttpError(404, "Not Found"),
    });
    await assert.rejects(
      service(old.client).get(),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        /régebbi változaton/.test(error.message),
    );
    const refused = fakeClient({
      loyalty: testShopLoyalty(),
      omnibus: omnibusDefault(),
      failSet: new MedusaAdminHttpError(
        400,
        JSON.stringify({ message: "omnibus_min_history_days: from 15 to 30" }),
      ),
    });
    await assert.rejects(
      service(refused.client).save({ ...shown, omnibusMinHistoryDays: 30 }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /from 15 to 30/.test(error.message),
    );
  });
});
