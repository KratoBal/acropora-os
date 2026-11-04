import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  externalCustomerName,
  externalWhere,
  listWhere,
  matchesPaymentFilter,
  ownIssueRange,
  PAYMENT_FILTER_ROW_LIMIT,
  mergeListRows,
  ownWhere,
  externalPaymentFields,
  simplePayOrderKey,
  toExternalListItem,
  toListItem,
  withoutOwnTwins,
  withTwinPayment,
  type ExternalListRow,
  type OwnPaymentMark,
  type SimplePaySettlementLine,
  type MergeRow,
} from "./billing-document-list.js";
import {
  BillingDocumentListRepository,
  orderNumbersByBuyerName,
  paymentMethodChoices,
  type BillingDocumentListRow,
} from "./billing-document-list.repository.js";

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
    netAmount: D("2350.0000"),
    vatAmount: D("635.0000"),
    paymentMethod: "Átutalás",
    currency: "HUF",
    status: "DRAFT",
    emailStatus: "PENDING",
    customer: { companyName: "Új Név Kft.", displayName: "Új Név" },
    lines: [line("1566.93", "1.5")],
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    pdfStorageKey: null,
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

/*
  A NETTÓ, AZ ÁFA ÉS A FIZETÉSI MÓD A KIMENŐ LISTÁN, ÉS A DÁTUM- ÉS FIZETÉSIMÓD-SZŰRŐ (Luca, 2026-11-04; kártya
  6110d89b). MI PIROSÍT: ha a három összeg nem adja ki a bruttót; ha a vázlat nettója más szabállyal készül, mint a
  bruttója; ha a kelt szűrő a budapesti napot UTC-nek veszi (az éjfél körüli számla rossz napra esik); ha a saját és a
  külső sor másképp szűrődik; ha a fizetési mód kis- és nagybetűre érzékeny; ha a választék kétszer sorolja ugyanazt.
*/
describe("the net, VAT and payment method on the list", () => {
  it("an issued own row carries the stored net and VAT in whole forints, and its payment method", () => {
    const item = toListItem(
      row({
        status: "ISSUED",
        invoiceNumber: "E-1",
        grossAmount: D("2985.0000"),
        netAmount: D("2350.0000"),
        vatAmount: D("635.0000"),
        paymentMethod: " Készpénz ",
      }),
    );
    assert.deepEqual(
      [item.netAmount, item.vatAmount, item.grossAmount, item.paymentMethod],
      ["2350", "635", "2985", "Készpénz"],
    );
    assert.equal(
      Number(item.netAmount) + Number(item.vatAmount),
      Number(item.grossAmount),
    );
  });

  it("a draft's net and VAT come from the lines by the rule of its gross, so the three agree", () => {
    // three 0.40 net lines at 27%: the lines' grosses round to 1 each, the gross is 3 (see the gross test above)
    const item = toListItem(
      row({
        grossAmount: D("1.5240"),
        lines: [line("0.40"), line("0.40"), line("0.40")],
      }),
    );
    assert.equal(item.grossAmount, "3");
    assert.equal(Number(item.netAmount) + Number(item.vatAmount), 3);
  });

  it("an unset stored net or VAT, a draft with no lines, and a blank payment method are null, not zero", () => {
    const issued = toListItem(
      row({
        status: "ISSUED",
        netAmount: null,
        vatAmount: null,
        paymentMethod: "  ",
      }),
    );
    assert.deepEqual(
      [issued.netAmount, issued.vatAmount, issued.paymentMethod],
      [null, null, null],
    );
    assert.equal(toListItem(row({ lines: [] })).netAmount, null);
  });

  it("an external row carries its net, VAT and payment method, two decimals outside HUF", () => {
    const item = toExternalListItem(external({ paymentMethod: "Bankkártya" }));
    assert.deepEqual(
      [item.netAmount, item.vatAmount, item.grossAmount, item.paymentMethod],
      ["23000", "6210", "29210", "Bankkártya"],
    );
    const eur = toExternalListItem(
      external({
        currency: "EUR",
        netAmount: D("10"),
        vatAmount: D("2.7"),
        grossAmount: D("12.7"),
      }),
    );
    assert.deepEqual([eur.netAmount, eur.vatAmount], ["10.00", "2.70"]);
    assert.equal(
      toExternalListItem(external({ paymentMethod: null })).paymentMethod,
      null,
    );
  });
});

describe("the date and payment method filters of the outgoing list", () => {
  it("no date, no range", () => {
    assert.equal(ownIssueRange({}), null);
    assert.equal(listWhere({}).issueDate, undefined);
    assert.equal(externalWhere({})?.issueDate, undefined);
  });

  it("an own row's range is the Budapest days: from the start of its first day to the start of the day after its last", () => {
    // summer (CEST, +2): 1 October 00:00 Budapest is 30 September 22:00 UTC
    const summer = ownIssueRange({ from: "2026-10-01", to: "2026-10-31" });
    assert.deepEqual(summer, {
      gte: new Date("2026-09-30T22:00:00.000Z"),
      // 1 November 00:00 Budapest: the clocks went back on 25 October, so CET (+1)
      lt: new Date("2026-10-31T23:00:00.000Z"),
    });
    // winter (CET, +1)
    assert.deepEqual(ownIssueRange({ from: "2026-01-15" }), {
      gte: new Date("2026-01-14T23:00:00.000Z"),
    });
    assert.deepEqual(ownIssueRange({ to: "2026-01-15" }), {
      lt: new Date("2026-01-15T23:00:00.000Z"),
    });
  });

  it("an invoice issued 00:30 Budapest time on the 1st is in October, not September (the UTC trap)", () => {
    const range = ownIssueRange({ from: "2026-10-01", to: "2026-10-01" })!;
    const issuedAt = new Date("2026-09-30T22:30:00.000Z"); // 2026-10-01 00:30 CEST
    assert.ok(issuedAt >= (range.gte as Date) && issuedAt < (range.lt as Date));
    const september = ownIssueRange({ from: "2026-09-01", to: "2026-09-30" })!;
    assert.ok(!(issuedAt < (september.lt as Date)));
  });

  it("an external row's range is the stored calendar days, both ends in", () => {
    assert.deepEqual(
      externalWhere({ from: "2026-10-01", to: "2026-10-31" })?.issueDate,
      {
        gte: new Date("2026-10-01T00:00:00.000Z"),
        lte: new Date("2026-10-31T00:00:00.000Z"),
      },
    );
  });

  it("the payment method matches the text exactly but not by case, on both sources, and a blank one filters nothing", () => {
    const insensitive = { equals: "Átutalás", mode: "insensitive" };
    assert.deepEqual(
      listWhere({ paymentMethod: " Átutalás " }).paymentMethod,
      insensitive,
    );
    assert.deepEqual(
      externalWhere({ paymentMethod: "Átutalás" })?.paymentMethod,
      insensitive,
    );
    assert.equal(listWhere({ paymentMethod: "  " }).paymentMethod, undefined);
    assert.equal(
      externalWhere({ paymentMethod: "" })?.paymentMethod,
      undefined,
    );
  });

  it("the filters respect the source filter: a source the query excludes has no where at all", () => {
    assert.equal(ownWhere({ origin: "EXTERNAL", from: "2026-10-01" }), null);
    assert.equal(
      externalWhere({ origin: "OWN", paymentMethod: "Átutalás" }),
      null,
    );
  });

  it("the choices list each payment method once, whatever its case, in alphabetical order, without blanks", () => {
    assert.deepEqual(
      paymentMethodChoices([
        "Átutalás",
        "átutalás",
        null,
        " ",
        "Készpénz",
        "Bankkártya",
        "Átutalás ",
      ]),
      ["Átutalás", "Bankkártya", "Készpénz"],
    );
    assert.deepEqual(paymentMethodChoices([]), []);
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
  netAmount: D("23000"),
  vatAmount: D("6210"),
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
  pdfStorageKey: null,
  pdfMissingReason: null,
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

  it("an eBIZ invoice follows eBIZ's own status only; NONE stays unknown (2026-10-02)", () => {
    const ebiz = (paymentsKnown: boolean | null, paid: string) =>
      fields({
        source: "EBIZ",
        paymentsKnown,
        paidAmount: D(paid),
        lastPaymentDate: null,
        // a card method must not make an eBIZ invoice "paid at ordering"
        paymentMethod: "Bankkártya",
      });
    assert.deepEqual(
      [ebiz(true, "105831").paymentState, ebiz(true, "105831").paymentSource],
      ["PAID", "EBIZ"],
    );
    assert.deepEqual(
      [ebiz(true, "0").paymentState, ebiz(true, "0").paymentSource],
      ["UNPAID", "EBIZ"],
    );
    assert.deepEqual(
      [ebiz(null, "0").paymentState, ebiz(null, "0").paymentSource],
      ["UNKNOWN", null],
    );
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
      netAmount: "23000",
      vatAmount: "6210",
      paymentMethod: "Átutalás",
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
      pdf: { available: false, missingReason: null },
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
    // a végszámla (VS) 2026-10-12 óta saját típus, nem számla
    assert.deepEqual(externalWhere({ documentType: "FINAL_INVOICE" }), {
      kindCode: { in: ["VS"] },
    });
    assert.deepEqual(externalWhere({ documentType: "INVOICE" }), {
      kindCode: { notIn: ["VS", "ES", "D", "SL"] },
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

  it("an eBIZ invoice ignores our marks: they are about Számlázz.hu invoices", () => {
    const ebiz = pay({ source: "EBIZ", paymentsKnown: null });
    assert.deepEqual(
      [ebiz.paymentState, ebiz.paymentSource],
      ["UNKNOWN", null],
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

/*
  A SAJÁT SZÁMLA ÉS A KÜLSŐ IKRE (hétfői lista N2, 2026-10-09 10:31). Az OS-ben
  kiállított számla a Számlázz.hu feedjében is visszajön. MI PIROSÍT: a külső
  iker külön sorként a listán marad; a szűrő a saját keresést vagy típust
  elnyeli; a saját sor elveszíti az iker kifizetési adatát; a darabszám a
  kihagyott ikret is számolja.
*/
/*
  A PDF MEGLÉTE A LISTÁN (Balázs, 2026-10-21: „látszódjon, hogy megvan a pdf”), ugyanaz, amit a havi
  könyvelői csomag lát (outgoing-package.service.ts).
*/
describe("the PDF state on the list (Balázs, 2026-10-21)", () => {
  // MI PIROSÍT: ha egy tárolt PDF nélküli sor „megvan”-t mutatna; ha a letöltés oka elveszne; ha egy
  // vázlat PDF-et várna; ha a saját sor az ikre PDF-jét kölcsönözné (a csomag nem teszi).
  it("an external row: stored, failed with its reason, or not tried yet", () => {
    assert.deepEqual(
      [
        toExternalListItem(
          external({ pdfStorageKey: "external-invoice/ext-1/szamlazz.pdf" }),
        ).pdf,
        toExternalListItem(
          external({ pdfMissingReason: "SZAMLAZZ_PDF_REJECTED_7" }),
        ).pdf,
        toExternalListItem(external()).pdf,
      ],
      [
        { available: true, missingReason: null },
        { available: false, missingReason: "SZAMLAZZ_PDF_REJECTED_7" },
        { available: false, missingReason: null },
      ],
    );
    // a régi ok egy azóta tárolt PDF mellett nem látszik: a PDF megvan
    assert.deepEqual(
      toExternalListItem(
        external({
          pdfStorageKey: "external-invoice/ext-1/szamlazz.pdf",
          pdfMissingReason: "SZAMLAZZ_PDF_HTTP_500",
        }),
      ).pdf,
      { available: true, missingReason: null },
    );
  });

  it("an own row: only an issued one has a PDF state, and a missing one says it was not stored", () => {
    const issued = {
      status: "ISSUED",
      invoiceNumber: "ACRW-2026/00508",
    } as const;
    assert.deepEqual(
      [
        toListItem(
          row({ ...issued, pdfStorageKey: "invoice/doc-1/szamla.pdf" }),
        ).pdf,
        toListItem(row({ ...issued })).pdf,
        toListItem(row()).pdf,
      ],
      [
        { available: true, missingReason: null },
        { available: false, missingReason: "OWN_PDF_NOT_STORED" },
        null,
      ],
    );
  });

  it("an own row keeps its own PDF state next to a twin that has one, as the package does", () => {
    const own = toListItem(
      row({ status: "ISSUED", invoiceNumber: "ACRW-2026/00508" }),
    );
    const merged = withTwinPayment(
      own,
      external({ pdfStorageKey: "external-invoice/ext-1/szamlazz.pdf" }),
    );
    assert.deepEqual(merged.pdf, {
      available: false,
      missingReason: "OWN_PDF_NOT_STORED",
    });
  });
});

describe("the own invoice and its Számlázz.hu twin (N2)", () => {
  it("the twin is left out by number, and the other filters stay", () => {
    assert.equal(withoutOwnTwins(null, ["A"]), null);
    assert.deepEqual(withoutOwnTwins({ electronic: true }, []), {
      electronic: true,
    });
    assert.deepEqual(withoutOwnTwins({ electronic: true }, ["A", "B"]), {
      AND: [{ electronic: true }, { documentNumber: { notIn: ["A", "B"] } }],
    });
  });

  it("the own row carries the twin's payment; without a twin it is unchanged", () => {
    const own = toListItem(
      row({
        status: "ISSUED",
        invoiceNumber: "ACRW-2026/00508",
        issueDate: new Date("2026-09-30T08:00:00.000Z"),
      }),
    );
    assert.equal(withTwinPayment(own, undefined), own);
    const paid = withTwinPayment(
      own,
      external({
        paymentsKnown: true,
        paidAmount: D("29210"),
        grossAmount: D("29210"),
        lastPaymentDate: new Date("2026-10-02T00:00:00.000Z"),
      }),
    );
    assert.deepEqual(
      [paid.origin, paid.id, paid.paymentState, paid.lastPaymentDate],
      ["OWN", "doc-1", "PAID", "2026-10-02"],
    );
  });

  it("the list shows one row per number, and the count agrees", async () => {
    const twin = external({
      id: "ext-twin",
      documentNumber: "ACRW-2026/00508",
      paymentsKnown: true,
      paidAmount: D("29210"),
      grossAmount: D("29210"),
    });
    const other = external({ id: "ext-other", documentNumber: "KULSO-1" });
    const externals = [twin, other];
    const matches = (
      where: Record<string, unknown>,
      r: ExternalListRow,
    ): boolean => {
      if (Array.isArray(where.AND))
        return (where.AND as Record<string, unknown>[]).every((w) =>
          matches(w, r),
        );
      const number = where.documentNumber as
        { notIn?: string[]; in?: string[] } | undefined;
      if (number?.notIn?.includes(r.documentNumber)) return false;
      if (number?.in && !number.in.includes(r.documentNumber)) return false;
      return true;
    };
    const ownRow = row({
      id: "own-1",
      status: "ISSUED",
      invoiceNumber: "ACRW-2026/00508",
      issueDate: new Date("2026-09-30T08:00:00.000Z"),
    });
    const repository = new BillingDocumentListRepository();
    (repository as unknown as { database: unknown }).database = {
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      invoice: {
        findMany: async (args: { select: Record<string, unknown> }) =>
          "lines" in args.select
            ? [ownRow]
            : [{ invoiceNumber: "ACRW-2026/00508" }],
        count: async () => 1,
      },
      externalBillingDocument: {
        findMany: async (args: { where: Record<string, unknown> }) =>
          externals.filter((r) => matches(args.where, r)),
        count: async (args: { where: Record<string, unknown> }) =>
          externals.filter((r) => matches(args.where, r)).length,
      },
      simplePayTransactionLine: { findMany: async () => [] },
      outgoingPaymentMark: { findMany: async () => [] },
      salesOrder: { findMany: async () => [] },
    };
    const list = await repository.list({ page: 1, pageSize: 25 });
    assert.deepEqual(
      list.items.map((i) => [i.origin, i.documentNumber, i.paymentState]),
      [
        ["OWN", "ACRW-2026/00508", "PAID"],
        ["EXTERNAL", "KULSO-1", "UNKNOWN"],
      ],
    );
    assert.equal(list.pagination.totalItems, 2);
  });
});

/*
  A FIZETÉS SZERINTI SZŰRŐ (Balázs, 2026-11-04: „Fizetve, Nincs fizetve szűrés”). MI PIROSÍT: ha a részben fizetett nem a
  „Nincs fizetve” alá esik; ha az ismeretlen vagy a forrás nélküli saját sor valamelyik szűrőbe kerül; ha a lap és a
  darabszám nem a SZŰRT halmazra vonatkozik (az első lap az összes sorból vágna, a darabszám a szűretlen volna); ha a
  szűrő nélküli lista változik; ha a határ fölött csonkít a hibaüzenet helyett.
*/
describe("the payment filter of the outgoing list", () => {
  const states = ["PAID", "UNPAID", "PARTIAL", "UNKNOWN", null] as const;

  it("PAID is only paid; UNPAID is unpaid and partly paid; unknown and no-source are in neither; no filter is everything", () => {
    const hits = (filter: "PAID" | "UNPAID" | undefined) =>
      states.filter((paymentState) =>
        matchesPaymentFilter({ paymentState }, filter),
      );
    assert.deepEqual(hits("PAID"), ["PAID"]);
    assert.deepEqual(hits("UNPAID"), ["UNPAID", "PARTIAL"]);
    assert.deepEqual(hits(undefined), [...states]);
  });

  const fakeRepository = (
    externals: ExternalListRow[],
    own: BillingDocumentListRow[],
  ) => {
    const repository = new BillingDocumentListRepository();
    (repository as unknown as { database: unknown }).database = {
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      invoice: {
        findMany: async (args: {
          select: Record<string, unknown>;
          take?: number;
        }) =>
          "lines" in args.select ? own.slice(0, args.take ?? own.length) : [],
        count: async () => own.length,
      },
      externalBillingDocument: {
        findMany: async (args: {
          take?: number;
          select: Record<string, unknown>;
        }) =>
          "documentNumber" in args.select
            ? externals.slice(0, args.take ?? externals.length)
            : [],
        count: async () => externals.length,
      },
      simplePayTransactionLine: { findMany: async () => [] },
      outgoingPaymentMark: { findMany: async () => [] },
      salesOrder: { findMany: async () => [] },
      $queryRaw: async () => [],
    };
    return repository;
  };
  // five external rows, newest first: paid, unpaid, partly paid, unknown, unpaid again
  const rows = [
    external({
      id: "e1",
      documentNumber: "E-1",
      issueDate: new Date("2026-10-05"),
      paymentsKnown: true,
      paidAmount: D("29210"),
    }),
    external({
      id: "e2",
      documentNumber: "E-2",
      issueDate: new Date("2026-10-04"),
      paymentsKnown: true,
      paidAmount: D("0"),
    }),
    external({
      id: "e3",
      documentNumber: "E-3",
      issueDate: new Date("2026-10-03"),
      paymentsKnown: true,
      paidAmount: D("10000"),
    }),
    external({
      id: "e4",
      documentNumber: "E-4",
      issueDate: new Date("2026-10-02"),
      paymentsKnown: null,
    }),
    external({
      id: "e5",
      documentNumber: "E-5",
      issueDate: new Date("2026-10-01"),
      paymentsKnown: true,
      paidAmount: D("0"),
    }),
  ];
  // an own invoice with no twin: no source of its payment, so no state
  const ownRow = row({
    id: "own-1",
    status: "ISSUED",
    invoiceNumber: "OWN-1",
    issueDate: new Date("2026-10-06T08:00:00Z"),
  });

  it("filters the whole set first: the count is the filtered one and the pages cut the filtered rows", async () => {
    const repository = fakeRepository(rows, [ownRow]);
    const first = await repository.list({
      page: 1,
      pageSize: 2,
      paymentState: "UNPAID",
    });
    assert.deepEqual(
      first.items.map((i) => i.documentNumber),
      ["E-2", "E-3"],
    );
    assert.deepEqual(
      first.items.map((i) => i.paymentState),
      ["UNPAID", "PARTIAL"],
    );
    assert.deepEqual(
      [first.pagination.totalItems, first.pagination.totalPages],
      [3, 2],
    );
    const second = await repository.list({
      page: 2,
      pageSize: 2,
      paymentState: "UNPAID",
    });
    assert.deepEqual(
      second.items.map((i) => i.documentNumber),
      ["E-5"],
    );
    const paid = await repository.list({
      page: 1,
      pageSize: 25,
      paymentState: "PAID",
    });
    assert.deepEqual(
      paid.items.map((i) => i.documentNumber),
      ["E-1"],
    );
    assert.equal(paid.pagination.totalItems, 1);
  });

  it("without the filter nothing changes: every row, the own one included, paged in the database", async () => {
    const repository = fakeRepository(rows, [ownRow]);
    const all = await repository.list({ page: 1, pageSize: 25 });
    assert.equal(all.items.length, 6);
    assert.equal(all.pagination.totalItems, 6);
  });

  it("over the row limit it asks for a narrower search instead of cutting the set", async () => {
    const many = Array.from({ length: PAYMENT_FILTER_ROW_LIMIT + 1 }, (_, i) =>
      external({ id: `x${i}`, documentNumber: `X-${i}` }),
    );
    await assert.rejects(
      fakeRepository(many, []).list({
        page: 1,
        pageSize: 25,
        paymentState: "PAID",
      }),
      (error: Error) => /szűkítsd/.test(error.message),
    );
    // the same set without the filter is fine: only the payment filter loads everything
    await assert.doesNotReject(
      fakeRepository(many, []).list({ page: 1, pageSize: 25 }),
    );
  });
});

/*
  A SZTORNÓZOTT SAJÁT SZÁMLA A LISTÁN (számlázási brief, 1. pont). MI PIROSÍT:
  az OS-ben kiállított sztornó nem jelöli az eredetit; a Számlázz.hu felületén
  sztornózott számla jele nem jön át az ikertől; egy nem sztornózott számla
  jelet kap.
*/
describe("the cancelled own invoice on the list", () => {
  it("cancelled by its own storno, or by its Számlázz.hu twin; a plain one is not", async () => {
    const own = (id: string, number: string, storno: boolean) =>
      ({
        ...row({
          id,
          status: "ISSUED",
          invoiceNumber: number,
          issueDate: new Date("2026-09-30T08:00:00.000Z"),
        }),
        correctionInvoices: storno ? [{ id: `${id}-storno` }] : [],
      }) as BillingDocumentListRow;
    const owns = [
      own("os-storno", "A-1", true),
      own("site-storno", "A-2", false),
      own("plain", "A-3", false),
    ];
    const twins = [
      external({ id: "t-2", documentNumber: "A-2", cancelled: true }),
      external({ id: "t-3", documentNumber: "A-3", cancelled: false }),
    ];
    const repository = new BillingDocumentListRepository();
    (repository as unknown as { database: unknown }).database = {
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      invoice: {
        findMany: async (args: { select: Record<string, unknown> }) =>
          "lines" in args.select
            ? owns
            : owns.map((o) => ({ invoiceNumber: o.invoiceNumber })),
        count: async () => owns.length,
      },
      externalBillingDocument: {
        findMany: async (args: {
          where: { documentNumber?: { in?: string[] } };
        }) =>
          args.where.documentNumber?.in
            ? twins.filter((t) =>
                args.where.documentNumber!.in!.includes(t.documentNumber),
              )
            : [],
        count: async () => 0,
      },
      simplePayTransactionLine: { findMany: async () => [] },
      outgoingPaymentMark: { findMany: async () => [] },
      salesOrder: { findMany: async () => [] },
    };
    const list = await repository.list({ page: 1, pageSize: 25 });
    assert.deepEqual(
      list.items.map((i) => [i.id, i.cancelled]),
      [
        ["os-storno", true],
        ["site-storno", true],
        ["plain", false],
      ],
    );
  });
});

/**
 * „PAPÍRON MEGVAN” A LISTÁN (Balázs, 2026-11-03). MI PIROSÍT: a jelölés a listaelemről elveszik (a PDF
 * oszlop a csomag döntését mutatja); a jelöletlen soron is megjelenik.
 */
describe("the paper-original mark on the list", () => {
  it("own and external rows carry it only when marked", () => {
    const at = new Date("2026-11-03T08:00:00Z");
    assert.equal(
      toListItem(row({ status: "ISSUED", paperOriginalAt: at })).paperOriginal,
      true,
    );
    assert.equal(
      "paperOriginal" in
        toListItem(row({ status: "ISSUED", paperOriginalAt: null })),
      false,
    );
    assert.equal(
      toExternalListItem(external({ paperOriginalAt: at })).paperOriginal,
      true,
    );
    assert.equal(
      "paperOriginal" in
        toExternalListItem(external({ paperOriginalAt: null })),
      false,
    );
  });
});

/**
 * A VEVŐNÉVRE KERESÉS A KÜLSŐ SZÁMLÁN (Balázs, 2026-11-03 08:56 UTC: a „zaubek” nem adta ki az
 * ACRW-2026/00515-öt, a számra keresve megvolt). A magánszemély nevét a NAV elrejti, a lista a webshop-
 * rendelés vevőnevét mutatja, a keresés eddig csak a számla saját (elrejtett) nevét nézte. MI PIROSÍT: a
 * rendelés vevőnevére illeszkedő rendelésszám nem kerül a külső szűrőbe; az `UNAS-` előtag rajta marad
 * (a számla rendelésszáma nélküle áll); keresőszó nélkül is lekérdez; az adószám nem kereshető.
 */
describe("the search finds an external invoice by the name the list shows", () => {
  it("the external filter takes the matching order numbers, and the tax number", () => {
    const or = externalWhere({ q: "zaubek" }, ["47679-558779"])?.OR ?? [];
    assert.ok(
      or.some(
        (c) =>
          JSON.stringify(c) ===
          JSON.stringify({ orderNumber: { in: ["47679-558779"] } }),
      ),
      JSON.stringify(or),
    );
    assert.ok(or.some((c) => "customerTaxNumber" in c));
    // no matching order: no empty `in` clause
    const none = externalWhere({ q: "zaubek" }, [])?.OR ?? [];
    assert.ok(
      !none.some((c) => JSON.stringify(c).includes('"in"')),
      JSON.stringify(none),
    );
    // the own rows: the tax number too
    assert.ok(
      (listWhere({ q: "12345678" }).OR ?? []).some(
        (c) => "partnerTaxNumber" in c,
      ),
    );
  });

  it("the order lookup is one joined query with the text as a literal pattern, and asks nothing without a query", async () => {
    const asked: { sql: string; values: unknown[] }[] = [];
    const database = {
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        asked.push({ sql: strings.join("?"), values });
        return [{ orderNumber: "47679-558779" }];
      },
    } as never;
    assert.deepEqual(await orderNumbersByBuyerName(database, "  zaubek "), [
      "47679-558779",
    ]);
    assert.deepEqual(asked[0]!.values, ["%zaubek%"]);
    // the join to the external invoices bounds the list (barracuda on #2019: an IN of every order hit the
    // 32 767 bind-variable limit on 60 000 orders, measured)
    assert.match(
      asked[0]!.sql,
      /JOIN "SalesOrder" o ON o\."orderNumber" = 'UNAS-' \|\| e\."orderNumber"/,
    );
    // a % or _ in the search is a character, not a wildcard
    await orderNumbersByBuyerName(database, "50%_x");
    assert.deepEqual(asked[1]!.values, ["%50\\%\\_x%"]);
    assert.deepEqual(await orderNumbersByBuyerName(database, "   "), []);
    assert.deepEqual(await orderNumbersByBuyerName(database, undefined), []);
    assert.equal(asked.length, 2);
  });

  it("the list passes the order numbers of the query to the external filter", async () => {
    let externalWhereSeen: unknown;
    const repository = new BillingDocumentListRepository();
    (repository as unknown as { database: unknown }).database = {
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      invoice: { findMany: async () => [], count: async () => 0 },
      externalBillingDocument: {
        findMany: async (args: { where: unknown }) => {
          externalWhereSeen ??= args.where;
          return [];
        },
        count: async () => 0,
      },
      simplePayTransactionLine: { findMany: async () => [] },
      outgoingPaymentMark: { findMany: async () => [] },
      salesOrder: { findMany: async () => [] },
      $queryRaw: async () => [{ orderNumber: "47679-558779" }],
    };
    await repository.list({ page: 1, pageSize: 25, q: "zaubek" });
    assert.ok(
      JSON.stringify(externalWhereSeen).includes(
        '{"orderNumber":{"in":["47679-558779"]}}',
      ),
      JSON.stringify(externalWhereSeen),
    );
  });
});
