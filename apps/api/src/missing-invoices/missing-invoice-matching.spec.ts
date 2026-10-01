import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  inWindow,
  matchMonth,
  samePartner,
  type CandidateDocument,
  type MatchableDebit,
} from "./missing-invoice-matching.js";
import { sequenceRatio } from "./sequence-ratio.js";

const D = (v: string | number) => new Prisma.Decimal(v);

let n = 0;
const debit = (overrides: Partial<MatchableDebit>): MatchableDebit => ({
  id: `d${++n}`,
  bookingDate: "2026-08-10",
  amount: D(1000),
  currency: "HUF",
  original: null,
  counterpartyName: "Szállító Kft.",
  counterpartyAccount: null,
  narrative: "",
  category: "DOMESTIC_SUPPLIER",
  ...overrides,
});

const doc = (overrides: Partial<CandidateDocument>): CandidateDocument => ({
  id: `c${++n}`,
  source: "NAV",
  number: `SZ-2026-${n}`,
  date: "2026-08-05",
  gross: D(1000),
  currency: "HUF",
  supplierName: "Szállító Kft.",
  supplierAccounts: [],
  kind: "INVOICE",
  payee: "COMPANY",
  hasOriginal: true,
  ...overrides,
});

const run = (
  debits: MatchableDebit[],
  documents: CandidateDocument[],
  manual = new Map<string, string[]>(),
) => matchMonth({ debits, documents, manual });

describe("sequenceRatio", () => {
  it("gives Python difflib's ratio (values measured against difflib)", () => {
    assert.deepEqual(
      [
        ["allianz hungaria", "sopro hungaria"],
        ["hetzner online", "unas online"],
        ["abxcd", "abcd"],
        ["coral sands", "coralsands"],
      ].map(([a, b]) => Math.round(sequenceRatio(a!, b!) * 1e6) / 1e6),
      [0.6, 0.64, 0.888889, 0.952381],
    );
  });
});

describe("samePartner", () => {
  it("refuses the measured false likenesses that share a generic word", () => {
    assert.equal(
      samePartner("Allianz Hungária Zrt.", "SOPRO HUNGÁRIA Kft."),
      false,
    );
    assert.equal(samePartner("Hetzner Online GmbH", "UNAS Online Kft."), false);
    assert.equal(
      samePartner("Fluidra Magyarország Kft.", "Yettel Magyarország Zrt."),
      false,
    );
    assert.equal(
      samePartner("Tesla Hungary Kft.", "Tesla Hungary Korlatol"),
      true,
    );
  });
});

describe("inWindow", () => {
  it("takes an invoice up to 4 months before the payment and until the 15th of the next month", () => {
    assert.deepEqual(
      ["2026-04-01", "2026-03-31", "2026-09-15", "2026-09-16"].map((d) =>
        inWindow("2026-08-10", d),
      ),
      [true, false, true, false],
    );
  });
});

describe("matchMonth", () => {
  it("pairs by the invoice number in the narrative first", () => {
    const d = debit({
      narrative: "Számla: KS26/05848",
      counterpartyName: "Bárki",
    });
    const c = doc({
      number: "KS26/05848",
      supplierName: "Fluidra Kft.",
      gross: D(9),
    });
    assert.equal(
      run([d], [c]).get(d.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("pays a month of one card's payments with the partner's one invoice from the start of the next month", () => {
    const card = (date: string, amount: number, number = "7413124583") =>
      debit({
        bookingDate: date,
        amount: D(amount),
        counterpartyName: "SIMPLEP*PARKL.NET",
        narrative: `${date.replace(/-/g, ".")} ${number} SIMPLEP*PARKL .NET`,
        category: "CARD_SUBSCRIPTION",
      });
    const march = [
      card("2026-03-05", 400),
      card("2026-03-17", 350),
      card("2026-03-31", 450),
    ];
    const otherCard = card("2026-03-20", 999, "0194683438");
    const invoice = doc({
      number: "E-PAR-2026-13900",
      date: "2026-04-01",
      gross: D(1200),
      supplierName: "Parkl Digital Technologies Kft.",
    });
    const out = run([...march, otherCard], [invoice]);
    assert.deepEqual(
      march.map((d) => [
        out.get(d.id)?.documents[0]?.id,
        out.get(d.id)?.reason,
      ]),
      march.map(() => [
        invoice.id,
        "gyűjtőszámla: 3 kártyás fizetés havi összege",
      ]),
    );
    assert.equal(out.get(otherCard.id)?.state, "NOT_MATCHED");
  });

  it("does not take a monthly invoice that is late, off by an amount, or one of two equal ones", () => {
    const card = (date: string, amount: number) =>
      debit({
        bookingDate: date,
        amount: D(amount),
        counterpartyName: "SIMPLEP*PARKL.NET",
        narrative: `${date.replace(/-/g, ".")} 7413124583 SIMPLEP*PARKL .NET`,
        category: "CARD_SUBSCRIPTION",
      });
    const parkl = (date: string, gross: number) =>
      doc({
        date,
        gross: D(gross),
        supplierName: "Parkl Digital Technologies Kft.",
      });
    const reasons = (documents: CandidateDocument[]) => {
      const month = [card("2026-03-05", 400), card("2026-03-17", 800)];
      const out = run(month, documents);
      return month.map(
        (d) => out.get(d.id)?.reason.startsWith("gyűjtőszámla") ?? false,
      );
    };
    assert.deepEqual(reasons([parkl("2026-04-10", 1200)]), [false, false]); // késői, de az ablakon belül
    assert.deepEqual(reasons([parkl("2026-04-01", 1190)]), [false, false]); // a számla a kisebb
    // a többlet nagyobb a legnagyobb fizetésnél (900 > 800), vagy a számla 10 %-ánál (300 > 150)
    assert.deepEqual(reasons([parkl("2026-04-01", 2100)]), [false, false]);
    assert.deepEqual(reasons([parkl("2026-04-01", 1500)]), [false, false]);
    // csak a legnagyobb-fizetés korlát: 12 x 100 Ft, a többlet 120 (a 10 % alatt, a 100 fölött)
    const many = Array.from({ length: 12 }, (_, i) =>
      card(`2026-03-${String(i + 10)}`, 100),
    );
    const manyOut = run(many, [parkl("2026-04-01", 1320)]);
    assert.equal(manyOut.get(many[0]!.id)?.state, "NOT_MATCHED");
    assert.equal(
      run(many, [parkl("2026-04-01", 1290)]).get(many[0]!.id)?.state,
      "FOUND",
    );
    assert.deepEqual(
      reasons([parkl("2026-04-01", 1200), parkl("2026-04-02", 1200)]),
      [false, false],
    ); // kettő közül nem választunk
  });

  it("a small remainder on the invoice still pairs the month, with the difference (Parkl, 2026-09: a pending 640 Ft payment)", () => {
    const card = (date: string, amount: number, number = "0194683438") =>
      debit({
        bookingDate: date,
        amount: D(amount),
        counterpartyName: "SIMPLEP*PARKL.NET",
        narrative: `${date.replace(/-/g, ".")} ${number} SIMPLEP*PARKL .NET`,
        category: "CARD_SUBSCRIPTION",
      });
    const month = [
      card("2026-09-03", 6900),
      card("2026-09-14", 3980),
      card("2026-09-29", 11202),
    ];
    const invoice = doc({
      number: "E-PAR-2026-46439",
      date: "2026-10-01",
      gross: D(22722),
      supplierName: "Parkl Digital Technologies Kft.",
    });
    const out = run(month, [invoice]);
    for (const d of month) {
      const o = out.get(d.id)!;
      assert.equal(o.state, "FOUND");
      assert.deepEqual(o.documents, [invoice]);
      assert.equal(
        o.reason,
        "gyűjtőszámla: 3 kártyás fizetés havi összege, a számla többlete 640 HUF, könyveletlen tétel lehet",
      );
      assert.equal(o.amountDifference?.amount.toString(), "-640");
      assert.equal(o.amountDifference?.currency, "HUF");
    }
  });

  it("the exact card takes its invoice first, so the other card's remainder finds its own", () => {
    const card = (date: string, amount: number, number: string) =>
      debit({
        bookingDate: date,
        amount: D(amount),
        counterpartyName: "SIMPLEP*PARKL.NET",
        narrative: `${date.replace(/-/g, ".")} ${number} SIMPLEP*PARKL .NET`,
        category: "CARD_SUBSCRIPTION",
      });
    const exactCard = [
      card("2026-03-05", 500, "1111111111"),
      card("2026-03-06", 500, "1111111111"),
    ];
    const shortCard = [
      card("2026-03-07", 480, "2222222222"),
      card("2026-03-08", 480, "2222222222"),
    ];
    const parkl = (number: string, gross: number) =>
      doc({
        number,
        date: "2026-04-01",
        gross: D(gross),
        supplierName: "Parkl Digital Technologies Kft.",
      });
    // az E-PAR-Y a pontos kártyáé; a rövid kártyának MINDKETTŐ kis többlet
    // lenne (40 és 30 Ft), tehát a pontos kör nélkül kettő közül nem választana
    const out = run(
      [...exactCard, ...shortCard],
      [parkl("E-PAR-Y", 1000), parkl("E-PAR-X", 990)],
    );
    const numbers = (ds: MatchableDebit[]) =>
      ds.map((d) =>
        out
          .get(d.id)
          ?.documents.map((c) => c.number)
          .join(),
      );
    assert.deepEqual(numbers(exactCard), ["E-PAR-Y", "E-PAR-Y"]);
    assert.deepEqual(numbers(shortCard), ["E-PAR-X", "E-PAR-X"]);
    assert.equal(
      out.get(shortCard[0]!.id)?.amountDifference?.amount.toString(),
      "-30",
    );
    assert.equal(out.get(exactCard[0]!.id)?.amountDifference, undefined);
  });

  it("takes the number only as a whole word of the narrative (the two measured wrong pairings)", () => {
    // PETIK-2026-3 a PETIK-2026-30 közleményben: a teljes szám a helyes
    const d = debit({ narrative: "PETIK-2026-30", amount: D(777) });
    const short = doc({ number: "PETIK-2026-3", gross: D(1) });
    const right = doc({ number: "PETIK-2026-30", gross: D(2) });
    assert.equal(
      run([d], [short, right]).get(d.id)?.documents[0]?.id,
      right.id,
    );
    // egy MÁSIK partner 2026-37 számlája az E-VEGA-2026-37 közleményben
    const e = debit({
      narrative: "E-VEGA-2026-37",
      counterpartyName: "Vértes és Tsa Bt.",
      amount: D(778),
    });
    const other = doc({
      number: "2026-37",
      supplierName: "UPS Bt.",
      gross: D(3),
    });
    assert.notEqual(
      run([e], [other]).get(e.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("needs the partner too for a short number, and never takes a number under 5 characters", () => {
    const d = debit({
      narrative: "Számla 26/88",
      counterpartyName: "Szállító Kft.",
      amount: D(779),
    });
    const theirs = doc({
      number: "26/88",
      supplierName: "Szállító Kft.",
      gross: D(4),
    });
    const others = doc({
      number: "26/88",
      supplierName: "Másik Bt.",
      gross: D(5),
    });
    assert.equal(
      run([d], [others]).get(d.id)?.reason === "a számla száma a közleményben",
      false,
    );
    assert.equal(run([d], [theirs]).get(d.id)?.documents[0]?.id, theirs.id);
    // a 469-es (rövid) szám a saját partnerénél sem elég
    const e = debit({ narrative: "469", amount: D(780) });
    assert.notEqual(
      run([e], [doc({ number: "469", gross: D(6) })]).get(e.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("takes a short number from the partner's own invoice even when the bank spells the name otherwise (Hertlein shape)", () => {
    // Hertlein 260835: 6 karakter, tehát a partnernek is egyeznie kell
    const d = debit({
      narrative: "Invoice 260835",
      counterpartyName: "HERTLEIN AQUARISTIK E.KFR.",
      amount: D(781),
    });
    const theirs = doc({
      number: "260835",
      supplierName: "Hertlein Aquaristik e.Kfr.",
      gross: D(7),
    });
    assert.equal(run([d], [theirs]).get(d.id)?.documents[0]?.id, theirs.id);
    // ugyanez a rövid szám egy másik kiállító HIVATKOZÁSAKÉNT nem párosít
    const other = doc({
      number: "X-99999999",
      references: ["260835"],
      supplierName: "Másik GmbH",
      gross: D(8),
    });
    assert.notEqual(
      run([d], [other]).get(d.id)?.reason,
      "a számla száma a közleményben",
    );
  });

  it("pairs by a reference the invoice carries, when the narrative names that instead of the number", () => {
    // Fauna Marin, éles 2026-10-01: a fizetés a rendelésszámot nevezi meg
    const d = debit({
      narrative: "1.698,58 EUR 20144304 Fauna Marin Gmbh",
      counterpartyName: "Fauna Marin Gmbh",
    });
    const c = doc({
      number: "40142365",
      references: ["20144304"],
      supplierName: "Fauna Marin",
      gross: null,
    });
    const outcome = run([d], [c]).get(d.id);
    assert.equal(outcome?.reason, "a számla száma a közleményben");
    assert.deepEqual(
      outcome?.documents.map((x) => x.id),
      [c.id],
    );
  });

  it("pairs by the supplier's bank account with an exact amount", () => {
    const d = debit({
      counterpartyName: "más név",
      counterpartyAccount: "1177301611111018",
    });
    const c = doc({
      supplierAccounts: ["1177301611111018"],
      supplierName: "Teljesen Más",
    });
    assert.equal(run([d], [c]).get(d.id)?.state, "FOUND");
  });

  it("gives an exact invoice to the payment that matches it exactly, not to an earlier one 1 Ft off", () => {
    const july = debit({ bookingDate: "2026-07-15", amount: D(1999) });
    const august = debit({ bookingDate: "2026-08-07", amount: D(1998) });
    const c = doc({ date: "2026-08-05", gross: D(1998) });
    const out = run([july, august], [c]);
    assert.equal(out.get(august.id)?.documents[0]?.id, c.id);
    assert.equal(out.get(july.id)?.state, "NOT_MATCHED");
  });

  it("counts a 2-5 Ft rounding as found, but does not choose between two such invoices", () => {
    const d = debit({ amount: D(1003) });
    assert.equal(run([d], [doc({})]).get(d.id)?.state, "FOUND");
    const e = debit({ amount: D(1003) });
    const out = run([e], [doc({ gross: D(1000) }), doc({ gross: D(1006) })]);
    assert.equal(out.get(e.id)?.state, "NOT_MATCHED");
    assert.match(out.get(e.id)!.reason, /kerekítési/);
  });

  it("lets one invoice pay one debit only (the two 23 810 Ft Alza payments)", () => {
    const first = debit({ amount: D(23810), counterpartyName: "Alza.hu Kft." });
    const second = debit({
      amount: D(23810),
      counterpartyName: "Alza.hu Kft.",
    });
    const out = run(
      [first, second],
      [doc({ gross: D(23810), supplierName: "Alza.hu Kft." })],
    );
    assert.deepEqual(
      [out.get(first.id)?.state, out.get(second.id)?.state],
      ["FOUND", "NOT_MATCHED"],
    );
  });

  it("pairs several invoices in one transfer, and refuses to choose between two sets", () => {
    const d = debit({ amount: D(3000) });
    const out = run([d], [doc({ gross: D(1000) }), doc({ gross: D(2000) })]);
    assert.equal(out.get(d.id)?.documents.length, 2);
    const e = debit({ amount: D(3000) });
    const twice = run(
      [e],
      [
        doc({ gross: D(1000) }),
        doc({ gross: D(2000) }),
        doc({ gross: D(1500) }),
        doc({ gross: D(1500) }),
      ],
    );
    assert.equal(twice.get(e.id)?.state, "NOT_MATCHED");
  });

  it("marks a proforma, a private-person invoice and an unverifiable payee", () => {
    const states = (["PROFORMA", "INVOICE", "INVOICE"] as const).map(
      (kind, i) => {
        const d = debit({});
        return run(
          [d],
          [
            doc({
              kind,
              payee: (["COMPANY", "NOT_COMPANY", "UNKNOWN"] as const)[i],
            }),
          ],
        ).get(d.id)?.state;
      },
    );
    assert.deepEqual(states, ["PROFORMA_ONLY", "NOT_COMPANY", "NOT_MATCHED"]);
  });

  it("asks for the original when only the NAV data row is there", () => {
    const d = debit({});
    assert.equal(
      run([d], [doc({ hasOriginal: false })]).get(d.id)?.state,
      "ORIGINAL_MISSING",
    );
  });

  it("takes the paper original as the original, and a manual pairing by any id of a merged invoice", () => {
    const d = debit({});
    const nav = doc({ hasOriginal: false, aliasIds: ["pdf-1"] });
    const paper = matchMonth({
      debits: [d],
      documents: [nav],
      manual: new Map(),
      paperOriginals: new Set([d.id]),
    });
    assert.equal(paper.get(d.id)?.state, "FOUND");
    const e = debit({ amount: D(1) });
    const byAlias = run([e], [nav], new Map([[e.id, ["pdf-1"]]]));
    assert.deepEqual(
      [byAlias.get(e.id)?.matchedBy, byAlias.get(e.id)?.documents[0]?.id],
      ["MANUAL", nav.id],
    );
  });

  /*
    KÉTSZER FIZETETT SZÁMLA (acrobot 25636: a Sopro KB-2855/2026 két 172 006
    Ft-os terheléshez, ugyanaz a PDF kétszer feltöltve). MI PIROSÍT: ha a két
    terhelés Megvan maradna; ha nem neveznék meg egymást; ha egyetlen
    párosítás is kettősnek látszana; ha egy más gondú tétel (nem a cégre szól)
    elveszítené a saját állapotát.
  */
  it("the same file paired to two debits: both are double paid, and name each other", () => {
    const a = debit({
      id: "pay-28",
      bookingDate: "2026-09-28",
      amount: D(172006),
    });
    const b = debit({
      id: "pay-29",
      bookingDate: "2026-09-29",
      amount: D(172006),
    });
    const first = doc({
      id: "up-1",
      source: "UPLOAD",
      gross: null,
      identities: ["sha:same"],
    });
    const second = doc({
      id: "up-2",
      source: "UPLOAD",
      gross: null,
      identities: ["sha:same"],
    });
    const outcome = run(
      [a, b],
      [first, second],
      new Map([
        [a.id, ["up-1"]],
        [b.id, ["up-2"]],
      ]),
    );
    assert.deepEqual(
      [a, b].map((d) => [
        outcome.get(d.id)?.state,
        outcome.get(d.id)?.doublePaidWith,
      ]),
      [
        ["DOUBLE_PAID", ["pay-29"]],
        ["DOUBLE_PAID", ["pay-28"]],
      ],
    );
  });

  it("the same invoice number paired twice is double paid too; one pairing, or another problem, is not", () => {
    const a = debit({ id: "n-1" });
    const b = debit({ id: "n-2", bookingDate: "2026-08-11" });
    const same = (id: string, payee: CandidateDocument["payee"] = "COMPANY") =>
      doc({ id, identities: ["inv:kb-2855/2026|12345678"], payee });
    const twice = run(
      [a, b],
      [same("x-1"), same("x-2")],
      new Map([
        [a.id, ["x-1"]],
        [b.id, ["x-2"]],
      ]),
    );
    assert.equal(twice.get(a.id)?.state, "DOUBLE_PAID");
    const once = run([a], [same("x-3")], new Map([[a.id, ["x-3"]]]));
    assert.deepEqual(
      [once.get(a.id)?.state, once.get(a.id)?.doublePaidWith],
      ["FOUND", undefined],
    );
    const notOurs = run(
      [a, b],
      [same("x-4", "NOT_COMPANY"), same("x-5")],
      new Map([
        [a.id, ["x-4"]],
        [b.id, ["x-5"]],
      ]),
    );
    assert.deepEqual(
      [notOurs.get(a.id)?.state, notOurs.get(b.id)?.state],
      ["NOT_COMPANY", "DOUBLE_PAID"],
    );
  });

  it("tells no invoice from an unmatched one by whether the partner has documents", () => {
    const d = debit({ amount: D(777) });
    const e = debit({ amount: D(777), counterpartyName: "Ismeretlen Bt." });
    const out = run([d, e], [doc({ gross: D(5000) })]);
    assert.deepEqual(
      [out.get(d.id)?.state, out.get(e.id)?.state],
      ["NOT_MATCHED", "NO_INVOICE"],
    );
    assert.equal(out.get(d.id)?.candidates.length, 1);
  });

  it("keeps a manual pairing even against a rule, and never matches categories that need no invoice", () => {
    const d = debit({ narrative: "SZ-X-99999" });
    const byRule = doc({ number: "SZ-X-99999" });
    const chosen = doc({ gross: D(1) });
    const out = run([d], [byRule, chosen], new Map([[d.id, [chosen.id]]]));
    assert.deepEqual(
      [out.get(d.id)?.matchedBy, out.get(d.id)?.documents[0]?.id],
      ["MANUAL", chosen.id],
    );
    const tax = debit({ category: "TAX" });
    assert.equal(run([tax], [doc({})]).get(tax.id)?.state, "NO_INVOICE_NEEDED");
  });

  it("compares a card payment's original currency amount with a EUR invoice", () => {
    const d = debit({
      amount: D(21990),
      original: { amount: D("55.38"), currency: "EUR" },
      counterpartyName: "Hetzner Online GmbH",
    });
    const c = doc({
      gross: D("55.38"),
      currency: "EUR",
      supplierName: "Hetzner Online GmbH",
    });
    assert.equal(run([d], [c]).get(d.id)?.state, "FOUND");
  });
});

describe("several invoices named in one payment (acrobot 25610)", () => {
  const FLUIDRA = "Fluidra Magyarország Kft.";
  const ks = (
    number: string,
    gross: number,
    extra: Partial<CandidateDocument> = {},
  ) =>
    doc({
      number,
      gross: D(gross),
      supplierName: FLUIDRA,
      date: "2026-09-10",
      ...extra,
    });

  it("pairs EVERY named invoice, the bank's split forms too (Fluidra, 2026-09-25)", () => {
    const d = debit({
      bookingDate: "2026-09-25",
      amount: D(5000),
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 KS26/08382 KS26/0 8450 K S26/08541 KS26/08638",
    });
    const docs = [
      ks("KS26/08132", 1000),
      ks("KS26/08382", 1000),
      ks("KS26/08450", 1000),
      ks("KS26/08541", 1000),
      ks("KS26/08638", 1000),
    ];
    const outcome = run([d], docs).get(d.id)!;
    assert.equal(outcome.reason, "a számla száma a közleményben");
    assert.deepEqual(outcome.documents.map((x) => x.number).sort(), [
      "KS26/08132",
      "KS26/08382",
      "KS26/08450",
      "KS26/08541",
      "KS26/08638",
    ]);
    assert.equal(outcome.state, "FOUND");
    assert.equal(outcome.missingNumbers, undefined);
    assert.equal(outcome.amountDifference, undefined);
  });

  it("a split number finds only the partner's own invoice", () => {
    // "26/0 8450" osszefuzve egy MASIK kiallito szamlaszama: nem talalat
    const d = debit({
      counterpartyName: FLUIDRA,
      narrative: "26/0 8450 befizetes",
    });
    const other = doc({
      number: "26/08450",
      supplierName: "Más Kft.",
      gross: D(1),
    });
    assert.notEqual(
      run([d], [other]).get(d.id)?.reason,
      "a számla száma a közleményben",
    );
    const own = ks("26/08450", 2);
    assert.deepEqual(
      run([d], [own])
        .get(d.id)
        ?.documents.map((x) => x.id),
      [own.id],
    );
  });

  it("names the missing ones: an invoice without its original, and a named number with no document", () => {
    const d = debit({
      amount: D(3000),
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 KS26/08382 KS26/08999",
    });
    const navOnly = ks("KS26/08132", 1000, { hasOriginal: false });
    const withPdf = ks("KS26/08382", 1000);
    const outcome = run([d], [navOnly, withPdf]).get(d.id)!;
    assert.equal(outcome.state, "ORIGINAL_MISSING");
    assert.deepEqual(outcome.missingNumbers, ["KS26/08132", "KS26/08999"]);
    // ket szamla 2000, a terheles 3000: az elteres jelezve, a parositas all
    assert.equal(outcome.amountDifference?.amount.toString(), "1000");
    assert.equal(outcome.documents.length, 2);
  });

  it("a named number with no document keeps the item from Found, even when every paired invoice has its original", () => {
    const d = debit({
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 KS26/08999",
    });
    const outcome = run([d], [ks("KS26/08132", 1000)]).get(d.id)!;
    assert.equal(outcome.state, "ORIGINAL_MISSING");
    assert.deepEqual(outcome.missingNumbers, ["KS26/08999"]);
  });

  it("a named number already paired to another payment is not missing", () => {
    const first = debit({
      bookingDate: "2026-09-01",
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132",
    });
    const second = debit({
      bookingDate: "2026-09-20",
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 KS26/08382",
    });
    const a = ks("KS26/08132", 1000);
    const b = ks("KS26/08382", 1000);
    const out = run([first, second], [a, b]);
    assert.deepEqual(
      out.get(second.id)?.documents.map((x) => x.id),
      [b.id],
    );
    assert.equal(out.get(second.id)?.missingNumbers, undefined);
  });

  it("only a different shape is not taken for a missing invoice, and a rounding gap is no difference", () => {
    const d = debit({
      amount: D(1003),
      counterpartyName: FLUIDRA,
      narrative: "KS26/08132 rendeles 20260915 Budapest",
    });
    const outcome = run([d], [ks("KS26/08132", 1000)]).get(d.id)!;
    assert.equal(outcome.missingNumbers, undefined);
    assert.equal(outcome.amountDifference, undefined);
    assert.equal(outcome.state, "FOUND");
  });
});

describe("a proforma is only a fallback (acrobot 25607, Aquarioom 2026-09-29)", () => {
  // a valos eset alakja: EUR-terheles, a kozlemeny a rendelesszamot nevezi meg,
  // ami a proforma (Commande) szama; a valodi szamla (Facture) mas szamu
  const aq = (overrides: Partial<MatchableDebit> = {}) =>
    debit({
      bookingDate: "2026-09-29",
      amount: D("939.67"),
      currency: "EUR",
      counterpartyName: "AQUARIOOM",
      narrative: "CM9201 ACROPORA",
      category: "FOREIGN_SUPPLIER",
      ...overrides,
    });
  const proforma = (overrides: Partial<CandidateDocument> = {}) =>
    doc({
      source: "MAILBOX",
      number: "CM9201",
      date: "2026-09-28",
      gross: D("939.67"),
      currency: "EUR",
      supplierName: "Aquarioom",
      kind: "PROFORMA",
      payee: "NOT_COMPANY",
      ...overrides,
    });
  const invoice = (overrides: Partial<CandidateDocument> = {}) =>
    doc({
      source: "MAILBOX",
      number: "FA00009139",
      date: "2026-09-30",
      gross: D("939.67"),
      currency: "EUR",
      supplierName: "Aquarioom",
      ...overrides,
    });

  it("the named proforma gives way to the partner's exact-amount invoice", () => {
    const d = aq();
    const fa = invoice();
    const outcome = run([d], [proforma(), fa]).get(d.id)!;
    assert.equal(outcome.state, "FOUND");
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["FA00009139"],
    );
  });

  it("with no real invoice, or one of another amount or partner, the proforma stays", () => {
    for (const others of [
      [],
      [invoice({ gross: D("939.00") })],
      [invoice({ supplierName: "Fauna Marin GmbH" })],
    ]) {
      const d = aq();
      const outcome = run([d], [proforma(), ...others]).get(d.id)!;
      assert.equal(outcome.state, "PROFORMA_ONLY");
      assert.deepEqual(
        outcome.documents.map((x) => x.number),
        ["CM9201"],
      );
      // az 1. szabaly tartotta meg, nem egy kesobbi szabaly talalta ujra
      assert.equal(outcome.reason, "a számla száma a közleményben");
    }
  });

  it("the account rule also prefers the invoice to a closer proforma", () => {
    const d = aq({ narrative: "rendeles", counterpartyAccount: "FR7612345" });
    const outcome = run(
      [d],
      [
        proforma({ date: "2026-09-29", supplierAccounts: ["FR7612345"] }),
        invoice({ date: "2026-10-05", supplierAccounts: ["FR7612345"] }),
      ],
    ).get(d.id)!;
    assert.equal(
      outcome.reason,
      "a szállító bankszámlájára ment, egyező összeggel",
    );
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["FA00009139"],
    );
  });

  it("when the narrative names both, only the invoice pairs", () => {
    const d = aq({ narrative: "CM9201 FA00009139" });
    const outcome = run([d], [proforma(), invoice()]).get(d.id)!;
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["FA00009139"],
    );
  });

  it("amount and partner alone: the invoice wins even when the proforma is closer in date", () => {
    const d = aq({ narrative: "rendeles" });
    const outcome = run(
      [d],
      [proforma({ date: "2026-09-29" }), invoice({ date: "2026-10-05" })],
    ).get(d.id)!;
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["FA00009139"],
    );
  });

  it("a rounding proforma next to a rounding invoice is not an ambiguity", () => {
    const d = debit({ amount: D(10003), narrative: "rendeles" });
    const outcome = run(
      [d],
      [
        doc({ kind: "PROFORMA", gross: D(10000), payee: "NOT_COMPANY" }),
        doc({ number: "SZ-VALODI", gross: D(10000) }),
      ],
    ).get(d.id)!;
    assert.deepEqual(
      outcome.documents.map((x) => x.number),
      ["SZ-VALODI"],
    );
  });

  it("the invoice taken by another payment does not displace the proforma", () => {
    const first = aq({ bookingDate: "2026-09-20", narrative: "FA00009139" });
    const second = aq();
    const outcomes = run([first, second], [proforma(), invoice()]);
    assert.deepEqual(
      outcomes.get(first.id)!.documents.map((x) => x.number),
      ["FA00009139"],
    );
    assert.equal(outcomes.get(second.id)!.state, "PROFORMA_ONLY");
  });
});

describe("a typo twin: the exact payment wins over the by-name one (acrobot 25655, Fluidra 2026-07-30)", () => {
  const fluidra = (
    amount: number,
    narrative: string,
    overrides: Partial<MatchableDebit> = {},
  ) =>
    debit({
      bookingDate: "2026-07-30",
      amount: D(amount),
      counterpartyName: "Fluidra Magyarország Kft.",
      narrative,
      ...overrides,
    });
  const ks4727 = () =>
    doc({
      number: "KS26/04727",
      date: "2026-05-27",
      gross: D(234778),
      supplierName: "Fluidra Magyarország Kft.",
    });

  it("the exact payment with the mistyped number takes the invoice; the by-name one stays unmatched with it as a candidate", () => {
    const byName = fluidra(81915, "KS26/04727");
    const exactTypo = fluidra(234778, "KS26/04724");
    const invoice = ks4727();
    const out = run([byName, exactTypo], [invoice]);
    assert.deepEqual(out.get(exactTypo.id)!.documents, [invoice]);
    assert.equal(out.get(exactTypo.id)!.state, "FOUND");
    const left = out.get(byName.id)!;
    assert.equal(left.state, "NOT_MATCHED");
    assert.deepEqual(left.candidates, [invoice]);
    assert.match(left.reason, /KS26\/04727.*elírás-gyanú/);
  });

  it("without a typo twin the by-name pairing stands, with the difference (#1332)", () => {
    const other = () =>
      doc({
        number: "KS26/09999",
        date: "2026-06-01",
        gross: D(1),
        supplierName: "Fluidra Magyarország Kft.",
      });
    const cases: [string, () => MatchableDebit[], CandidateDocument[]][] = [
      ["nincs másik fizetés", () => [], []],
      // a másik fizetés LÉTEZŐ számot nevez meg, nem elírást
      ["létező szám", () => [fluidra(234778, "KS26/09999")], [other()]],
      ["nem pontos összeg", () => [fluidra(234000, "KS26/04724")], []],
      [
        "másik partner",
        () => [
          fluidra(234778, "KS26/04724", {
            counterpartyName: "Menet-Trend Kft.",
          }),
        ],
        [],
      ],
      ["más alakú szám", () => [fluidra(234778, "rendeles 4724")], []],
      // a másik fizetésnek van MÁSIK pontos számlája is: nem ezt kell elvenni
      [
        "a másiknak két pontos számlája van",
        () => [fluidra(234778, "KS26/04724")],
        [
          doc({
            number: "KS26/04800",
            date: "2026-06-10",
            gross: D(234778),
            supplierName: "Fluidra Magyarország Kft.",
          }),
        ],
      ],
    ];
    for (const [name, others, extra] of cases) {
      const byName = fluidra(81915, "KS26/04727");
      const invoice = ks4727();
      const o = run([byName, ...others()], [invoice, ...extra]).get(byName.id)!;
      assert.deepEqual(o.documents, [invoice], name);
      assert.equal(o.amountDifference?.amount.toString(), "-152863", name);
    }
    // ha a név szerinti fizetés összege is pontos, az övé marad
    const exactByName = fluidra(234778, "KS26/04727");
    const invoice = ks4727();
    const out = run([exactByName, fluidra(234778, "KS26/04724")], [invoice]);
    assert.deepEqual(out.get(exactByName.id)!.documents, [invoice]);
    // név szerint, nem egy későbbi szabály adta vissza
    assert.equal(
      out.get(exactByName.id)!.reason,
      "a számla száma a közleményben",
    );
  });
});

describe("a company original is not overruled by another document of the same invoice (acrobot 25664)", () => {
  it("the reminder's not-the-company verdict gives way to the invoice's", () => {
    const d = debit({
      narrative: "26007910",
      amount: D(1703.08),
      currency: "EUR",
      counterpartyName: "De Jong Marinelife B.V.",
    });
    const invoice = doc({
      number: "26007910",
      gross: D(1703.08),
      currency: "EUR",
      supplierName: "De Jong Marinelife B.V.",
      source: "MAILBOX",
    });
    const reminder = doc({
      number: "26007910",
      gross: null,
      supplierName: "",
      source: "MAILBOX",
      payee: "NOT_COMPANY",
    });
    assert.equal(run([d], [invoice, reminder]).get(d.id)?.state, "FOUND");
    // egy MÁSIK számla „nem a cégre” ítélete továbbra is dönt
    const e = debit({
      narrative: "26007910 26007911",
      amount: D(1703.08),
      currency: "EUR",
      counterpartyName: "De Jong Marinelife B.V.",
    });
    const other = doc({
      number: "26007911",
      gross: D(1),
      supplierName: "De Jong Marinelife B.V.",
      source: "MAILBOX",
      payee: "NOT_COMPANY",
    });
    assert.equal(
      run([e], [{ ...invoice, id: "inv-2" }, other]).get(e.id)?.state,
      "NOT_COMPANY",
    );
  });
});

describe("a summary invoice's group is one pairing, not a double payment (acrobot 25708)", () => {
  const card = (date: string, amount: number) =>
    debit({
      bookingDate: date,
      amount: D(amount),
      counterpartyName: "SIMPLEP*PARKL.NET",
      narrative: `${date.replace(/-/g, ".")} 0194683438 SIMPLEP*PARKL .NET`,
      category: "CARD_SUBSCRIPTION",
    });
  const parkl = (gross: number, id?: string) =>
    doc({
      ...(id ? { id } : {}),
      number: "E-PAR-2026-46439",
      date: "2026-10-01",
      gross: D(gross),
      supplierName: "Parkl Digital Technologies Kft.",
      identities: ["inv:e-par-2026-46439|12967726"],
    });

  it("the exact monthly group and the small-remainder group are not double paid", () => {
    for (const gross of [1200, 1260]) {
      const month = [
        card("2026-09-05", 400),
        card("2026-09-17", 350),
        card("2026-09-28", 450),
      ];
      const out = run(month, [parkl(gross)]);
      for (const d of month) {
        assert.equal(out.get(d.id)?.state, "FOUND", `${gross}`);
        assert.equal(out.get(d.id)?.doublePaidWith, undefined);
      }
    }
  });

  it("the same invoice in a group AND in another pairing is still double paid", () => {
    const month = [
      card("2026-09-05", 400),
      card("2026-09-17", 350),
      card("2026-09-28", 450),
    ];
    // egy átutalás ugyanarra a számlára (egy másik, azonos számú dokumentummal)
    const transfer = debit({
      bookingDate: "2026-10-02",
      amount: D(1200),
      counterpartyName: "Parkl Digital Technologies Kft.",
      narrative: "szamla",
      category: "DOMESTIC_SUPPLIER",
    });
    const out = run(
      [...month, transfer],
      [parkl(1200, "nav-1"), parkl(1200, "pdf-1")],
    );
    for (const d of [...month, transfer])
      assert.equal(out.get(d.id)?.state, "DOUBLE_PAID", d.id);
    assert.deepEqual(
      out.get(transfer.id)?.doublePaidWith,
      month.map((d) => d.id).sort(),
    );
  });
});
