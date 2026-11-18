import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { MedusaAdminHttpError } from "../integrations/medusa/medusa-admin.client.js";
import {
  HttpMedusaPromotionClient,
  type MedusaPromotionClient,
} from "./webshop-coupons.client.js";
import type { MedusaPromotionRow } from "./webshop-coupons.rules.js";
import { WebshopCouponsService } from "./webshop-coupons.service.js";

/*
  A KUPONOK SZOLGÁLTATÁSA ÉS KLIENSE (kártya 393ae5cb). MI PIROSÍT: a kapcsoló nélküli környezet a webshophoz nyúl (olvasás
  vagy írás); egy hibás bemenet a webshopig jut; a webshop hibája nyersen vagy kulccsal megy vissza; a kliens nem a Basic
  kulcs-fejlécet, nem a promóció-végpontot vagy nem a JSON-törzset küldi.
*/

const promo: MedusaPromotionRow = {
  id: "promo_1",
  code: "TAVASZ10",
  status: "active",
  is_automatic: false,
  limit: null,
  used: 0,
  application_method: { type: "percentage", target_type: "order", value: 10 },
  campaign: null,
};

function fakeClient(over: Partial<MedusaPromotionClient> = {}) {
  const calls: string[] = [];
  const client: MedusaPromotionClient = {
    listPromotions: async () => {
      calls.push("list");
      return [promo];
    },
    createPromotion: async () => {
      calls.push("create");
      return promo;
    },
    setPromotionStatus: async (_id, status) => {
      calls.push(`status:${status}`);
      return { ...promo, status };
    },
    ...over,
  };
  return { client, calls };
}
const service = (
  client: MedusaPromotionClient,
  env: Record<string, string> = { MEDUSA_WEBSHOP_COUPONS: "true" },
) => {
  let built = 0;
  const svc = new WebshopCouponsService(
    async () => {
      built += 1;
      return client;
    },
    env,
    () => new Date("2026-03-15T12:00:00Z"),
  );
  return { svc, built: () => built };
};

describe("the environment switch", () => {
  it("without MEDUSA_WEBSHOP_COUPONS=true every endpoint is 404 and the shop is not asked", async () => {
    const { client, calls } = fakeClient();
    const { svc, built } = service(client, {});
    await assert.rejects(svc.list(), NotFoundException);
    await assert.rejects(
      svc.create({ code: "TAVASZ10", kind: "PERCENT", value: 10 }),
      NotFoundException,
    );
    await assert.rejects(svc.setActive("promo_1", false), NotFoundException);
    assert.deepEqual(calls, []);
    assert.equal(built(), 0);
  });

  it("with it, the list reads the shop", async () => {
    const { client } = fakeClient();
    const list = await service(client).svc.list();
    assert.deepEqual(
      list.coupons.map((c) => c.code),
      ["TAVASZ10"],
    );
  });
});

describe("writing a coupon", () => {
  it("a bad input stops before the shop, with the field errors", async () => {
    const { client, calls } = fakeClient();
    await assert.rejects(
      service(client).svc.create({ code: "x", kind: "PERCENT", value: 500 }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const body = error.getResponse() as { errors: Record<string, string> };
        assert.ok(body.errors.code && body.errors.value);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  });

  it("the shop's refusals come back in plain words: a taken code, a missing coupon, the shop down", async () => {
    const taken = fakeClient({
      createPromotion: async () => {
        throw new MedusaAdminHttpError(
          400,
          JSON.stringify({
            type: "invalid_data",
            message: "Promotion with code TAVASZ10 already exists",
          }),
        );
      },
    });
    await assert.rejects(
      service(taken.client).svc.create({
        code: "TAVASZ10",
        kind: "PERCENT",
        value: 10,
      }),
      /Ilyen kódú kupon már van/,
    );
    const missing = fakeClient({
      setPromotionStatus: async () => {
        throw new MedusaAdminHttpError(404, "{}");
      },
    });
    await assert.rejects(
      service(missing.client).svc.setActive("nope", true),
      NotFoundException,
    );
    const down = fakeClient({
      listPromotions: async () => {
        throw new MedusaAdminHttpError(503, "<html>");
      },
    });
    await assert.rejects(
      service(down.client).svc.list(),
      ServiceUnavailableException,
    );
  });

  it("switching off sends the inactive status, and the answer says so", async () => {
    const { client, calls } = fakeClient();
    const coupon = await service(client).svc.setActive("promo_1", false);
    assert.deepEqual(calls, ["status:inactive"]);
    assert.equal(coupon.state, "INACTIVE");
  });
});

describe("the promotion client's request", () => {
  it("POSTs the body as JSON to /admin/promotions with the key as the Basic user name", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ promotion: promo }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const client = new HttpMedusaPromotionClient(
      { baseUrl: "https://shop.test", apiKey: "sk_test" },
      fetchImpl,
    );
    await client.createPromotion({
      code: "TAVASZ10",
      type: "standard",
      status: "active",
      is_automatic: false,
      is_tax_inclusive: true,
      limit: null,
      application_method: {
        type: "percentage",
        target_type: "order",
        allocation: "across",
        value: 10,
      },
    });
    assert.equal(seen.length, 1);
    assert.match(
      seen[0]!.url,
      /^https:\/\/shop\.test\/admin\/promotions\?fields=/,
    );
    assert.equal(seen[0]!.init.method, "POST");
    const headers = seen[0]!.init.headers as Record<string, string>;
    assert.equal(
      headers.authorization,
      `Basic ${Buffer.from("sk_test:").toString("base64")}`,
    );
    assert.equal(headers["content-type"], "application/json");
    assert.equal(
      JSON.parse(String(seen[0]!.init.body)).application_method.target_type,
      "order",
    );
  });
});
