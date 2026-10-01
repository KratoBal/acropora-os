import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  bankSlot,
  planBankRows,
  type ExistingBankTransaction,
  type IncomingBankRow,
} from "./bank-transaction-sources.js";

const D = (v: string | number) => new Prisma.Decimal(v);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const row = (overrides: Partial<IncomingBankRow>): IncomingBankRow => ({
  source: "CSV",
  sourceKey: "csv-1",
  accountNumber: "1170900220624460",
  direction: "DEBIT",
  amount: D(23810),
  currency: "HUF",
  valueDate: day("2026-09-10"),
  counterpartyAccount: "11773016-00000000",
  ...overrides,
});
const tx = (
  id: string,
  sources: ExistingBankTransaction["sources"],
  overrides: Partial<ExistingBankTransaction> = {},
): ExistingBankTransaction => ({
  id,
  accountNumber: "1170900220624460",
  direction: "DEBIT",
  amount: D(23810),
  currency: "HUF",
  valueDate: day("2026-09-10"),
  counterpartyAccount: "11773016-00000000",
  sources,
  ...overrides,
});

describe("planBankRows: one payment from two sources", () => {
  it("the same key from the same source writes nothing", () => {
    assert.deepEqual(
      planBankRows([row({})], new Set(["csv-1"]), [tx("t1", ["CSV"])]),
      [{ kind: "SKIP", reason: "SAME_SOURCE_KEY" }],
    );
  });

  it("the transfer claims what the CSV already brought, and the CSV claims what the transfer brought", () => {
    const feed = row({ source: "SZAMLAZZ", sourceKey: "szamlazz:77" });
    assert.deepEqual(planBankRows([feed], new Set(), [tx("t1", ["CSV"])]), [
      { kind: "CLAIM", transactionId: "t1" },
    ]);
    assert.deepEqual(
      planBankRows([row({})], new Set(), [tx("t2", ["SZAMLAZZ"])]),
      [{ kind: "CLAIM", transactionId: "t2" }],
    );
  });

  it("two identical payments on one day stay two (measured: two 23 810 Ft Alza purchases)", () => {
    const csv = [row({ sourceKey: "csv-a" }), row({ sourceKey: "csv-b" })];
    assert.deepEqual(
      planBankRows(csv, new Set(), []).map((a) => a.kind),
      ["CREATE", "CREATE"],
    );
    const feed = [
      row({ source: "SZAMLAZZ", sourceKey: "szamlazz:1" }),
      row({ source: "SZAMLAZZ", sourceKey: "szamlazz:2" }),
      row({ source: "SZAMLAZZ", sourceKey: "szamlazz:3" }),
    ];
    // ket bent levo CSV-tranzakcio: az elso ket tovabbitott sor lefoglalja, a harmadik uj
    assert.deepEqual(
      planBankRows(feed, new Set(), [tx("t1", ["CSV"]), tx("t2", ["CSV"])]),
      [
        { kind: "CLAIM", transactionId: "t1" },
        { kind: "CLAIM", transactionId: "t2" },
        { kind: "CREATE" },
      ],
    );
  });

  it("a transaction is claimed by each source at most once", () => {
    // a CSV-tranzakciot egy masik CSV-kulcs nem foglalja le: az uj sor
    assert.deepEqual(
      planBankRows([row({ sourceKey: "csv-2" })], new Set(), [
        tx("t1", ["CSV"]),
      ]),
      [{ kind: "CREATE" }],
    );
  });

  it("the slot is the value day, not the booking day, and the account forms meet", () => {
    const feed = row({
      source: "SZAMLAZZ",
      sourceKey: "szamlazz:9",
      accountNumber: "HU42117090022062446000000000",
      counterpartyAccount: "1177301600000000",
    });
    assert.equal(bankSlot(feed), bankSlot(tx("t1", ["CSV"])));
    // mas ertek-nap: nem ugyanaz a fizetes
    assert.deepEqual(
      planBankRows([feed], new Set(), [
        tx("t1", ["CSV"], { valueDate: day("2026-09-11") }),
      ]),
      [{ kind: "CREATE" }],
    );
  });

  it("a different amount, direction or partner account is a different payment", () => {
    const feed = (o: Partial<IncomingBankRow>) =>
      planBankRows(
        [row({ source: "SZAMLAZZ", sourceKey: "szamlazz:5", ...o })],
        new Set(),
        [tx("t1", ["CSV"])],
      )[0]!.kind;
    assert.equal(feed({ amount: D(23811) }), "CREATE");
    assert.equal(feed({ direction: "CREDIT" }), "CREATE");
    assert.equal(feed({ counterpartyAccount: "99999999-00000000" }), "CREATE");
    assert.equal(feed({ amount: D("23810.0000") }), "CLAIM");
  });
});
