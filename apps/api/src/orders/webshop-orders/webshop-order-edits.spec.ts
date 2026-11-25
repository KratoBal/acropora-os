import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AuthenticatedUser,
  WebshopOrderAddressInput,
  WebshopOrderDetail,
} from "@acropora/types";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
  type MedusaOrderAddressRow,
  type MedusaOrderDetailRow,
} from "../../integrations/medusa/medusa-admin.client.js";
import {
  addressEditOf,
  addressPayloadOf,
} from "./webshop-order-address.rules.js";
import { WebshopOrderEditsService } from "./webshop-order-edits.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  AZ ADATLAP CERUZÁI (Figma 494:386; acrobot 26502). MI PIROSÍT: a
  számlázási cím a kiállított számla után, a szállítási a feladott csomag után
  szerkeszthető; a webshop számlázási metaadatának más kulcsai elvesznek; a
  tiltott szerkesztés a webshopig jut; a webshop elutasítása 500; a
  szerkesztés nem kerül auditba az előző címmel.
*/
const USER = { id: "user_1" } as AuthenticatedUser;
const INPUT: WebshopOrderAddressInput = {
  kind: "billing",
  lastName: " Nagy ",
  firstName: "Emese",
  company: "Korall Kft.",
  taxNumber: "12345678-2-41",
  postalCode: "1117",
  city: "Budapest",
  line1: "Fehérvári út 24.",
  line2: "",
  phone: null,
  countryCode: "HU",
};
const parcel = {
  carrier: "FOXPOST" as const,
  reference: "38",
  parcelNumber: "CLFOX1",
  stub: false,
  size: null,
  codHuf: null,
  createdAt: "2026-10-05T12:00:00.000Z",
  trackingUrl: null,
};

describe("when an address may be edited", () => {
  it("an issued invoice holds the billing address, a parcel the shipping one", () => {
    assert.deepEqual(
      addressEditOf({ status: "stocking", invoice: null, parcel: null }),
      {
        billing: { allowed: true, reason: null },
        shipping: { allowed: true, reason: null },
      },
    );
    const invoiced = addressEditOf({
      status: "stocking",
      invoice: { id: "i", status: "ISSUED", number: "E-1" },
      parcel: null,
    });
    assert.deepEqual(
      [invoiced.billing.allowed, invoiced.shipping.allowed],
      [false, true],
    );
    assert.match(invoiced.billing.reason ?? "", /sztornója után/);
    const shipped = addressEditOf({
      status: "stocking",
      invoice: null,
      parcel,
    });
    assert.deepEqual(
      [shipped.billing.allowed, shipped.shipping.allowed],
      [true, false],
    );
    assert.equal(
      addressEditOf({ status: "out_for_delivery", invoice: null, parcel: null })
        .shipping.allowed,
      false,
    );
    const draft = addressEditOf({
      status: "stocking",
      invoice: { id: "i", status: "DRAFT", number: null },
      parcel: null,
    });
    assert.equal(draft.billing.allowed, true);
  });

  it("a closed order's addresses do not change", () => {
    for (const status of ["closed", "closed_unsuccessfully"] as const) {
      const rule = addressEditOf({ status, invoice: null, parcel: null });
      assert.deepEqual(
        [rule.billing.allowed, rule.shipping.allowed],
        [false, false],
      );
    }
  });
});

describe("the address sent to the webshop", () => {
  it("billing keeps the webshop's other metadata and writes the tax number", () => {
    assert.deepEqual(
      addressPayloadOf(INPUT, {
        metadata: { tax_id: "11111111-1-11", source: "checkout" },
      } as MedusaOrderAddressRow),
      {
        first_name: "Emese",
        last_name: "Nagy",
        company: "Korall Kft.",
        address_1: "Fehérvári út 24.",
        address_2: null,
        city: "Budapest",
        postal_code: "1117",
        country_code: "hu",
        phone: null,
        metadata: { tax_id: "12345678-2-41", source: "checkout" },
      },
    );
  });

  it("shipping carries no metadata", () => {
    assert.equal(
      "metadata" in addressPayloadOf({ ...INPUT, kind: "shipping" }, null),
      false,
    );
  });
});

function setup(
  addressEdit: WebshopOrderDetail["addressEdit"]["billing"],
  fail?: MedusaAdminHttpError,
) {
  const calls: unknown[] = [];
  const audited: unknown[] = [];
  const client = {
    updateOrderAddress: async (id: string, kind: string, address: unknown) => {
      calls.push([id, kind, address]);
      if (fail) throw fail;
    },
  } as unknown as MedusaAdminClient;
  const orders = {
    detail: async (id: string) =>
      ({
        id,
        addressEdit: { billing: addressEdit, shipping: addressEdit },
      }) as unknown as WebshopOrderDetail,
    source: async () => ({
      order: {
        billing_address: { city: "Szeged", metadata: { tax_id: null } },
        shipping_address: null,
      } as unknown as MedusaOrderDetailRow,
      status: null,
    }),
    adminClient: async () => client,
  } as unknown as WebshopOrdersService;
  const repository = {
    recordAddressEdit: async (input: unknown) => void audited.push(input),
    saveInternalNote: async (...args: unknown[]) => void audited.push(args),
  } as unknown as WebshopOrdersRepository;
  return {
    calls,
    audited,
    service: new WebshopOrderEditsService(orders, repository),
  };
}

describe("WebshopOrderEditsService", () => {
  it("an allowed edit goes to the webshop and the old address is audited", async () => {
    const { calls, audited, service } = setup({ allowed: true, reason: null });
    await service.updateAddress("order_38", INPUT, USER);
    assert.equal((calls[0] as unknown[])[1], "billing");
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        kind: "billing",
        before: { city: "Szeged", metadata: { tax_id: null } },
      },
    ]);
  });

  it("a held address never reaches the webshop; a refusal is 422 with the webshop's sentence", async () => {
    const held = setup({
      allowed: false,
      reason: "A számla már ki van állítva ezzel a címmel.",
    });
    await assert.rejects(held.service.updateAddress("order_38", INPUT, USER), {
      status: 409,
      message: "A számla már ki van állítva ezzel a címmel.",
    });
    assert.deepEqual(held.calls, []);
    const refused = setup(
      { allowed: true, reason: null },
      new MedusaAdminHttpError(
        400,
        JSON.stringify({ message: "Invalid country" }),
      ),
    );
    await assert.rejects(
      refused.service.updateAddress("order_38", INPUT, USER),
      {
        status: 422,
        message: "A cím nem változott. A webshop válasza: Invalid country",
      },
    );
    assert.deepEqual(refused.audited, []);
  });

  it("the internal note is saved trimmed, by who wrote it", async () => {
    const { audited, service } = setup({ allowed: true, reason: null });
    await service.saveInternalNote("order_38", "  Első rendelése.  ", USER);
    assert.deepEqual(audited, [["order_38", "Első rendelése.", "user_1"]]);
  });
});

/*
  A KÉZI KÁRTYA-VISSZATÉRÍTÉS RENDEZÉSE (kártya abf3f8f4; commerce #904; barracuda: a „ki” a munkamenetből jön). MI PIROSÍT: a „ki” a
  kérés törzséből vagy máshonnan töltődik, nem a bejelentkezett felhasználó hivatalos nevéből; rendezés olyan rendelésre, amin nincs
  rendezetlen kézi visszatérítés; a már rendezett rendelés újra a webshopig jut vagy második naplósort ír; a webshop elutasítása 500;
  a rendezés nem kerül auditba; a megjegyzés tisztítatlanul megy a webshopnak.
*/
function settleSetup(
  manualRefund: WebshopOrderDetail["manualRefund"],
  fail?: MedusaAdminHttpError,
) {
  const calls: unknown[] = [];
  const audited: unknown[] = [];
  const client = {
    settleManualRefund: async (id: string, input: unknown) => {
      calls.push([id, input]);
      if (fail) throw fail;
      return {
        settled_at: "x",
        settled_by: "x",
        settled_note: null,
        already: false,
      };
    },
  } as unknown as MedusaAdminClient;
  const orders = {
    detail: async (id: string) =>
      ({ id, manualRefund }) as unknown as WebshopOrderDetail,
    adminClient: async () => client,
  } as unknown as WebshopOrdersService;
  const repository = {
    recordOrderEdit: async (input: unknown) => void audited.push(input),
  } as unknown as WebshopOrdersRepository;
  return {
    calls,
    audited,
    service: new WebshopOrderEditsService(orders, repository),
  };
}
const OPEN_REFUND = {
  amount: 39100,
  creditLines: 1,
  at: "2026-11-25T08:45:56.259Z",
  settled: null,
};
const NAMED_USER = {
  id: "user_7",
  displayName: "Kiss Anna",
  email: "anna@example.hu",
} as AuthenticatedUser;

describe("settling the hand refund", () => {
  it("the WHO comes from the signed-in user's name, never from the request: an extra field is ignored; the note is trimmed", async () => {
    const { calls, service } = settleSetup(OPEN_REFUND);
    await service.settleManualRefund(
      "order_1",
      {
        note: "  Stripe irányítópult, re_123  ",
        settled_by: "Valaki Más",
      } as never,
      NAMED_USER,
    );
    assert.deepEqual(calls, [
      [
        "order_1",
        { settled_by: "Kiss Anna", note: "Stripe irányítópult, re_123" },
      ],
    ]);
  });

  it("no note, no note key; an empty note counts as none", async () => {
    for (const input of [{}, { note: "   " }]) {
      const { calls, service } = settleSetup(OPEN_REFUND);
      await service.settleManualRefund("order_1", input, NAMED_USER);
      assert.deepEqual(calls, [["order_1", { settled_by: "Kiss Anna" }]]);
    }
  });

  it("the settlement is audited: who, which order, and the notice it closed", async () => {
    const { audited, service } = settleSetup(OPEN_REFUND);
    await service.settleManualRefund("order_1", {}, NAMED_USER);
    assert.deepEqual(audited, [
      {
        userId: "user_7",
        orderId: "order_1",
        action: "manual-refund-settled",
        before: OPEN_REFUND,
      },
    ]);
  });

  it("an order with no hand refund to settle is 409 and never reaches the webshop", async () => {
    for (const none of [null, undefined]) {
      const { calls, audited, service } = settleSetup(none);
      await assert.rejects(
        service.settleManualRefund("order_1", {}, NAMED_USER),
        {
          status: 409,
          message:
            "Ennél a rendelésnél nincs kézi visszatérítés, amit rendezni kellene.",
        },
      );
      assert.deepEqual([calls, audited], [[], []]);
    }
  });

  it("an already settled order is shown as it is: no second call to the webshop, no second audit row", async () => {
    const settled = {
      ...OPEN_REFUND,
      settled: { by: "Első", at: "2026-11-25T09:00:00.000Z", note: null },
    };
    const { calls, audited, service } = settleSetup(settled);
    const detail = await service.settleManualRefund("order_1", {}, NAMED_USER);
    assert.deepEqual(detail.manualRefund, settled);
    assert.deepEqual([calls, audited], [[], []]);
  });

  it("the webshop's refusal comes through with its sentence (409 stays 409, another 4xx is 422), and nothing is audited", async () => {
    const conflict = settleSetup(
      OPEN_REFUND,
      new MedusaAdminHttpError(
        409,
        JSON.stringify({
          message:
            "A webshop szerint a rögzített összeg már vissza van térítve.",
        }),
      ),
    );
    await assert.rejects(
      conflict.service.settleManualRefund("order_1", {}, NAMED_USER),
      {
        status: 409,
        message: "A webshop szerint a rögzített összeg már vissza van térítve.",
      },
    );
    const invalid = settleSetup(
      OPEN_REFUND,
      new MedusaAdminHttpError(
        400,
        JSON.stringify({ message: "Érvénytelen kérés." }),
      ),
    );
    await assert.rejects(
      invalid.service.settleManualRefund("order_1", {}, NAMED_USER),
      { status: 422, message: "Érvénytelen kérés." },
    );
    assert.deepEqual([conflict.audited, invalid.audited], [[], []]);
  });
});
