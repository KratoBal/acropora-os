import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  externalCustomerName,
  externalWhere,
  listWhere,
  mergeListRows,
  ownWhere,
  externalPaymentFields,
  simplePayOrderKey,
  toExternalListItem,
  toListItem,
  type ExternalListRow,
  type OwnPaymentMark,
  type SimplePaySettlementLine,
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
  source: "SZAMLAZZ",
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
  lastPaymentDate: null,
  // a migráció óta nem vetített sor (murena review-ja): ismeretlen
  paymentsKnown: null,
  paymentMethod: "Átutalás",
  // a régi sor: a vetítés még nem olvasta ki (újravetítésig null)
  paymentMethodUnified: null,
  orderNumber: null,
  customerTaxNumber: "12345678-2-42",
  cancelled: false,
  payments: [],
  ...overrides,
});

describe("the payment of an external document (Balázs, GLS, 2026-10-01)", () => {
  // MI PIROSÍT: ha a mezők nem a közös számításból jönnének (a bejövő listával
  // eltérne); ha a kimenő számla elem nélkül "nincs adat" lenne, holott van
  // feed-változata (acrobot 25910); ha egy
  // sztornózott számla fizetendőnek látszana; ha a saját bizonylat állapotot kapna.
  const fields = (
    overrides: Partial<ExternalListRow> = {},
    simplePay: SimplePaySettlementLine[] = [],
  ) =>
    externalPaymentFields(
      external({
        grossAmount: D("105831"),
        paidAmount: D("105830"),
        lastPaymentDate: new Date("2026-09-17T00:00:00.000Z"),
        paymentsKnown: true,
        ...overrides,
      }),
      simplePay,
    );

  it("paid with the 5 Ft cash rounding, in the shared computation, with its day", () => {
    assert.deepEqual(fields(), {
      paymentState: "PAID",
      paidAmount: "105830",
      lastPaymentDate: "2026-09-17",
      paymentSource: "SZAMLAZZ",
    });
    assert.equal(fields({ paidAmount: D("50000") }).paymentState, "PARTIAL");
  });

  it("a row not yet re-projected is unknown; the same row projected without payment elements is unpaid (acrobot 25918)", () => {
    // A KONTROLL: a migráció null-t hagy; az újravetítésig a kifizetett számla
    // sem látszhat „Nincs fizetve”-nek (murena review-ja)
    const migrated = { paidAmount: D("0"), lastPaymentDate: null };
    assert.equal(
      fields({ ...migrated, paymentsKnown: null }).paymentState,
      "UNKNOWN",
    );
    // a kimenőn a hiány "nem fizetett": a sornak van feed-változata (927341621)
    assert.equal(
      fields({ ...migrated, paymentsKnown: false }).paymentState,
      "UNPAID",
    );
  });

  it("without payment elements: a later payment unpaid, a card or cash paid at ordering, with its source (acrobot 25938)", () => {
    // A KONTROLL: élesen 18 kártyás webshop-számla mutatott „Nincs fizetve”-t
    const without = (paymentMethod: string | null) =>
      fields({
        paymentsKnown: false,
        paidAmount: D("0"),
        lastPaymentDate: null,
        paymentMethod,
      });
    assert.deepEqual(without("Bankkártya"), {
      paymentState: "PAID",
      paidAmount: "105831",
      // a kelt nem a fizetés napja: dátum nincs (acrobot 25950)
      lastPaymentDate: null,
      paymentSource: "CARD_AT_ORDER",
    });
    assert.deepEqual(
      [without("Készpénz").paymentState, without("Készpénz").paymentSource],
      ["PAID", "CASH_AT_ORDER"],
    );
    assert.deepEqual(
      ["Átutalás", "Utánvét", "", null].map((m) => [
        without(m).paymentState,
        without(m).paymentSource,
      ]),
      Array(4).fill(["UNPAID", "SZAMLAZZ"]),
    );
    assert.deepEqual(
      [without("Csekk").paymentState, without("Csekk").paymentSource],
      ["UNKNOWN", null],
    );
    // a kártya-szó mellett is utánvét: nem fizetett (murena 25948)
    assert.deepEqual(
      ["Bankkártyás utánvét", "Készpénzes utánvét", "Online átutalás"].map(
        (m) => without(m).paymentState,
      ),
      ["UNPAID", "UNPAID", "UNPAID"],
    );
    // ha a Számlázz.hu rögzítette, a kártyás is onnan számolt
    assert.deepEqual(
      [
        fields({ paymentsKnown: true, paymentMethod: "Bankkártya" })
          .paymentState,
        fields({ paymentsKnown: true, paymentMethod: "Bankkártya" })
          .paymentSource,
      ],
      ["PAID", "SZAMLAZZ"],
    );
  });

  /*
    A ZÁRT `fizmodunified` DÖNT ELŐBB (acrobot 25964), a szabad szöveg csak
    tartalék. MI PIROSÍT: ha a szabad szöveg felülírná a felsorolást; ha az
    „egyéb” UNKNOWN lenne (acrobot 25967: élesen a 27 üres fizmodú
    webshop-számla mind „egyéb”, és utánvétesek, tehát „Nincs fizetve” kell);
    ha egy utalvány-féle érték fizetettnek látszana.
  */
  it("the unified payment method decides first; 'egyéb' hands over to the free text", () => {
    const without = (
      paymentMethodUnified: string | null,
      paymentMethod: string | null,
    ) => {
      const f = fields({
        paymentsKnown: false,
        paidAmount: D("0"),
        lastPaymentDate: null,
        paymentMethod,
        paymentMethodUnified,
      });
      return [f.paymentState, f.paymentSource];
    };
    assert.deepEqual(
      [
        // a felsorolás nyer a szabad szöveg ellen, mindkét irányban
        without("átutalás", "Bankkártya"),
        without("bankkártya", ""),
        without("OTP Simple", null),
        without("készpénz", null),
        without("kupon", "Bankkártya"),
        // az „egyéb” nem dönt: a szabad szöveg igen, az üres szöveg UNPAID
        without("egyéb", ""),
        without("egyéb", null),
        without("egyéb", "Bankkártya"),
        // ismeretlen érték és a még nem kiolvasott (null): a szabad szöveg
        without("valami új", "Bankkártya"),
        without(null, "Bankkártya"),
      ],
      [
        ["UNPAID", "SZAMLAZZ"],
        ["PAID", "CARD_AT_ORDER"],
        ["PAID", "CARD_AT_ORDER"],
        ["PAID", "CASH_AT_ORDER"],
        ["UNKNOWN", null],
        ["UNPAID", "SZAMLAZZ"],
        ["UNPAID", "SZAMLAZZ"],
        ["PAID", "CARD_AT_ORDER"],
        ["PAID", "CARD_AT_ORDER"],
        ["PAID", "CARD_AT_ORDER"],
      ],
    );
  });

  /*
    A KÁRTYÁS SZÁMLA KIFIZETÉSE A SIMPLEPAY-SORBÓL (acrobot 25964, 25979; élesen
    COMPLETED 53, REFUND 3). MI PIROSÍT: ha a csak-COMPLETED sor nem adna dátumot
    és SimplePay-forrást; ha a részleges visszatérítés nem csökkentené az összeget;
    ha a teljes visszatérítés „Fizetve” maradna; ha egy ismeretlen státusz
    fizetésnek számítana; ha a REFUND előjele (amit nem ismerünk) elrontaná.
  */
  it("a card invoice's payment from the SimplePay lines: completed, partly refunded, fully refunded", () => {
    const line = (
      transactionStatus: string,
      amount: string,
      day: string,
    ): SimplePaySettlementLine => ({
      transactionStatus,
      amount: D(amount),
      transactionDate: new Date(`${day}T00:00:00.000Z`),
    });
    const card = (lines: SimplePaySettlementLine[]) =>
      fields(
        {
          paymentsKnown: false,
          paidAmount: D("0"),
          lastPaymentDate: null,
          paymentMethod: "Bankkártya",
          grossAmount: D("29210"),
        },
        lines,
      );
    assert.deepEqual(card([line("COMPLETED", "29210", "2026-09-28")]), {
      paymentState: "PAID",
      paidAmount: "29210",
      lastPaymentDate: "2026-09-28",
      paymentSource: "SIMPLEPAY",
    });
    // a REFUND előjele ismeretlen: mindkét alakra ugyanaz
    for (const refund of ["10000", "-10000"])
      assert.deepEqual(
        card([
          line("COMPLETED", "29210", "2026-09-28"),
          line("REFUND", refund, "2026-09-30"),
        ]),
        {
          paymentState: "PARTIAL",
          paidAmount: "19210",
          lastPaymentDate: "2026-09-28",
          paymentSource: "SIMPLEPAY_REFUNDED",
        },
      );
    assert.deepEqual(
      card([
        line("COMPLETED", "29210", "2026-09-28"),
        line("REFUND", "29210", "2026-09-30"),
      ]),
      {
        paymentState: "UNPAID",
        paidAmount: "0",
        lastPaymentDate: "2026-09-28",
        paymentSource: "SIMPLEPAY_REFUNDED",
      },
    );
    // A KONTROLL: ismeretlen státusz nem fizetés; COMPLETED nélkül a kártyás
    // feltevés marad (dátum nélkül)
    assert.deepEqual(card([line("PENDING", "29210", "2026-09-28")]), {
      paymentState: "PAID",
      paidAmount: "29210",
      lastPaymentDate: null,
      paymentSource: "CARD_AT_ORDER",
    });
  });

  it("the SimplePay lines never override what Számlázz.hu recorded, nor a later-payment method", () => {
    const lines: SimplePaySettlementLine[] = [
      {
        transactionStatus: "COMPLETED",
        amount: D("29210"),
        transactionDate: new Date("2026-09-28T00:00:00.000Z"),
      },
    ];
    assert.deepEqual(
      [
        fields({ paymentsKnown: true, paymentMethod: "Bankkártya" }, lines)
          .paymentSource,
        fields(
          {
            paymentsKnown: false,
            paidAmount: D("0"),
            paymentMethod: "Átutalás",
          },
          lines,
        ).paymentState,
      ],
      ["SZAMLAZZ", "UNPAID"],
    );
  });

  it("finds the SimplePay key only in our shop's order number", () => {
    assert.deepEqual(
      [
        "47679-665706",
        "47679-66570",
        "47679-6657060",
        "12345-665706",
        "UNAS-47679-665706",
        null,
      ].map((n) => simplePayOrderKey(n, "UNAS-47679-")),
      ["665706", null, null, null, null, null],
    );
  });

  it("nothing on a cancelled invoice or our own", () => {
    assert.deepEqual(fields({ cancelled: true }), {
      paymentState: null,
      paidAmount: null,
      lastPaymentDate: null,
      paymentSource: null,
    });
    assert.equal(toListItem(row()).paymentState, null);
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
      externalSource: "SZAMLAZZ",
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
      paymentState: "UNKNOWN",
      paidAmount: "0",
      lastPaymentDate: null,
      paymentSource: null,
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

/*
  A SAJÁT, A SZÁMLÁZZ.HU-BA BEÍRT JELÖLÉS A KIMENŐ NÉZETEN (acrobot 26027:
  Balázs a három beírt GLS-fizetést nem látta, mert a feed nem küldte újra a
  számlát). MI PIROSÍT: ha a jelölés nem tenné „Fizetve”-vé a feed szerint
  fizetetlen vagy ismeretlen számlát; ha a feed szerinti „Fizetve” helyett a
  jelölés lenne a forrás; ha a feed által MÁR hozott jelölés kétszer számítana;
  ha a forrás nem a jelölésé, vagy a dátum nem a jelölés napja; ha a sztornózott
  számla állapotot kapna.
*/
describe("an own paid mark on the outgoing view (acrobot 26027)", () => {
  const gls: OwnPaymentMark = {
    source: "GLS_COD",
    markDate: new Date("2026-09-17T00:00:00.000Z"),
    amount: D("29210"),
  };
  const pay = (overrides: Partial<ExternalListRow>, marks = [gls]) =>
    externalPaymentFields(external(overrides), [], marks);

  it("unpaid by the feed (projected, no element, transfer): paid, from the mark, on its day", () => {
    assert.deepEqual(pay({ paymentsKnown: false }), {
      paymentState: "PAID",
      paidAmount: "29210",
      lastPaymentDate: "2026-09-17",
      paymentSource: "MARK_GLS_COD",
    });
  });

  it("not yet projected (unknown): the mark still proves it paid", () => {
    assert.equal(pay({ paymentsKnown: null }).paymentSource, "MARK_GLS_COD");
  });

  it("a card invoice with no feed payment: the mark wins over the at-order assumption", () => {
    assert.deepEqual(
      pay(
        {
          paymentsKnown: false,
          paymentMethodUnified: "bankkártya",
        },
        [{ ...gls, source: "SIMPLEPAY" }],
      ).paymentSource,
      "MARK_SIMPLEPAY",
    );
  });

  /*
    A FEED IS FIZETETTET MOND, ÉS VAN BEÍRT JELÖLÉSÜNK (Balázs, 2026-10-02 11:14
    UTC; acrobot 26095: élesen mind a 25 beírt számlát visszaküldte a feed).
    MI PIROSÍT: ha a forrás „SZAMLAZZ” maradna (a GLS / Foxpost felirat
    eltűnik); ha az összeg vagy a dátum nem a feedé lenne.
  */
  it("paid by the feed and marked by us: the feed's sum and day, our mark's source", () => {
    assert.deepEqual(
      pay({
        paymentsKnown: true,
        paidAmount: D("29210"),
        lastPaymentDate: new Date("2026-09-20T00:00:00.000Z"),
        paymentMethodUnified: "egyéb",
      }),
      {
        paymentState: "PAID",
        paidAmount: "29210",
        lastPaymentDate: "2026-09-20",
        paymentSource: "MARK_GLS_COD",
      },
    );
  });

  it("paid by the feed, two marks: the latest mark names the source", () => {
    assert.equal(
      pay(
        {
          paymentsKnown: true,
          paidAmount: D("29210"),
          lastPaymentDate: new Date("2026-09-20T00:00:00.000Z"),
        },
        [
          gls,
          {
            source: "FOXPOST",
            markDate: new Date("2026-09-19T00:00:00.000Z"),
            amount: D("29210"),
          },
        ],
      ).paymentSource,
      "MARK_FOXPOST",
    );
  });

  it("paid by the feed, no mark of ours: the feed is the source", () => {
    assert.equal(
      pay(
        {
          paymentsKnown: true,
          paidAmount: D("29210"),
          lastPaymentDate: new Date("2026-09-20T00:00:00.000Z"),
        },
        [],
      ).paymentSource,
      "SZAMLAZZ",
    );
  });

  it("the feed already carries the mark (same day and sum): counted once, the feed is the source", () => {
    const fields = pay(
      {
        paymentsKnown: true,
        paidAmount: D("10000"),
        lastPaymentDate: new Date("2026-09-17T00:00:00.000Z"),
        payments: [
          {
            date: "2026-09-17",
            title: "utánvét",
            amount: "10000.00",
            note: null,
            bankTransactionId: null,
          },
        ],
      },
      [{ ...gls, amount: D("10000") }],
    );
    assert.equal(fields.paymentState, "PARTIAL");
    assert.equal(fields.paidAmount, "10000");
    assert.equal(fields.paymentSource, "SZAMLAZZ");
  });

  it("a partial feed payment plus a new mark: added up, the latest mark is the source", () => {
    const fields = pay(
      {
        paymentsKnown: true,
        paidAmount: D("10000"),
        lastPaymentDate: new Date("2026-09-10T00:00:00.000Z"),
        payments: [
          {
            date: "2026-09-10",
            title: "átutalás",
            amount: "10000.00",
            note: null,
            bankTransactionId: null,
          },
        ],
      },
      [{ ...gls, amount: D("19210") }],
    );
    assert.deepEqual(fields, {
      paymentState: "PAID",
      paidAmount: "29210",
      lastPaymentDate: "2026-09-17",
      paymentSource: "MARK_GLS_COD",
    });
  });

  it("a cancelled invoice: no state, mark or not", () => {
    assert.equal(pay({ cancelled: true }).paymentState, null);
  });

  it("no mark: unchanged (the transfer invoice stays unpaid)", () => {
    assert.equal(pay({ paymentsKnown: false }, []).paymentState, "UNPAID");
  });
});

/*
  A MAGÁNSZEMÉLYES SZÁMLA VEVŐNEVE A WEBSHOP-RENDELÉSBŐL (Balázs, 2026-10-02
  11:16 UTC; acrobot 26096, élesen 40/46). MI PIROSÍT: ha a takart név
  maradna, holott a rendelés ismeri a vevőt; ha egy CÉG (adószámos) számlája
  kapná a rendelés nevét; ha rendelés nélkül vagy üres rendelés-névvel a takart
  név helyett üres szöveg állna; ha a jelző hiányozna.
*/
describe("the buyer's name from the webshop order (acrobot 26096)", () => {
  const privateRow = {
    customerName: "Magánszemély (NAV)",
    customerTaxNumber: null,
  };

  it("a private invoice with a named order: the order's name, marked", () => {
    assert.deepEqual(externalCustomerName(privateRow, "Kiss Anna"), {
      customerName: "Kiss Anna",
      customerNameFromOrder: true,
    });
    const item = toExternalListItem(
      external({ ...privateRow, orderNumber: "47679-558779" }),
      [],
      [],
      "Kiss Anna",
    );
    assert.equal(item.customerName, "Kiss Anna");
    assert.equal(item.customerNameFromOrder, true);
  });

  it("a company invoice keeps its own name; no order or an empty name keeps the invoice's", () => {
    assert.deepEqual(
      externalCustomerName(
        { customerName: "Teszt Kft.", customerTaxNumber: "12345678-2-42" },
        "Kiss Anna",
      ),
      { customerName: "Teszt Kft." },
    );
    assert.deepEqual(externalCustomerName(privateRow, null), {
      customerName: "Magánszemély (NAV)",
    });
    assert.deepEqual(externalCustomerName(privateRow, "  "), {
      customerName: "Magánszemély (NAV)",
    });
  });
});
