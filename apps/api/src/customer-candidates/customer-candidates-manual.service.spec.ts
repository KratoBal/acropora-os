import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { ManualListController } from "./customer-candidates-manual.controller.js";
import type {
  ManualListAudit,
  ManualRowToStore,
  PrismaManualListStore,
  ResolvedSku,
} from "./customer-candidates-manual.repository.js";
import type { ManualPlanCurrent } from "./customer-candidates-manual.rules.js";
import {
  MANUAL_LIST_MAX_ROWS,
  ManualListService,
} from "./customer-candidates-manual.service.js";

/**
 * A KÉZI LISTA HTTP-N (V3.4 S2c-3), adatbázis nélkül. MI PIROSÍT: a próba ír; az alkalmazás a lenyomat nélkül, rossz lenyomattal, jóváhagyó
 * szöveg nélkül, elutasított sor mellett vagy üres listával (kapcsoló nélkül) elindul; a két között más importál, és az alkalmazás mégis
 * ír; az audit sor nem a tényleges felhasználóval és forrással megy; a két végpont nem a termékismeret-jóváhagyás jogot kéri.
 */
const user = { id: "u-admin" } as AuthenticatedUser;
const row = (over: Record<string, unknown> = {}) => ({
  sku: "sku-1",
  parameter: "KH",
  direction: "EMEL",
  referenceUrl: "https://shop.example/p1",
  basis: "SHOP_TEXT",
  sideEffects: [],
  sideEffectsStatus: "FILLED",
  ...over,
});

function fixture(catalogue?: Record<string, ResolvedSku[]>) {
  const known = catalogue ?? {
    "sku-1": [{ productId: "p1", productName: "Termék 1", active: true }],
  };
  const writes: {
    rows: ManualRowToStore[];
    approvedBy: string;
    audit?: ManualListAudit;
  }[] = [];
  const held: ManualPlanCurrent[] = [];
  const store = {
    resolve: async (skus: readonly string[]) =>
      new Map(
        skus.flatMap((sku) =>
          known[sku] ? [[sku, known[sku]!] as const] : [],
        ),
      ),
    current: async () => [...held],
    replace: async (
      rows: readonly ManualRowToStore[],
      approvedBy: string,
      _at: Date,
      audit?: ManualListAudit,
    ) => {
      writes.push({ rows: [...rows], approvedBy, audit });
      return { stored: rows.length, removed: 0 };
    },
  } as unknown as PrismaManualListStore;
  return { service: new ManualListService(store), writes, held };
}

const rejects = async (
  promise: Promise<unknown>,
  type: new (...args: never[]) => Error,
) => {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(
    caught instanceof type,
    `expected ${type.name}, got ${String(caught)}`,
  );
  return caught as Error;
};

describe("the dry run over HTTP", () => {
  it("writes nothing and returns the counts, the rejected rows with their reasons, the warnings and the fingerprint", async () => {
    const fx = fixture();
    const report = await fx.service.dryRun({
      rows: [
        row(),
        row({ sku: "unknown" }),
        row({ sku: "bad", parameter: "FOSZFAT" }),
      ],
    });
    assert.equal(fx.writes.length, 0);
    assert.equal(report.rows, 1);
    assert.deepEqual(report.plan, {
      add: 1,
      update: 0,
      remove: 0,
      unchanged: 0,
    });
    assert.equal(report.shopText, 1);
    assert.equal(report.canApply, false);
    assert.deepEqual(
      report.rejected.map((item) => [item.row, item.sku]),
      [
        [2, "unknown"],
        [3, "bad"],
      ],
    );
    assert.match(report.fingerprint, /^[0-9a-f]{64}$/);
  });

  it("a clean list can be applied; a body that is not {rows: [...]} or is too long is a 400, not a crash", async () => {
    const fx = fixture();
    assert.equal((await fx.service.dryRun({ rows: [row()] })).canApply, true);
    for (const body of [
      null,
      undefined,
      "x",
      [],
      {},
      { rows: "x" },
      { rows: {} },
    ])
      await rejects(fx.service.dryRun(body), BadRequestException);
    await rejects(
      fx.service.dryRun({
        rows: new Array(MANUAL_LIST_MAX_ROWS + 1).fill(row()),
      }),
      BadRequestException,
    );
  });
});

describe("the apply over HTTP", () => {
  const applyBody = async (fx: ReturnType<typeof fixture>, rows: unknown[]) => {
    const report = await fx.service.dryRun({ rows });
    return {
      rows,
      approvedBy: "acrobot, V3.4 kézi lista",
      fingerprint: report.fingerprint,
    };
  };

  it("writes the whole list once, with the approver and an audit row carrying the admin's id and the source", async () => {
    const fx = fixture();
    const body = await applyBody(fx, [row()]);
    const result = await fx.service.apply(body, user);
    assert.equal(result.stored, 1);
    assert.equal(fx.writes.length, 1);
    assert.equal(fx.writes[0]!.approvedBy, "acrobot, V3.4 kézi lista");
    assert.equal(fx.writes[0]!.audit?.userId, "u-admin");
    assert.equal(fx.writes[0]!.audit?.metadata.source, "http");
    assert.equal(fx.writes[0]!.audit?.metadata.fingerprint, body.fingerprint);
  });

  it("refuses without the approver, with a blank or over-long one, and without or with a wrong fingerprint: nothing is written", async () => {
    const fx = fixture();
    const body = await applyBody(fx, [row()]);
    for (const bad of [
      { ...body, approvedBy: undefined },
      { ...body, approvedBy: "   " },
      { ...body, approvedBy: "x".repeat(201) },
      { ...body, fingerprint: undefined },
      { ...body, fingerprint: "" },
    ])
      await rejects(fx.service.apply(bad, user), BadRequestException);
    await rejects(
      fx.service.apply({ ...body, fingerprint: "0".repeat(64) }, user),
      ConflictException,
    );
    await rejects(fx.service.apply(null, user), BadRequestException);
    assert.equal(fx.writes.length, 0);
  });

  it("another import between the dry run and the apply makes the apply a 409, and the new dry run's fingerprint goes through", async () => {
    const fx = fixture();
    const body = await applyBody(fx, [row()]);
    fx.held.push({
      productId: "p9",
      sku: "sku-9",
      parameter: "KH",
      direction: "EMEL",
      referenceUrl: "https://shop.example/held",
      basis: "SHOP_TEXT",
      sideEffects: [],
      sideEffectsStatus: "FILLED",
      note: null,
    });
    await rejects(fx.service.apply(body, user), ConflictException);
    assert.equal(fx.writes.length, 0);
    const fresh = await applyBody(fx, [row()]);
    await fx.service.apply(fresh, user);
    assert.equal(fx.writes.length, 1);
  });

  it("does not start on a rejected row even with a matching fingerprint", async () => {
    const fx = fixture();
    const body = await applyBody(fx, [row(), row({ sku: "unknown" })]);
    await rejects(fx.service.apply(body, user), BadRequestException);
    assert.equal(fx.writes.length, 0);
  });

  it("an empty list needs allowEmpty: true (exactly), then it empties the table", async () => {
    const fx = fixture();
    const body = await applyBody(fx, []);
    await rejects(fx.service.apply(body, user), BadRequestException);
    await rejects(
      fx.service.apply({ ...body, allowEmpty: "true" }, user),
      BadRequestException,
    );
    assert.equal(fx.writes.length, 0);
    await fx.service.apply({ ...body, allowEmpty: true }, user);
    assert.equal(fx.writes.length, 1);
    assert.equal(fx.writes[0]!.rows.length, 0);
  });
});

describe("the controller", () => {
  it("both routes need exactly products.knowledge.approve (OWNER and ADMIN), and pass the body and the user on", async () => {
    const calls: unknown[][] = [];
    const service = {
      dryRun: async (...args: unknown[]) => (
        calls.push(["dryRun", ...args]),
        {}
      ),
      apply: async (...args: unknown[]) => (calls.push(["apply", ...args]), {}),
    } as unknown as ManualListService;
    const controller = new ManualListController(service);
    for (const handler of [controller.dryRun, controller.apply])
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), [
        PERMISSIONS.PRODUCTS_KNOWLEDGE_APPROVE,
      ]);
    const body = { rows: [] };
    await controller.dryRun(body);
    await controller.apply(body, user);
    assert.deepEqual(calls, [
      ["dryRun", body],
      ["apply", body, user],
    ]);
  });
});
