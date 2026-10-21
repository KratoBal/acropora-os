import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  diagnoseReport,
  diagnoseSummary,
  diagnoseUnpaired,
  type DiagnoseDebit,
  type DiagnoseRow,
} from "./incoming-bank-diagnose.js";
import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";
import { parseSince } from "./incoming-bank-diagnose.cli.js";

/**
 * A PÁROSÍTATLAN SOROK DIAGNÓZISA (acrobot 34637, 34661). Kitalált számok. MI
 * PIROSÍT: ha egy párosított sor is listára kerül; ha a terhelés-ablak vagy az
 * összeg-tűrés más, mint a leírt; ha a határidő 2099-es „nincs határidő”
 * értéke kitolja az ablakot.
 */
const D = (value: string) => new Prisma.Decimal(value);
const row = (over: Partial<DiagnoseRow> = {}): DiagnoseRow => ({
  id: "row-1",
  documentNumber: "TST-2026/1",
  supplierName: "Teszt Kft.",
  grossAmount: D("117099"),
  currency: "HUF",
  issueDate: new Date("2026-09-04T00:00:00Z"),
  dueDate: new Date("2026-09-09T00:00:00Z"),
  lastPaymentDate: new Date("2026-09-16T00:00:00Z"),
  paymentsKnown: true,
  paidAmount: D("117099"),
  sourceDocumentId: "xml-1",
  kindCode: "SZ",
  ...over,
});
const debit = (over: Partial<DiagnoseDebit> = {}): DiagnoseDebit => ({
  id: "debit-1",
  bookingDate: "2026-09-16",
  amount: "-117099",
  currency: "HUF",
  partner: "Teszt Kft.",
  narrative: "TST-2026/1",
  state: "NO_INVOICE",
  document: null,
  matchedBy: null,
  ...over,
});

describe("why an incoming invoice reads as unpaired", () => {
  it("a paired row is not listed; an unpaired one is, with its debits of the same amount in the window", () => {
    const paired = new Map([
      [
        "xml-1",
        {
          debits: [
            { bookingDate: "2026-09-16", amount: "117099", currency: "HUF" },
          ],
          paidInFull: true,
          payee: "COMPANY",
          kind: "INVOICE",
        } as unknown as DocumentPairing,
      ],
    ]);
    assert.deepEqual(diagnoseUnpaired([row()], paired, [debit()]), []);
    const [line] = diagnoseUnpaired([row()], new Map(), [
      debit(),
      debit({ id: "off-by-2", amount: "-117101" }),
      debit({ id: "within-1", amount: "-117100" }),
      debit({ id: "too-early", bookingDate: "2026-08-04" }),
      debit({ id: "first-day", bookingDate: "2026-08-05" }),
      debit({ id: "last-day", bookingDate: "2026-10-01" }),
      debit({ id: "too-late", bookingDate: "2026-10-02" }),
      debit({ id: "eur", currency: "EUR" }),
    ]);
    assert.deepEqual(
      line?.debits.map((d) => d.id),
      ["debit-1", "within-1", "first-day", "last-day"],
    );
    assert.equal(line?.paidByFeed, true);
  });

  it("a 2099 due date (no due date) does not widen the window; a row without debits says so", () => {
    const [line] = diagnoseUnpaired(
      [
        row({
          dueDate: new Date("2099-12-31T00:00:00Z"),
          lastPaymentDate: null,
        }),
      ],
      new Map(),
      [
        debit({ bookingDate: "2026-09-19" }),
        debit({ id: "far", bookingDate: "2026-09-20" }),
      ],
    );
    assert.deepEqual(
      line?.debits.map((d) => d.id),
      ["debit-1"],
    );
    const report = diagnoseReport(
      diagnoseUnpaired([row({ id: "r2", grossAmount: D("5000") })], new Map(), [
        debit(),
      ]),
    );
    assert.match(
      report,
      /párosítatlan bejövő számla: 1 \(ebből illő összegű terheléssel: 0, terhelés nélkül: 1\)/,
    );
    assert.match(report, /nincs ilyen összegű terhelés az ablakban/);
  });

  it("the command takes a real day only", () => {
    assert.equal(parseSince(["--since", "2026-09-01"]), "2026-09-01");
    for (const bad of [
      [],
      ["--since"],
      ["--since", "2026-09-31"],
      ["--since", "09-01"],
      ["--since", "--all"],
    ])
      assert.equal(parseSince(bad), null, JSON.stringify(bad));
  });

  it("--osszesito: one number per issue month and the total (acrobot 34662); a far due date does not throw", () => {
    const lines = diagnoseUnpaired(
      [
        row({ id: "a" }),
        row({ id: "b", documentNumber: "TST-2026/2" }),
        row({
          id: "c",
          documentNumber: "TST-2026/3",
          issueDate: new Date("2026-10-02T00:00:00Z"),
        }),
        // every date beyond 2090: the window falls back to the issue date instead of failing
        row({
          id: "d",
          documentNumber: "TST-2099/1",
          issueDate: new Date("2099-12-31T00:00:00Z"),
          dueDate: null,
          lastPaymentDate: null,
        }),
      ],
      new Map(),
      [],
    );
    assert.equal(
      diagnoseSummary(lines),
      "2026-09\t2\n2026-10\t1\n2099-12\t1\nÖSSZESEN\t4\n",
    );
  });
});
