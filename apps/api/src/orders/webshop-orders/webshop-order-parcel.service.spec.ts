import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser, WebshopOrderDetail } from "@acropora/types";

import { CarrierError } from "../../integrations/carriers/carrier.types.js";
import type {
  CreateWebshopParcelInput,
  WebshopParcelService,
  WebshopParcelView,
} from "../../integrations/carriers/webshop-parcel.service.js";
import type {
  MedusaOrderBusinessStatus,
  MedusaOrderDetailRow,
  MedusaOrderPayment,
  MedusaShippingNotice,
} from "../../integrations/medusa/medusa-admin.client.js";
import { WebshopOrderParcelService } from "./webshop-order-parcel.service.js";
import type {
  WebshopOrderInvoiceRow,
  WebshopOrdersRepository,
} from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  A CSOMAGFELADÁS A RENDELÉS OLDALÁRÓL. MI PIROSÍT: számla nélkül a szállító
  hívódik; a teszt-csomagszám (`STUB-`) a webshop levelébe kerül; a levél
  hibája elveszíti a már létrejött csomagot; a szállító hibája 500 vagy nyers
  szöveg, nem a kollegának szóló mondat; a feloldás nem kerül auditba, vagy
  sikertelen feloldás is auditba kerül.
*/
const USER = { id: "user_1" } as AuthenticatedUser;

const ORDER = {
  id: "order_38",
  display_id: 38,
  email: "emese@example.hu",
  total: 20840,
  shipping_address: {
    first_name: "Emese",
    last_name: "Nagy",
    phone: "+36 30 555 0137",
  },
  billing_address: null,
  shipping_methods: [
    {
      name: "Foxpost csomagpont",
      data: { foxpost_pickup_point: { id: "HU12345", name: "FOXPOST Allee" } },
    },
  ],
  payment_collections: [],
} as unknown as MedusaOrderDetailRow;

const ISSUED: WebshopOrderInvoiceRow = {
  id: "webshop-order_38",
  status: "ISSUED",
  number: "E-1",
};

function setup(
  over: {
    invoice?: WebshopOrderInvoiceRow;
    parcelNumber?: string;
    createError?: CarrierError;
    noticeError?: Error;
    releaseError?: CarrierError;
    orderPayment?: MedusaOrderPayment | null;
    order?: MedusaOrderDetailRow;
  } = {},
) {
  const calls: string[] = [];
  const created: CreateWebshopParcelInput[] = [];
  const notices: MedusaShippingNotice[] = [];
  const orders = {
    source: async () => ({
      order: over.order ?? ORDER,
      status: { status: "stocking" } as MedusaOrderBusinessStatus,
    }),
    detail: async (id: string) => ({ id }) as WebshopOrderDetail,
    adminClient: async () => ({
      orderPayment: async () => over.orderPayment ?? null,
    }),
    sendShippingNotice: async (_id: string, notice: MedusaShippingNotice) => {
      notices.push(notice);
      if (over.noticeError) throw over.noticeError;
      return { sent: true as const };
    },
  } as unknown as WebshopOrdersService;
  const repository = {
    invoices: async (ids: string[]) =>
      new Map(over.invoice ? [[ids[0]!, over.invoice]] : []),
    recordParcelReleased: async (input: { orderId: string }) => {
      calls.push(`audit release ${input.orderId}`);
    },
  } as unknown as WebshopOrdersRepository;
  const parcels = {
    createParcel: async (input: CreateWebshopParcelInput) => {
      created.push(input);
      if (over.createError) throw over.createError;
      const parcelNumber = over.parcelNumber ?? "CLFOX0000012345";
      return {
        id: "pc_1",
        commerceOrderId: input.commerceOrderId,
        carrier: input.carrier,
        reference: "38",
        parcelNumber,
        stub: parcelNumber.startsWith("STUB-"),
        size: input.size ?? null,
        codHuf: input.codHuf ?? null,
        createdAt: new Date(),
      } satisfies WebshopParcelView;
    },
    labelPdf: async () => Buffer.from("%PDF"),
    releaseUnconfirmed: async (id: string) => {
      calls.push(`release ${id}`);
      if (over.releaseError) throw over.releaseError;
    },
  } as unknown as WebshopParcelService;
  return {
    calls,
    created,
    notices,
    service: new WebshopOrderParcelService(orders, repository, parcels),
  };
}

describe("WebshopOrderParcelService", () => {
  it("creates the parcel from the order, then asks the webshop for the shipped mail", async () => {
    const { created, notices, service } = setup({ invoice: ISSUED });
    const result = await service.create("order_38", "m", USER);
    assert.deepEqual(created, [
      {
        commerceOrderId: "order_38",
        displayId: 38,
        carrier: "foxpost",
        recipient: {
          name: "Nagy Emese",
          phone: "+36 30 555 0137",
          email: "emese@example.hu",
        },
        destination: { kind: "point", pointId: "HU12345" },
        size: "m",
        labelContent: "Rendelés #38",
        createdByUserId: "user_1",
      },
    ]);
    assert.deepEqual(notices, [
      {
        carrier: "foxpost",
        tracking_number: "CLFOX0000012345",
        parcel_id: "pc_1",
      },
    ]);
    assert.deepEqual(result.notice, { sent: true });
  });

  it("cash on delivery: the invoice number goes as the COD reference (Balázs, emlék 2109)", async () => {
    const { created, service } = setup({
      invoice: ISSUED,
      order: {
        ...ORDER,
        payment_collections: [
          {
            payments: [{ id: "p", provider_id: "pp_acropora_cod", data: null }],
          },
        ],
      } as unknown as MedusaOrderDetailRow,
    });
    await service.create("order_38", undefined, USER);
    assert.deepEqual(
      [created[0]!.codHuf, created[0]!.codReference, created[0]!.labelContent],
      [20840, "E-1", "Rendelés #38"],
    );
  });

  it("a stub parcel number never reaches the webshop's mail", async () => {
    const { notices, service } = setup({
      invoice: ISSUED,
      parcelNumber: "STUB-FOXPOST-1",
    });
    const result = await service.create("order_38", undefined, USER);
    assert.deepEqual(notices, []);
    assert.deepEqual(result.notice, { sent: false, reason: "stub" });
  });

  it("a failed mail keeps the parcel: the answer is the page and the reason", async () => {
    const { created, service } = setup({
      invoice: ISSUED,
      noticeError: new Error("HTTP 503"),
    });
    const result = await service.create("order_38", undefined, USER);
    assert.equal(created.length, 1);
    assert.deepEqual(result.order, { id: "order_38" });
    assert.deepEqual(result.notice, { sent: false, reason: "failed" });
  });

  it("without an issued invoice the carrier is not called", async () => {
    for (const invoice of [
      undefined,
      { ...ISSUED, status: "DRAFT" as const, number: null },
    ]) {
      const { created, service } = setup({ invoice });
      await assert.rejects(service.create("order_38", undefined, USER), {
        status: 409,
        message: "Előbb állítsd ki a számlát.",
      });
      assert.equal(created.length, 0);
    }
  });

  it("after a released hold, no parcel until the link is paid", async () => {
    const { created, service } = setup({
      invoice: ISSUED,
      orderPayment: {
        state: "link_sent",
        hold: null,
        link: null,
        paid_at: null,
      },
    });
    await assert.rejects(service.create("order_38", undefined, USER), {
      status: 409,
      message: /fizetési link kifizetése után/,
    });
    assert.equal(created.length, 0);
  });

  it("a carrier error is the colleague's sentence with its own status", async () => {
    const duplicate = setup({
      invoice: ISSUED,
      createError: new CarrierError("DUPLICATE", "foxpost"),
    });
    await assert.rejects(
      duplicate.service.create("order_38", undefined, USER),
      {
        status: 409,
        message: /már tartozik csomag/,
      },
    );
    const point = setup({
      invoice: ISSUED,
      createError: new CarrierError(
        "INVALID_POINT",
        "foxpost",
        "raw provider text",
      ),
    });
    await assert.rejects(
      point.service.create("order_38", undefined, USER),
      (error) => {
        assert.equal((error as { status: number }).status, 422);
        assert.doesNotMatch((error as Error).message, /raw provider text/);
        return true;
      },
    );
  });

  it("a release is audited only when it happened", async () => {
    const done = setup();
    await done.service.release("order_38", USER);
    assert.deepEqual(done.calls, [
      "release order_38",
      "audit release order_38",
    ]);

    const refused = setup({
      releaseError: new CarrierError("UNCONFIRMED", "foxpost"),
    });
    await assert.rejects(refused.service.release("order_38", USER), {
      status: 409,
    });
    assert.deepEqual(refused.calls, ["release order_38"]);
  });
});
