import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import type {
  CustomerTextsClient,
  MedusaCustomerTexts,
} from "./webshop-customer-texts.client.js";
import {
  customerTextsAllowed,
  toCustomerTexts,
  WebshopCustomerTextsService,
} from "./webshop-customer-texts.service.js";

/*
  A WEBSHOP VEVŐI SZÖVEGEI (kártya 7bfca4eb; commerce #888). MI PIROSÍT: kapcsoló nélkül a webshophoz nyúl; a felülírás rossz
  nyelvhez vagy kulcshoz kerül; a katalógus sorrendje felborul; hibás bemenet a webshopig jut; a törlés (null) nem jut el; egy
  régebbi webshop (404) "nincs ilyen" hibának látszik; a webshop elutasítása (egy hiányzó {hely}) nem a webshop szavával jön.
*/
const shop = (): MedusaCustomerTexts => ({
  groups: ["penztar", "fiok"],
  catalog: [
    { key: "cart.add", group: "penztar", hu: "Kosárba", en: "Add to cart" },
    { key: "account.title", group: "fiok", hu: "Fiók", en: "Account" },
  ],
  overrides: [{ key: "account.title", locale: "en", value: "My account" }],
});

function fakeClient(state: {
  shop: MedusaCustomerTexts;
  failSet?: Error;
  failList?: Error;
}) {
  const calls: string[] = [];
  const client: CustomerTextsClient = {
    list: async () => {
      calls.push("list");
      if (state.failList) throw state.failList;
      return state.shop;
    },
    set: async (key, locale, value) => {
      calls.push(`set:${key}:${locale}=${value}`);
      if (state.failSet) throw state.failSet;
      state.shop.overrides = state.shop.overrides.filter(
        (row) => !(row.key === key && row.locale === locale),
      );
      if (value !== null) state.shop.overrides.push({ key, locale, value });
    },
  };
  return { client, calls };
}

const service = (
  client: CustomerTextsClient,
  env: Record<string, string | undefined> = {
    MEDUSA_WEBSHOP_CUSTOMER_TEXTS: "true",
  },
) => new WebshopCustomerTextsService(async () => client, env);

describe("a webshop vevői szövegei", () => {
  it("a katalógus sorrendjében, az alapértékkel és a felülírással nyelvenként", () => {
    assert.deepEqual(toCustomerTexts(shop()), {
      texts: [
        {
          key: "cart.add",
          group: "penztar",
          defaults: { hu: "Kosárba", en: "Add to cart" },
          overrides: { hu: null, en: null },
        },
        {
          key: "account.title",
          group: "fiok",
          defaults: { hu: "Fiók", en: "Account" },
          overrides: { hu: null, en: "My account" },
        },
      ],
    });
  });

  it("kapcsoló nélkül (vagy nem pontosan true-val) 404, és a webshophoz nem nyúl", async () => {
    for (const env of [{}, { MEDUSA_WEBSHOP_CUSTOMER_TEXTS: "1" }]) {
      assert.equal(customerTextsAllowed(env), false);
      const { client, calls } = fakeClient({ shop: shop() });
      await assert.rejects(service(client, env).get(), NotFoundException);
      await assert.rejects(
        service(client, env).save({
          key: "cart.add",
          locale: "hu",
          value: "x",
        }),
        NotFoundException,
      );
      assert.deepEqual(calls, []);
    }
  });

  it("a mentés egy kulcsot egy nyelven ír, levágva, és a mentett sort adja vissza; a null törli", async () => {
    const state = { shop: shop() };
    const { client, calls } = fakeClient(state);
    const saved = await service(client).save({
      key: "cart.add",
      locale: "hu",
      value: "  Kosárba vele ",
    });
    assert.deepEqual(saved.overrides, { hu: "Kosárba vele", en: null });
    const reset = await service(client).save({
      key: "account.title",
      locale: "en",
      value: null,
    });
    assert.deepEqual(reset.overrides, { hu: null, en: null });
    assert.deepEqual(calls, [
      "set:cart.add:hu=Kosárba vele",
      "list",
      "set:account.title:en=null",
      "list",
    ]);
  });

  it("hibás bemenet nem jut a webshopig", async () => {
    const { client, calls } = fakeClient({ shop: shop() });
    for (const raw of [
      {},
      { key: "cart.add", locale: "de", value: "x" },
      { key: "cart.add", locale: "hu", value: " " },
    ])
      await assert.rejects(service(client).save(raw), BadRequestException);
    assert.deepEqual(calls, []);
  });

  it("a webshop elutasítása a saját szavával, a 404 régebbi webshopként, más hiba elérhetetlenként jön vissza", async () => {
    const refusal = new MedusaAdminHttpError(
      400,
      JSON.stringify({
        message:
          "The text must keep the slots of the default ({id}), it has none.",
      }),
    );
    const { client } = fakeClient({ shop: shop(), failSet: refusal });
    await assert.rejects(
      service(client).save({ key: "cart.add", locale: "hu", value: "x" }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /webshop elutasította: The text must keep the slots/.test(
          error.message,
        ),
    );
    const old = fakeClient({
      shop: shop(),
      failList: new MedusaAdminHttpError(404, ""),
    });
    await assert.rejects(
      service(old.client).get(),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        /régebbi változaton/.test(error.message),
    );
    const down = fakeClient({
      shop: shop(),
      failList: new MedusaAdminHttpError(502, ""),
    });
    await assert.rejects(
      service(down.client).get(),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        /HTTP 502/.test(error.message),
    );
  });
});
