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

/**
 * UGYANAZ A FIZETÉS, MÁS KÖZLEMÉNNYEL, MÁS KULCCSAL (Aquarioom 2026-10-12, mérve acrobot
 * 2026-10-30). MI PIROSIT: a közlemény-eltérő újraexport új tranzakciót hoz (dupla); egy valódi
 * második fizetés (más könyvelési nap, vagy a fájl más sora birtokolja a meglévőt, vagy a
 * kötegben most létrejött) elnyelődik; a régi hívás (tulajdonosok nélkül) megváltozik.
 */
describe("planBankRows: the same payment under a new key", () => {
  const BOOKED = day("2026-09-10");
  const withBooking = (overrides: Partial<IncomingBankRow> = {}) =>
    row({ bookingDate: BOOKED, ...overrides });
  const earlier = (
    id: string,
    sources: ExistingBankTransaction["sources"] = ["CSV"],
    overrides: Partial<ExistingBankTransaction> = {},
  ) => tx(id, sources, { bookingDate: BOOKED, ...overrides });
  const OWNERS = new Map<string, string>();

  it("a másik exportban más közleménnyel jövő sor (új kulcs) ugyanaz a fizetés: SKIP, nem új tranzakció", () => {
    assert.deepEqual(
      planBankRows(
        [withBooking({ sourceKey: "csv-new" })],
        new Set(),
        [earlier("t1")],
        OWNERS,
      ),
      [{ kind: "SKIP", reason: "SAME_PAYMENT_NEW_KEY" }],
    );
  });

  it("a régi hívás (tulajdonosok nélkül) a régi viselkedés: CREATE", () => {
    assert.deepEqual(
      planBankRows([withBooking({ sourceKey: "csv-new" })], new Set(), [
        earlier("t1"),
      ]).map((a) => a.kind),
      ["CREATE"],
    );
  });

  it("más könyvelési napon az azonos hely VALÓDI második fizetés (azonnali utalás): CREATE", () => {
    assert.deepEqual(
      planBankRows(
        [withBooking({ sourceKey: "csv-new", bookingDate: day("2026-09-12") })],
        new Set(),
        [earlier("t1")],
        OWNERS,
      ).map((a) => a.kind),
      ["CREATE"],
    );
  });

  it("a fájl egyik sora a meglévőt már birtokolja (ismert kulcs), a másik ismeretlen: az valódi második fizetés", () => {
    const plan = planBankRows(
      [
        withBooking({ sourceKey: "csv-known" }),
        withBooking({ sourceKey: "csv-new" }),
      ],
      new Set(["csv-known"]),
      [earlier("t1")],
      new Map([["csv-known", "t1"]]),
    );
    assert.deepEqual(plan, [
      { kind: "SKIP", reason: "SAME_SOURCE_KEY" },
      { kind: "CREATE" },
    ]);
  });

  it("három meglévő, négy ismeretlen kulcsú sor: három újraexport (SKIP), egy új (CREATE); egy tranzakciót egy sor fogyaszt el", () => {
    const plan = planBankRows(
      [1, 2, 3, 4].map((n) => withBooking({ sourceKey: `csv-n${n}` })),
      new Set(),
      [earlier("t1"), earlier("t2"), earlier("t3")],
      OWNERS,
    );
    assert.deepEqual(
      plan.map((a) => (a.kind === "SKIP" ? a.reason : a.kind)),
      [
        "SAME_PAYMENT_NEW_KEY",
        "SAME_PAYMENT_NEW_KEY",
        "SAME_PAYMENT_NEW_KEY",
        "CREATE",
      ],
    );
  });

  it("két azonos fizetés EGY fájlban, első feltöltés: két külön tranzakció (a kötegben létrejött nem fogyasztható)", () => {
    const plan = planBankRows(
      [
        withBooking({ sourceKey: "csv-a" }),
        withBooking({ sourceKey: "csv-b" }),
      ],
      new Set(),
      [],
      OWNERS,
    );
    assert.deepEqual(
      plan.map((a) => a.kind),
      ["CREATE", "CREATE"],
    );
  });

  it("a Számlázz.hu új azonosítója mindig új fizetés (a kulcsa nem a tartalmából jön): CREATE, nem SKIP", () => {
    assert.deepEqual(
      planBankRows(
        [withBooking({ source: "SZAMLAZZ", sourceKey: "szamlazz:990003" })],
        new Set(),
        [earlier("t1", ["CSV", "SZAMLAZZ"])],
        OWNERS,
      ).map((a) => a.kind),
      ["CREATE"],
    );
  });

  it("a másik forrás szabad tranzakciója előbbre való: CLAIM, nem SKIP", () => {
    assert.deepEqual(
      planBankRows(
        [withBooking({ sourceKey: "csv-new" })],
        new Set(),
        [earlier("t1", ["SZAMLAZZ"])],
        OWNERS,
      ),
      [{ kind: "CLAIM", transactionId: "t1" }],
    );
  });
});
