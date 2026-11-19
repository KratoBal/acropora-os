import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ServiceUnavailableException } from "@nestjs/common";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import type { NavTaxpayerService } from "../../integrations/nav/nav-taxpayer.service.js";
import { huBaseNumberOk } from "./webshop-order-tax-check.rules.js";
import { WebshopOrderTaxCheckService } from "./webshop-order-tax-check.service.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

const BASE = (() => {
  for (let n = 10000000; n < 10000100; n += 1)
    if (huBaseNumberOk(String(n))) return String(n);
  throw new Error("no valid base number in range");
})();
const TAX = `${BASE}-2-41`;

const order = (taxId: unknown, company = "Minta Kft.") =>
  ({
    billing_address: { company, metadata: { tax_id: taxId } },
    shipping_address: null,
  }) as unknown as MedusaOrderDetailRow;

function setup(
  lookup: (taxNumber: string) => Promise<unknown> = async () => ({
    valid: true,
    data: {
      name: "MINTA KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG",
      taxNumber: TAX,
      address: null,
    },
  }),
) {
  const asked: string[] = [];
  const nav = {
    lookup: async (taxNumber: string) => {
      asked.push(taxNumber);
      return lookup(taxNumber);
    },
  } as unknown as NavTaxpayerService;
  const orders = {
    source: async (id: string) => ({ order: order(TAX), status: null, id }),
  } as unknown as WebshopOrdersService;
  return { asked, service: new WebshopOrderTaxCheckService(nav, orders) };
}

/**
 * A RENDELÉS ADÓSZÁMÁNAK NAV-ELLENŐRZÉSE (kártya c977aed2, P2). MI PIROSÍT: ha magánszemélynél, közösségi vagy hibás alakú
 * számnál a NAV-ot kérdezzük; ha a NAV "nincs ilyen" válasza nem INVALID; ha a NAV kiesése INVALID-nak látszik (az ne állítsa meg a
 * számlát); ha a név-egyezés nem a rendelés cégnevéből és a NAV nevéből jön.
 */
describe("WebshopOrderTaxCheckService", () => {
  it("a number the NAV knows is VALID, with the NAV's name and whether the order's company name matches it", async () => {
    const { asked, service } = setup();
    assert.deepEqual(await service.check(order(TAX)), {
      state: "VALID",
      taxNumber: TAX,
      navName: "MINTA KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG",
      nameMatches: true,
    });
    assert.deepEqual(asked, [TAX]);
  });

  it("another company's name at the NAV is a mismatch signal, still VALID", async () => {
    const { service } = setup(async () => ({
      valid: true,
      data: { name: "Teljesen Más Zrt.", taxNumber: TAX, address: null },
    }));
    const check = await service.check(order(TAX));
    assert.equal(check.state, "VALID");
    assert.equal(check.nameMatches, false);
  });

  it("the NAV's 'no such taxpayer' is INVALID", async () => {
    const { service } = setup(async () => ({ valid: false, data: null }));
    assert.deepEqual(await service.check(order(TAX)), {
      state: "INVALID",
      taxNumber: TAX,
      navName: null,
      nameMatches: null,
    });
  });

  it("an answer that does not say valid or not (a missing taxpayerValidity) is UNAVAILABLE: it must not stop an invoice", async () => {
    const { service } = setup(async () => ({
      valid: false,
      validityUnknown: true,
      data: null,
    }));
    assert.equal((await service.check(order(TAX))).state, "UNAVAILABLE");
  });

  it("a NAV that does not answer is UNAVAILABLE, not INVALID: it must not stop an invoice", async () => {
    for (const failure of [
      new ServiceUnavailableException("NAV_UNREACHABLE"),
      new Error("timeout"),
    ]) {
      const { service } = setup(async () => {
        throw failure;
      });
      assert.equal((await service.check(order(TAX))).state, "UNAVAILABLE");
    }
  });

  it("no number, or a Community number: NONE, and the NAV is not asked", async () => {
    const { asked, service } = setup();
    for (const raw of [undefined, "", "DE123456789"])
      assert.equal(
        (await service.check(order(raw))).state,
        "NONE",
        String(raw),
      );
    assert.deepEqual(asked, []);
  });

  it("a malformed number: MALFORMED with the text as written, and the NAV is not asked", async () => {
    const { asked, service } = setup();
    assert.deepEqual(await service.check(order("not-a-tax-number")), {
      state: "MALFORMED",
      taxNumber: "not-a-tax-number",
      navName: null,
      nameMatches: null,
    });
    assert.deepEqual(asked, []);
  });

  it("an order with no company name has no name verdict", async () => {
    const { service } = setup();
    assert.equal((await service.check(order(TAX, ""))).nameMatches, null);
  });

  it("checkOrder reads the order from the webshop and checks that", async () => {
    const { asked, service } = setup();
    assert.equal((await service.checkOrder("order_38")).state, "VALID");
    assert.deepEqual(asked, [TAX]);
  });
});
