import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  externalWhere,
  listWhere,
  mergeListRows,
  ownWhere,
  externalPayment,
  toExternalListItem,
  toListItem,
  type ExternalListRow,
  type MergeRow,
} from "./billing-document-list.js";
import type { BillingDocumentListRow } from "./billing-document-list.repository.js";

const D = (value: string) => new Prisma.Decimal(value);

const line = (unitNet: string, quantity = "1", vatRatePercent = "27") => ({
  kind: "ITEM" as const,
  quantity: D(quantity),
  unitNet: D(unitNet),
  netAmount: D(unitNet).mul(quantity),
  vatRatePercent: D(vatRatePercent),
});

function row(
  overrides: Partial<BillingDocumentListRow> = {},
): BillingDocumentListRow {
  return {
    id: "doc-1",
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    invoiceNumber: null,
    partnerName: "Régi Név Kft.",
    issueDate: null,
    dueDate: new Date("2026-10-08T00:00:00.000Z"),
    grossAmount: D("2985.0017"),
    currency: "HUF",
    status: "DRAFT",
    emailStatus: "PENDING",
    customer: { companyName: "Új Név Kft.", displayName: "Új Név" },
    lines: [line("1566.93", "1.5")],
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  } as BillingDocumentListRow;
}

describe("toListItem", () => {
  it("shows a draft's gross as the invoice will print it, not its stored total", () => {
    // Three lines of 0.40 net at 27%: each line's gross (0.51) rounds to 1 Ft
    // on Számlázz.hu, so the invoice says 3. The stored 4-decimal total is
    // 1.524, which would round to 2: the rival rule this pins out.
    const item = toListItem(
      row({
        grossAmount: D("1.5240"),
        lines: [line("0.40"), line("0.40"), line("0.40")],
      }),
    );
    assert.equal(item.grossAmount, "3");
  });

  it("shows an issued document's stored Számlázz.hu total in whole forints", () => {
    const item = toListItem(
      row({
        status: "ISSUED",
        invoiceNumber: "E-ACR-2026-1",
        grossAmount: D("2985.0000"),
        lines: [line("9999")],
      }),
    );
    assert.equal(item.grossAmount, "2985");
  });

  it("keeps two decimals outside HUF", () => {
    const item = toListItem(
      row({ currency: "EUR", grossAmount: D("12.3456"), lines: [line("10")] }),
    );
    assert.equal(item.grossAmount, "12.70");
  });

  it("names the buyer from the issue snapshot once issued, and today's partner before", () => {
    assert.equal(toListItem(row()).customerName, "Új Név Kft.");
    assert.equal(
      toListItem(row({ status: "ISSUED" })).customerName,
      "Régi Név Kft.",
    );
  });

  it("dates the issue by the Budapest calendar day, not the UTC one", () => {
    // 22:30 UTC on 30 September is 00:30 on 1 October in Budapest (CEST).
    const item = toListItem(
      row({
        status: "ISSUED",
        issueDate: new Date("2026-09-30T22:30:00.000Z"),
      }),
    );
    assert.equal(item.issueDate, "2026-10-01");
    assert.equal(item.dueDate, "2026-10-08");
  });

  it("opens only a draft in the editor", () => {
    assert.deepEqual(
      (["DRAFT", "ISSUING", "ISSUED", "ISSUE_FAILED"] as const).map(
        (status) => toListItem(row({ status })).opens,
      ),
      ["EDITOR", "DETAIL", "DETAIL", "DETAIL"],
    );
  });
});

describe("listWhere", () => {
  it("always keeps the detail's own-rows scope, with or without filters", () => {
    for (const where of [
      listWhere({}),
      listWhere({ q: "x", status: "ISSUED", documentType: "PROFORMA" }),
    ]) {
      assert.equal(where.direction, "OUTBOUND");
      assert.equal(where.source, "SZAMLAZZ");
      assert.deepEqual(where.sourceType, { not: null });
      assert.equal(where.completionCertificateId, null);
    }
  });

  it("matches the stored buyer name only on issued rows", () => {
    // A draft's partnerName is the name at its last save, which the list no
    // longer shows; searching it would bring up a draft under a stale name.
    const clauses = listWhere({ q: "Régi" }).OR ?? [];
    const onName = clauses.filter((clause) => "partnerName" in clause);
    assert.deepEqual(
      onName.map((clause) => clause.status),
      ["ISSUED"],
    );
  });

  it("searches nothing for a blank q", () => {
    assert.equal(listWhere({ q: "   " }).OR, undefined);
  });
});

/*
  A KÜLSŐ BIZONYLATOK A LISTÁN (acrobot 25812): a Számlázz.hu-ból kapott kimenő
  számlák a mieink mellett, „Külső” jelöléssel, csak olvasható adatlappal.
*/
const external = (
  overrides: Partial<ExternalListRow> = {},
): ExternalListRow => ({
  id: "ext-1",
  kindCode: "SZ",
  documentNumber: "ACRW-2026/00508",
  electronic: false,
  customerName: "Teszt Akvárium Bt.",
  issueDate: new Date("2026-09-30T00:00:00.000Z"),
  dueDate: new Date("2026-10-08T00:00:00.000Z"),
  grossAmount: D("29210"),
  currency: "HUF",
  createdAt: new Date("2026-10-01T15:00:00.000Z"),
  paidAmount: D("0"),
  lastPaidAt: null,
  cancelled: false,
  ...overrides,
});

describe("the payment of an external document (Balázs, GLS, 2026-10-01)", () => {
  // MI PIROSÍT: ha az 5 forintos kerekítés miatt egy kifizetett számla
  // rész-kifizetettnek látszana; ha egy rész-kifizetés kifizetettnek; ha a
  // devizás számla is kapná a forint-tűrést; ha egy sztornózott vagy sztornó
  // számla fizetendőnek látszana; ha a saját bizonylat kitalált állapotot kapna.
  const paid = (amount: string, overrides: Partial<ExternalListRow> = {}) =>
    externalPayment(
      external({
        grossAmount: D("105831"),
        paidAmount: D(amount),
        lastPaidAt: new Date("2026-09-17T00:00:00.000Z"),
        ...overrides,
      }),
    );

  it("paid, also when the cash on delivery was rounded to 5 Ft; partial; unpaid", () => {
    assert.deepEqual(paid("105831"), {
      state: "PAID",
      paidAmount: "105831",
      lastPaidAt: "2026-09-17",
    });
    // a GLS 09-17-i sora: 105 830 a 105 831-es számlára (barracuda, 25888)
    assert.equal(paid("105830")?.state, "PAID");
    assert.equal(paid("105828")?.state, "PARTIAL");
    assert.equal(paid("50000")?.state, "PARTIAL");
    assert.deepEqual(paid("0", { lastPaidAt: null }), {
      state: "UNPAID",
      paidAmount: "0",
      lastPaidAt: null,
    });
  });

  it("no forint tolerance on a foreign currency, and nothing to pay on a storno", () => {
    assert.equal(
      paid("99.99", { grossAmount: D("100"), currency: "EUR" })?.state,
      "PARTIAL",
    );
    assert.equal(paid("0", { cancelled: true }), null);
    assert.equal(paid("0", { grossAmount: D("-15450") }), null);
    assert.equal(toListItem(row()).payment, null);
  });
});

describe("the external documents on the list", () => {
  // MI PIROSÍT: ha a külső sor szerkeszthetőnek nyílna, vagy a mieink közé
  // olvadna jelölés nélkül; ha a Számlázz.hu típus-felirata elveszne.
  it("an external row opens read-only, marked external, with Számlázz.hu's kind label", () => {
    assert.deepEqual(toExternalListItem(external()), {
      id: "ext-1",
      documentType: "INVOICE",
      invoiceFormat: "PAPER",
      documentNumber: "ACRW-2026/00508",
      customerName: "Teszt Akvárium Bt.",
      issueDate: "2026-09-30",
      dueDate: "2026-10-08",
      grossAmount: "29210",
      currency: "HUF",
      status: "ISSUED",
      emailStatus: null,
      opens: "EXTERNAL_DETAIL",
      origin: "EXTERNAL",
      externalKindLabel: "Számla",
      payment: { state: "UNPAID", paidAmount: "0", lastPaidAt: null },
    });
    assert.deepEqual(
      [
        toExternalListItem(external({ kindCode: "D" })).documentType,
        toExternalListItem(external({ kindCode: "XY" })).externalKindLabel,
      ],
      ["PROFORMA", "XY"],
    );
    // A KONTROLL: a mieink sora továbbra is a saját útján nyílik.
    assert.deepEqual(
      [toListItem(row()).origin, toListItem(row()).opens],
      ["OWN", "EDITOR"],
    );
  });

  /**
   * A SZŰRŐ: a külső mindig kiállított és e-mail állapot nélküli, tehát egy
   * vázlatra vagy e-mail állapotra szűrt listán nincs külső. MI PIROSÍT: ha egy
   * „csak a mieink” lista külsőt hozna, vagy egy „csak a külsők” a mieinket.
   */
  it("the source filter: only ours, only the external ones, or both", () => {
    assert.equal(externalWhere({ origin: "OWN" }), null);
    assert.equal(ownWhere({ origin: "EXTERNAL" }), null);
    assert.notEqual(externalWhere({}), null);
    assert.notEqual(ownWhere({}), null);
    assert.equal(externalWhere({ status: "DRAFT" }), null);
    assert.equal(externalWhere({ emailStatus: "SENT" }), null);
    assert.deepEqual(externalWhere({ status: "ISSUED" }), {});
    assert.deepEqual(externalWhere({ documentType: "PROFORMA" }), {
      kindCode: { in: ["D"] },
    });
    // a számla-fajta az ismeretlen kódot is hozza
    assert.deepEqual(externalWhere({ documentType: "INVOICE" }), {
      kindCode: { notIn: ["ES", "D", "SL"] },
    });
    assert.deepEqual(externalWhere({ invoiceFormat: "ELECTRONIC" }), {
      electronic: true,
    });
  });

  /**
   * A KÉT FORRÁS EGY LAPON: a kiállítás napja szerint, a vázlat felül, és a lap
   * pontosan az összefésült sor szelete. MI PIROSÍT: ha a második lap átfedne az
   * elsővel, vagy kihagyna egy sort; ha a vázlat a kiállítottak alá kerülne.
   */
  it("merges the two sources into one order, and pages through it without gaps", () => {
    const item = (id: string) => ({ ...toListItem(row()), id });
    const at = (iso: string | null, id: string): MergeRow => ({
      issueDate: iso ? new Date(iso) : null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      id,
      item: item(id),
    });
    const own = [
      at(null, "draft"),
      at("2026-09-30T08:00:00.000Z", "own-30"),
      at("2026-09-28T08:00:00.000Z", "own-28"),
    ];
    const ext = [
      at("2026-10-01T00:00:00.000Z", "ext-01"),
      at("2026-09-29T00:00:00.000Z", "ext-29"),
    ];
    const ids = (offset: number, limit: number) =>
      mergeListRows(own, ext, offset, limit).map((i) => i.id);
    assert.deepEqual(ids(0, 5), [
      "draft",
      "ext-01",
      "own-30",
      "ext-29",
      "own-28",
    ]);
    assert.deepEqual(
      [ids(0, 2), ids(2, 2), ids(4, 2)],
      [["draft", "ext-01"], ["own-30", "ext-29"], ["own-28"]],
    );
  });
});
