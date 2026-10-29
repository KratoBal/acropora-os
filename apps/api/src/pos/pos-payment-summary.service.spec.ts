import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import { PosController } from "./pos.controller.js";
import {
  PosSaleRepository,
  type PosSaleDatabase,
} from "./pos-sale.repository.js";
import { PosSaleService } from "./pos-sale.service.js";

/*
  What turns this red: the summary read widening beyond completed POS sales
  (a cancelled sale or a webshop order counted), the padded read not covering
  the Budapest midnight on both ends, an unbounded range, a swapped range
  accepted, or the endpoint losing its orders.view guard.
*/
function repositoryReturning(rows: unknown[], captured: { args?: any }) {
  const db = {
    salesOrder: {
      findMany: async (args: unknown) => {
        captured.args = args;
        return rows;
      },
    },
  };
  return new PosSaleRepository(db as unknown as PosSaleDatabase);
}

describe("PosSaleRepository.paymentSummary", () => {
  it("reads completed POS sales only, padded a day on each side", async () => {
    const captured: { args?: any } = {};
    const repository = repositoryReturning(
      [
        {
          createdAt: new Date("2026-10-29T09:00:00Z"),
          paymentMethod: "CASH_DESK",
          totalGross: new Prisma.Decimal("1250"),
        },
      ],
      captured,
    );

    const result = await repository.paymentSummary("2026-10-29", "2026-10-29");

    assert.deepEqual(captured.args.where, {
      channel: "POS",
      status: "COMPLETED",
      createdAt: {
        gte: new Date("2026-10-28T00:00:00Z"),
        lt: new Date("2026-10-31T00:00:00Z"),
      },
    });
    assert.deepEqual(captured.args.select, {
      createdAt: true,
      paymentMethod: true,
      totalGross: true,
    });
    assert.deepEqual(result.totals.byMethod.CASH_DESK, {
      count: 1,
      totalGross: "1250.00",
    });
    assert.deepEqual(result.totals.byMethod.CASH, {
      count: 0,
      totalGross: "0.00",
    });
  });
});

describe("PosSaleService.paymentSummary", () => {
  function serviceWith(captured: { range?: [string, string] }) {
    const repository = {
      paymentSummary: async (from: string, to: string) => {
        captured.range = [from, to];
        return { from, to };
      },
    } as unknown as PosSaleRepository;
    return new PosSaleService(repository);
  }

  it("defaults to today in Budapest time, not in UTC", async () => {
    const captured: { range?: [string, string] } = {};
    // 23:30 UTC on the 28th is already the 29th in Budapest (CET).
    await serviceWith(captured).paymentSummary(
      {},
      new Date("2026-10-28T23:30:00Z"),
    );
    assert.deepEqual(captured.range, ["2026-10-29", "2026-10-29"]);
  });

  it("uses the given range, and a lone `to` makes a one-day range", async () => {
    const captured: { range?: [string, string] } = {};
    const service = serviceWith(captured);
    await service.paymentSummary({ from: "2026-10-23", to: "2026-10-29" });
    assert.deepEqual(captured.range, ["2026-10-23", "2026-10-29"]);
    await service.paymentSummary({ to: "2026-10-20" });
    assert.deepEqual(captured.range, ["2026-10-20", "2026-10-20"]);
  });

  it("refuses a swapped range, a non-day and a range over 93 days", () => {
    const service = serviceWith({});
    assert.throws(
      () => service.paymentSummary({ from: "2026-10-29", to: "2026-10-28" }),
      BadRequestException,
    );
    assert.throws(
      () => service.paymentSummary({ from: "2026-02-31", to: "2026-03-01" }),
      BadRequestException,
    );
    assert.throws(
      () => service.paymentSummary({ from: "2026-01-01", to: "2026-04-05" }),
      BadRequestException,
    );
    // 93 days exactly is allowed: 2026-01-01 .. 2026-04-03
    assert.doesNotThrow(() =>
      service.paymentSummary({ from: "2026-01-01", to: "2026-04-03" }),
    );
  });
});

describe("PosController summary guard", () => {
  it("requires orders.view", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        PosController.prototype.paymentSummary,
      ),
      [PERMISSIONS.ORDERS_VIEW],
    );
  });
});
