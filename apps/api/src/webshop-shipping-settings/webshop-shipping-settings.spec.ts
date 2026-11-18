import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { WEBSHOP_SHIPPING_FEES } from "@acropora/types";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import type {
  MedusaCommerceSetting,
  MedusaShippingSettingsClient,
} from "./webshop-shipping-settings.client.js";
import {
  settingAmount,
  toPaymentMatrix,
} from "./webshop-shipping-settings.rules.js";
import { WebshopShippingSettingsService } from "./webshop-shipping-settings.service.js";

/*
  A WEBSHOP SZÁLLÍTÁSI DÍJAI ÉS FIZETÉSI MÓDJAI (kártya e0e2378b). MI PIROSÍT: kapcsoló nélkül a webshophoz nyúl; a tárolt
  szöveges érték vagy az alapérték nem számként jön vissza, egy hiányzó (alapérték nélküli) érték kitalált számot kap; a
  mentés a változatlan értékeket is újraírja, vagy egy alapértéket nem rögzít; hibás bemenet a webshopig jut; a mátrix nem
  egészben, sorrenddel megy; a webshop elutasítása nem a webshop szavával jön vissza; egy régebbi webshop (404) "nincs ilyen"
  hibának látszik.
*/

const stored = (key: string, value: string): MedusaCommerceSetting => ({
  key,
  value,
  is_configured: true,
});

const MATRIX = {
  PICKUP: ["ONLINE_CARD", "PAY_AT_STORE", "BANK_TRANSFER"],
  GLS_NORMAL: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
  GLS_HEAVY: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
  FOXPOST: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
};

function fakeClient(state: {
  settings: Record<string, MedusaCommerceSetting>;
  failPut?: MedusaAdminHttpError;
  failRules?: MedusaAdminHttpError;
}) {
  const calls: string[] = [];
  let matrix: Record<string, string[]> = MATRIX;
  const client: MedusaShippingSettingsClient = {
    getSetting: async (key) => {
      calls.push(`get:${key}`);
      return state.settings[key]!;
    },
    setSetting: async (key, value) => {
      calls.push(`set:${key}=${value}`);
      state.settings[key] = stored(key, String(value));
      return state.settings[key]!;
    },
    getRules: async () => {
      calls.push("rules");
      if (state.failRules) throw state.failRules;
      return { matrix };
    },
    putRules: async (next) => {
      calls.push(`put:${JSON.stringify(next)}`);
      if (state.failPut) throw state.failPut;
      matrix = next;
      return { matrix };
    },
  };
  return { client, calls };
}

/** Today's stage values: four stored, the COD fee on the shop's default, the GLS heavy fee never set (no default). */
const stageSettings = (): Record<string, MedusaCommerceSetting> => ({
  shipping_gls_normal_huf: stored("shipping_gls_normal_huf", "3500"),
  shipping_gls_heavy_huf: {
    key: "shipping_gls_heavy_huf",
    value: null,
    is_default: false,
    is_configured: false,
  },
  shipping_foxpost_huf: stored("shipping_foxpost_huf", "1150"),
  free_shipping_threshold_gls_huf: stored(
    "free_shipping_threshold_gls_huf",
    "50000",
  ),
  free_shipping_threshold_foxpost_huf: stored(
    "free_shipping_threshold_foxpost_huf",
    "30000",
  ),
  cash_on_delivery_fee_huf: {
    key: "cash_on_delivery_fee_huf",
    value: 450,
    is_default: true,
    is_configured: false,
  },
});

const service = (
  client: MedusaShippingSettingsClient,
  env: Record<string, string> = { MEDUSA_WEBSHOP_SHIPPING_SETTINGS: "true" },
) => new WebshopShippingSettingsService(async () => client, env);

const fees = {
  glsNormal: 3500,
  glsHeavy: 4500,
  foxpost: 1150,
  freeThresholdGls: 50000,
  freeThresholdFoxpost: 30000,
  cashOnDeliveryFee: 450,
};

describe("the shapes", () => {
  it("a stored text, a default number, and nothing usable as null", () => {
    assert.equal(settingAmount(stored("k", "3500")), 3500);
    assert.equal(settingAmount({ key: "k", value: 450 }), 450);
    assert.equal(settingAmount({ key: "k", value: null }), null);
    assert.equal(settingAmount(stored("k", "")), null);
    assert.equal(settingAmount(stored("k", "12.5")), null);
  });
  it("the matrix in the screen's order of shipping methods, unknown payments dropped, a missing method empty", () => {
    assert.deepEqual(
      toPaymentMatrix({
        FOXPOST: ["COD", "CASH", "ONLINE_CARD"],
        PICKUP: ["PAY_AT_STORE"],
      }),
      {
        PICKUP: ["PAY_AT_STORE"],
        GLS_NORMAL: [],
        GLS_HEAVY: [],
        FOXPOST: ["COD", "ONLINE_CARD"],
      },
    );
  });
});

describe("the service", () => {
  it("off: every call is 404 and the shop is not asked", async () => {
    const { client, calls } = fakeClient({ settings: stageSettings() });
    const svc = service(client, {});
    await assert.rejects(svc.get(), NotFoundException);
    await assert.rejects(svc.saveFees(fees), NotFoundException);
    await assert.rejects(svc.savePayments(MATRIX), NotFoundException);
    assert.deepEqual(calls, []);
  });

  it("reads the six values, the defaults marked, the unset one null, and the matrix", async () => {
    const { client } = fakeClient({ settings: stageSettings() });
    const settings = await service(client).get();
    assert.deepEqual(settings.fees, {
      glsNormal: 3500,
      glsHeavy: null,
      foxpost: 1150,
      freeThresholdGls: 50000,
      freeThresholdFoxpost: 30000,
      cashOnDeliveryFee: 450,
    });
    assert.deepEqual(settings.defaultFees, ["cashOnDeliveryFee"]);
    assert.deepEqual(settings.matrix, MATRIX);
  });

  it("saving the fees writes only what changed, and pins a default it was shown", async () => {
    const { client, calls } = fakeClient({ settings: stageSettings() });
    const settings = await service(client).saveFees({ ...fees, foxpost: 1290 });
    assert.deepEqual(
      calls.filter((c) => c.startsWith("set:")),
      [
        "set:shipping_gls_heavy_huf=4500",
        "set:shipping_foxpost_huf=1290",
        "set:cash_on_delivery_fee_huf=450",
      ],
    );
    assert.equal(settings.fees.foxpost, 1290);
    assert.equal(settings.fees.glsHeavy, 4500);
    assert.deepEqual(settings.defaultFees, []);
  });

  it("bad fees or a bad matrix stop before the shop", async () => {
    const { client, calls } = fakeClient({ settings: stageSettings() });
    await assert.rejects(
      service(client).saveFees({ ...fees, glsHeavy: -1 }),
      BadRequestException,
    );
    await assert.rejects(
      service(client).savePayments({
        ...MATRIX,
        PICKUP: ["ONLINE_CARD", "COD"],
      }),
      BadRequestException,
    );
    assert.deepEqual(calls, []);
  });

  it("the matrix goes whole and in its order, and the answer is read back", async () => {
    const { client, calls } = fakeClient({ settings: stageSettings() });
    const next = {
      ...MATRIX,
      FOXPOST: ["COD", "BANK_TRANSFER", "ONLINE_CARD"],
    };
    const settings = await service(client).savePayments(next);
    assert.equal(calls[0], `put:${JSON.stringify(next)}`);
    assert.deepEqual(settings.matrix.FOXPOST, [
      "COD",
      "BANK_TRANSFER",
      "ONLINE_CARD",
    ]);
  });

  it("the shop's refusal comes back in its words; an older shop without the endpoint is not 'not found'", async () => {
    const refused = fakeClient({
      settings: stageSettings(),
      failPut: new MedusaAdminHttpError(
        400,
        JSON.stringify({
          message:
            "A(z) PICKUP szállítási módnál legalább egy fizetési mód kell",
        }),
      ),
    });
    await assert.rejects(
      service(refused.client).savePayments(MATRIX),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /legalább egy fizetési mód/.test(error.message),
    );
    const older = fakeClient({
      settings: stageSettings(),
      failRules: new MedusaAdminHttpError(404, "Not Found"),
    });
    await assert.rejects(
      service(older.client).get(),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        /régebbi változaton/.test(error.message),
    );
  });

  it("the six keys are the web shop's keys", () => {
    assert.deepEqual(
      WEBSHOP_SHIPPING_FEES.map((f) => f.key),
      [
        "shipping_gls_normal_huf",
        "shipping_gls_heavy_huf",
        "shipping_foxpost_huf",
        "free_shipping_threshold_gls_huf",
        "free_shipping_threshold_foxpost_huf",
        "cash_on_delivery_fee_huf",
      ],
    );
  });
});
