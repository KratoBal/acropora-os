import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import type { MnbExchangeRateService } from "../../integrations/mnb/mnb-exchange-rate.service.js";
import { PriceListDisplayService } from "./price-list-display.service.js";
import type { PriceListRepository } from "./price-list.repository.js";

const NOW = new Date("2026-10-23T12:00:00.000Z");

function setup(options: {
  selling?: {
    unitNet: Prisma.Decimal | null;
    reason: string | null;
    sale: boolean;
  } | null;
  matches?: {
    supplierId: string;
    supplierSku: string;
    method: string;
    status: string;
    supplier: { name: string };
  }[];
  entries?: Record<
    string,
    {
      supplierName: string | null;
      unitPrice: string;
      listRetailPrice: string | null;
      listDate: Date;
      currency: string;
    }
  >;
  failing?: string[];
}) {
  const asked: string[] = [];
  const repository = {
    sellingPrice: async () =>
      options.selling === undefined
        ? { unitNet: new Prisma.Decimal("10000"), reason: null, sale: false }
        : options.selling,
    matchesForVariant: async () => options.matches ?? [],
    latestEntries: async () => new Map(Object.entries(options.entries ?? {})),
  } as unknown as PriceListRepository;
  const exchangeRates = {
    getRateForDate: async (currency: string) => {
      asked.push(currency);
      if (options.failing?.includes(currency))
        throw new Error("MNB nem elérhető");
      return { quotedDate: "2026-10-23", rate: "400" };
    },
  } as unknown as MnbExchangeRateService;
  return {
    service: new PriceListDisplayService(repository, exchangeRates),
    asked,
  };
}

const match = (
  supplierId: string,
  supplierSku: string,
  name: string,
  status = "AUTO",
) => ({
  supplierId,
  supplierSku,
  method: "EAN",
  status,
  supplier: { name },
});
const entry = (unitPrice: string, currency = "EUR") => ({
  supplierName: "Example",
  unitPrice,
  listRetailPrice: null,
  listDate: new Date("2026-10-12T00:00:00.000Z"),
  currency,
});

describe("PriceListDisplayService.forVariant", () => {
  it("says there is no such variant", async () => {
    const { service } = setup({ selling: null });
    await assert.rejects(service.forVariant("nope", NOW), NotFoundException);
  });

  it("returns a row per matched supplier code that has a list entry, with the profit on the net selling price", async () => {
    const { service } = setup({
      matches: [
        match("s1", "A-1", "Hertlein", "APPROVED"),
        match("s2", "B-2", "De Jong"),
      ],
      entries: { "s1\u0000A-1": entry("20"), "s2\u0000B-2": entry("10") },
    });
    const result = await service.forVariant("v1", NOW);
    assert.equal(result.sellingNetHuf, "10000.00");
    assert.equal(result.sellingReason, null);
    assert.deepEqual(
      result.rows.map((row) => [
        row.supplierName,
        row.purchaseHuf,
        row.profitHuf,
        row.matchStatus,
      ]),
      [
        ["De Jong", "4000.00", "6000.00", "AUTO"],
        ["Hertlein", "8000.00", "2000.00", "APPROVED"],
      ],
    );
  });

  it("leaves out a matched code whose list entry is gone (the list was deleted)", async () => {
    const { service } = setup({
      matches: [match("s1", "A-1", "Hertlein")],
      entries: {},
    });
    assert.deepEqual((await service.forVariant("v1", NOW)).rows, []);
  });

  it("asks the exchange rate once per foreign currency and never for forints", async () => {
    const { service, asked } = setup({
      matches: [
        match("s1", "A-1", "H"),
        match("s2", "B-2", "D"),
        match("s3", "C-3", "F"),
      ],
      entries: {
        "s1\u0000A-1": entry("20"),
        "s2\u0000B-2": entry("10"),
        "s3\u0000C-3": entry("9000", "HUF"),
      },
    });
    await service.forVariant("v1", NOW);
    assert.deepEqual(asked, ["EUR"]);
  });

  it("keeps the row without a forint price when the exchange rate cannot be had", async () => {
    const { service } = setup({
      matches: [match("s1", "A-1", "H")],
      entries: { "s1\u0000A-1": entry("20") },
      failing: ["EUR"],
    });
    const [row] = (await service.forVariant("v1", NOW)).rows;
    assert.deepEqual(
      [row!.unitPrice, row!.purchaseHuf, row!.profitHuf],
      ["20", null, null],
    );
  });

  it("names the reason when there is no selling price, and still shows the purchase side", async () => {
    const { service } = setup({
      selling: { unitNet: null, reason: "vat-rate-missing", sale: false },
      matches: [match("s1", "A-1", "H")],
      entries: { "s1\u0000A-1": entry("20") },
    });
    const result = await service.forVariant("v1", NOW);
    assert.deepEqual(
      [result.sellingNetHuf, result.sellingReason],
      [null, "vat-rate-missing"],
    );
    assert.deepEqual(
      [result.rows[0]!.purchaseHuf, result.rows[0]!.profitHuf],
      ["8000.00", null],
    );
  });
});
