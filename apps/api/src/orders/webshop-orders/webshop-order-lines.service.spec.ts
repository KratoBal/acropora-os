import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser, WebshopOrderDetail } from "@acropora/types";

import {
  MedusaAdminHttpError,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { WebshopOrderLinesService } from "./webshop-order-lines.service.js";
import type { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import type { WebshopOrdersService } from "./webshop-orders.service.js";

/*
  A TÉTELMŰVELETEK A WEBSHOP SZERKESZTÉSI ÚTJÁN. MI PIROSÍT: a művelet nem a
  Medusa sorrendjében megy (megnyitás, változás, kérés, megerősítés); a
  csere nem veszi ki a régi tételt; egy elbukott lépés után félbehagyott
  szerkesztés marad a webshopban; a webshop elutasítása 500, vagy elveszik a
  mondata; tiltott állapotban, vagy az utolsó tétel törlésénél a webshop
  hívódik; a művelet nem kerül auditba, vagy a bukott is auditba kerül.
*/
const USER = { id: "user_1" } as AuthenticatedUser;

const DETAIL = {
  id: "order_38",
  lines: [
    { id: "i1", title: "Reef Salt Pro 20 kg", quantity: 1 },
    { id: "i2", title: "Coral Food · 100 ml", quantity: 2 },
  ],
  lineEdit: { allowed: true, reason: null },
} as unknown as WebshopOrderDetail;

function setup(
  over: {
    detail?: Partial<WebshopOrderDetail>;
    failAt?: string;
    failWith?: MedusaAdminHttpError;
  } = {},
) {
  const calls: string[] = [];
  const audited: unknown[] = [];
  const step =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args.slice(1)].join(" "));
      if (over.failAt === name)
        throw (
          over.failWith ??
          new MedusaAdminHttpError(
            400,
            JSON.stringify({
              message: "A szerkesztés után a rendelés többe kerül",
            }),
          )
        );
    };
  const client = {
    beginOrderEdit: step("begin"),
    setOrderEditItemQuantity: step("quantity"),
    addOrderEditItem: step("add"),
    requestOrderEdit: step("request"),
    confirmOrderEdit: step("confirm"),
    cancelOrderEdit: step("cancel"),
    searchVariants: async () => [
      {
        id: "v1",
        title: "Default variant",
        sku: "RSP-25",
        product: { title: "Reef Salt Pro 25 kg" },
      },
      {
        id: "v2",
        title: "250 ml",
        sku: "CF-250",
        product: { title: "Coral Food" },
      },
    ],
  } as unknown as MedusaAdminClient;
  const orders = {
    detail: async () => ({ ...DETAIL, ...over.detail }),
    adminClient: async () => client,
  } as unknown as WebshopOrdersService;
  const repository = {
    recordLineEdit: async (input: unknown) => void audited.push(input),
  } as unknown as WebshopOrdersRepository;
  return {
    calls,
    audited,
    service: new WebshopOrderLinesService(orders, repository),
  };
}

describe("WebshopOrderLinesService", () => {
  it("a quantity goes through Medusa's edit: begin, change, request, confirm; audited", async () => {
    const { calls, audited, service } = setup();
    await service.edit(
      "order_38",
      "i2",
      { kind: "quantity", quantity: 1 },
      USER,
    );
    assert.deepEqual(calls, [
      "begin OS: mennyiség · Coral Food · 100 ml",
      "quantity i2 1",
      "request",
      "confirm",
    ]);
    assert.deepEqual(audited, [
      {
        userId: "user_1",
        orderId: "order_38",
        itemId: "i2",
        title: "Coral Food · 100 ml",
        before: 2,
        edit: { kind: "quantity", quantity: 1 },
      },
    ]);
  });

  it("a removal is quantity 0; a replacement removes the old line and adds the new", async () => {
    const removal = setup();
    await removal.service.edit("order_38", "i1", { kind: "remove" }, USER);
    assert.deepEqual(removal.calls.slice(1), [
      "quantity i1 0",
      "request",
      "confirm",
    ]);

    const replacement = setup();
    await replacement.service.edit(
      "order_38",
      "i1",
      { kind: "replace", variantId: "v1", quantity: 2 },
      USER,
    );
    assert.deepEqual(replacement.calls.slice(1), [
      "quantity i1 0",
      "add v1 2",
      "request",
      "confirm",
    ]);
  });

  it("a refused confirm withdraws the edit, says the webshop's reason, and is not audited", async () => {
    const { calls, audited, service } = setup({ failAt: "confirm" });
    await assert.rejects(
      service.edit("order_38", "i2", { kind: "quantity", quantity: 5 }, USER),
      (error: unknown) => {
        assert.equal((error as { status: number }).status, 422);
        assert.match(
          (error as Error).message,
          /A webshop válasza: A szerkesztés után a rendelés többe kerül/,
        );
        return true;
      },
    );
    assert.equal(calls.at(-1), "cancel");
    assert.deepEqual(audited, []);
  });

  it("a webshop that cannot open the edit is not withdrawn (nothing was opened)", async () => {
    const { calls, service } = setup({
      failAt: "begin",
      failWith: new MedusaAdminHttpError(
        400,
        JSON.stringify({ message: "An active order change exists" }),
      ),
    });
    await assert.rejects(
      service.edit("order_38", "i2", { kind: "quantity", quantity: 1 }, USER),
      /nem nyitotta meg a szerkesztést: An active order change exists/,
    );
    assert.deepEqual(calls, ["begin OS: mennyiség · Coral Food · 100 ml"]);
  });

  it("not editable now, the last line's removal, an unknown line or the same quantity: the webshop is not called", async () => {
    const closed = setup({
      detail: {
        lineEdit: {
          allowed: false,
          reason: "A tételek a Kiszállítás előtt módosíthatók.",
        },
      },
    });
    await assert.rejects(
      closed.service.edit("order_38", "i1", { kind: "remove" }, USER),
      { status: 409, message: "A tételek a Kiszállítás előtt módosíthatók." },
    );
    const last = setup({ detail: { lines: [DETAIL.lines[0]!] } });
    await assert.rejects(
      last.service.edit("order_38", "i1", { kind: "remove" }, USER),
      {
        status: 409,
      },
    );
    const unknown = setup();
    await assert.rejects(
      unknown.service.edit("order_38", "fee", { kind: "remove" }, USER),
      {
        status: 404,
      },
    );
    const same = setup();
    await same.service.edit(
      "order_38",
      "i2",
      { kind: "quantity", quantity: 2 },
      USER,
    );
    for (const run of [closed, last, unknown, same])
      assert.deepEqual(run.calls, []);
  });

  it("variants read as product · variant, without the default variant's title", async () => {
    assert.deepEqual(await setup().service.variants("re"), [
      { variantId: "v1", title: "Reef Salt Pro 25 kg", sku: "RSP-25" },
      { variantId: "v2", title: "Coral Food · 250 ml", sku: "CF-250" },
    ]);
    assert.deepEqual(await setup().service.variants(" r "), []);
  });
});
