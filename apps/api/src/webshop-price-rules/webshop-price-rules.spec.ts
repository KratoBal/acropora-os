import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { WEBSHOP_PRICE_RULES } from "@acropora/types";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import type { MedusaCommerceSetting } from "../webshop-shipping-settings/webshop-shipping-settings.client.js";
import { toPriceRules } from "./webshop-price-rules.rules.js";
import {
  WebshopPriceRulesService,
  type PriceRulesClient,
} from "./webshop-price-rules.service.js";

/*
  A WEBSHOP HŰSÉGPONT- ÉS ÁRSZABÁLYAI (acrobot 60467; commerce #880, #881). MI PIROSÍT: kapcsoló nélkül a webshophoz nyúl; a
  tárolt szöveg vagy az alapérték nem számként jön vissza; egy határon kívüli tárolt érték számként jelenik meg (a lap egy
  olyan számot mutatna, amit a webshop nem fogadna el); a mentés a változatlan értékeket is újraírja, vagy egy alapértéket nem
  rögzít; hibás bemenet a webshopig jut; egy régebbi webshop (404) "nincs ilyen" hibának látszik; a webshop elutasítása nem a
  webshop szavával jön vissza.
*/

const stored = (key: string, value: string): MedusaCommerceSetting => ({
  key,
  value,
  is_configured: true,
});
const byDefault = (key: string, value: number): MedusaCommerceSetting => ({
  key,
  value,
  is_default: true,
  is_configured: false,
});

/** A test shop right after #880 and #881: the switch stored on, the rest on the shop's defaults. */
const shopSettings = (): Record<string, MedusaCommerceSetting> => ({
  loyalty_redemption_enabled: stored("loyalty_redemption_enabled", "1"),
  loyalty_point_value_huf: byDefault("loyalty_point_value_huf", 1),
  loyalty_min_order_huf: byDefault("loyalty_min_order_huf", 30000),
  loyalty_min_points: byDefault("loyalty_min_points", 100),
  loyalty_max_percent: stored("loyalty_max_percent", "40"),
  omnibus_min_history_days: byDefault("omnibus_min_history_days", 15),
});

function fakeClient(state: {
  settings: Record<string, MedusaCommerceSetting>;
  failSet?: MedusaAdminHttpError;
  failGet?: MedusaAdminHttpError;
}) {
  const calls: string[] = [];
  const client: PriceRulesClient = {
    getSetting: async (key) => {
      calls.push(`get:${key}`);
      if (state.failGet) throw state.failGet;
      return state.settings[key]!;
    },
    setSetting: async (key, value) => {
      calls.push(`set:${key}=${value}`);
      if (state.failSet) throw state.failSet;
      state.settings[key] = stored(key, String(value));
      return state.settings[key]!;
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

const input = {
  loyaltyRedemptionEnabled: 1,
  loyaltyPointValueHuf: 1,
  loyaltyMinOrderHuf: 30000,
  loyaltyMinPoints: 100,
  loyaltyMaxPercent: 40,
  omnibusMinHistoryDays: 15,
};

describe("toPriceRules", () => {
  it("reads stored text and defaults as numbers, and names the fields on a default", () => {
    const settings = shopSettings();
    assert.deepEqual(
      toPriceRules(WEBSHOP_PRICE_RULES.map(({ key }) => settings[key]!)),
      {
        values: input,
        defaults: [
          "loyaltyPointValueHuf",
          "loyaltyMinOrderHuf",
          "loyaltyMinPoints",
          "omnibusMinHistoryDays",
        ],
      },
    );
  });

  it("shows a value outside the field's bounds, or not a whole number, as not set", () => {
    const settings: Record<string, MedusaCommerceSetting> = {
      ...shopSettings(),
      omnibus_min_history_days: stored("omnibus_min_history_days", "10"),
      loyalty_max_percent: stored("loyalty_max_percent", "40.5"),
      loyalty_min_points: {
        key: "loyalty_min_points",
        value: null,
        is_configured: false,
      },
    };
    const rules = toPriceRules(
      WEBSHOP_PRICE_RULES.map(({ key }) => settings[key]!),
    );
    assert.equal(rules.values.omnibusMinHistoryDays, null);
    assert.equal(rules.values.loyaltyMaxPercent, null);
    assert.equal(rules.values.loyaltyMinPoints, null);
    assert.ok(!rules.defaults.includes("loyaltyMinPoints"));
  });
});

describe("WebshopPriceRulesService", () => {
  it("without the switch it touches nothing and answers 404", async () => {
    const { client, calls } = fakeClient({ settings: shopSettings() });
    for (const env of [{}, { MEDUSA_WEBSHOP_PRICE_RULES: "1" }]) {
      await assert.rejects(service(client, env).get(), NotFoundException);
      await assert.rejects(service(client, env).save(input), NotFoundException);
    }
    assert.deepEqual(calls, []);
  });

  it("saves only what changed, and pins the values on a default", async () => {
    const settings = shopSettings();
    const { client, calls } = fakeClient({ settings });
    const saved = await service(client).save({
      ...input,
      loyaltyMaxPercent: 50,
      omnibusMinHistoryDays: 20,
    });
    assert.deepEqual(
      calls.filter((call) => call.startsWith("set:")),
      [
        "set:loyalty_point_value_huf=1",
        "set:loyalty_min_order_huf=30000",
        "set:loyalty_min_points=100",
        "set:loyalty_max_percent=50",
        "set:omnibus_min_history_days=20",
      ],
    );
    assert.equal(saved.values.loyaltyMaxPercent, 50);
    assert.equal(saved.values.omnibusMinHistoryDays, 20);
    assert.deepEqual(saved.defaults, []);
  });

  it("refuses a bad input before the shop, naming the field", async () => {
    const { client, calls } = fakeClient({ settings: shopSettings() });
    await assert.rejects(
      service(client).save({ ...input, omnibusMinHistoryDays: 14 }),
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
      settings: shopSettings(),
      failGet: new MedusaAdminHttpError(404, "Not Found"),
    });
    await assert.rejects(
      service(old.client).get(),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        /régebbi változaton/.test(error.message),
    );
    const refused = fakeClient({
      settings: shopSettings(),
      failSet: new MedusaAdminHttpError(
        400,
        JSON.stringify({ message: "omnibus_min_history_days: from 15 to 30" }),
      ),
    });
    await assert.rejects(
      service(refused.client).save({ ...input, omnibusMinHistoryDays: 30 }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /from 15 to 30/.test(error.message),
    );
  });
});
