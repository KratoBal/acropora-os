import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IncomingReadingValues } from "@acropora/types";

import {
  EVAL_FIELDS,
  evaluate,
  evaluateByGroup,
  formatReport,
  judge,
  percentages,
  sameValue,
  total,
  type EvalSample,
} from "./reading-eval.js";

/**
 * AZ ERTEKELO, KITALALT ADATON (szamla-adat nem kerul a repoba: minden szoveg,
 * szam es nev itt koholt). Ket dolgot merunk: a pontozas szabalyait, es azt,
 * hogy az ertekelo EGY SZANDEKOS RONTASRA a megfelelo szazalekot csokkenti
 * (kalibracio: egy olvaso, ami sosem tud rosszabbat mutatni, nem mer).
 */

const NO_VALUES: IncomingReadingValues = {
  supplierName: null,
  supplierTaxNumber: null,
  supplierEuTaxNumber: null,
  documentNumber: null,
  issueDate: null,
  fulfillmentDate: null,
  dueDate: null,
  currency: null,
  netAmount: null,
  vatAmount: null,
  grossAmount: null,
};

/** Egy koholt, cimkezett szamla-szoveg; a `label` felulirhato a rontashoz. */
function invoiceLines(
  n: number,
  overrides: Partial<Record<"number" | "date" | "net" | "total", string>> = {},
) {
  const net = 100 + n;
  const vat = Math.round(net * 21) / 100;
  return [
    `Koholt Akvarium ${n} GmbH`,
    `VAT ID: DE1000000${String(n).padStart(2, "0")}`,
    `${overrides.number ?? "Invoice No"}: KT-2026-${String(n).padStart(4, "0")}`,
    `${overrides.date ?? "Invoice date"}: 2026-03-${String((n % 27) + 1).padStart(2, "0")}`,
    `Due date: 2026-04-${String((n % 27) + 1).padStart(2, "0")}`,
    `${overrides.net ?? "Net amount"} EUR ${net.toFixed(2)}`,
    `VAT 21% EUR ${vat.toFixed(2)}`,
    `${overrides.total ?? "Total amount due"} EUR ${(net + vat).toFixed(2)}`,
  ];
}

/** Ami az olvasotol joggal varhato a fenti szovegbol (a szallito nev es a fulfillment nincs a szovegben). */
function expectedFor(n: number): IncomingReadingValues {
  const net = 100 + n;
  const vat = Math.round(net * 21) / 100;
  const day = String((n % 27) + 1).padStart(2, "0");
  return {
    ...NO_VALUES,
    supplierEuTaxNumber: `DE1000000${String(n).padStart(2, "0")}`,
    documentNumber: `KT-2026-${String(n).padStart(4, "0")}`,
    issueDate: `2026-03-${day}`,
    dueDate: `2026-04-${day}`,
    currency: "EUR",
    netAmount: net.toFixed(2),
    vatAmount: vat.toFixed(2),
    grossAmount: (net + vat).toFixed(2),
  };
}

const sample = (n: number, over: Partial<EvalSample> = {}): EvalSample => ({
  id: `koholt-${n}`,
  lines: invoiceLines(n),
  adapter: null,
  pairing: null,
  expected: expectedFor(n),
  manualFields: [],
  ...over,
});

const ten = Array.from({ length: 10 }, (_, i) => sample(i + 1));
const pct = (
  report: ReturnType<typeof evaluate>,
  field: (typeof EVAL_FIELDS)[number],
) => percentages(report.groups.ALL[field]);

describe("az ertekelo alapesete", () => {
  it("a jol olvashato koholt szamlakon minden elvart mezo 100% helyes, precizio 100%", () => {
    const report = evaluate(ten, "A");
    for (const field of EVAL_FIELDS) {
      const p = pct(report, field);
      if (p.expected === 0) continue;
      assert.equal(p.correct, 100, field);
      assert.equal(p.precision, 100, field);
    }
    assert.equal(percentages(total(report.groups.ALL)).correct, 100);
    assert.deepEqual(report.documentsAllCorrect.ALL, { all: 10, correct: 10 });
  });

  it("A MOD: a banki parositas nem toltheti ki a szoveg hianyat", () => {
    // a szovegbol a szallito neve nem olvashato; a parositas nevet ad, de az A mod nem kapja meg
    const withPairing = ten.map((s, i) => ({
      ...s,
      expected: {
        ...s.expected,
        supplierName: `Koholt Akvarium ${i + 1} GmbH`,
      },
      pairing: {
        number: "",
        supplierName: `Koholt Akvarium ${i + 1} GmbH`,
        date: "2026-03-01",
        gross: null,
        currency: "EUR",
        debits: [],
      },
    }));
    const a = evaluate(withPairing, "A");
    const b = evaluate(withPairing, "B");
    assert.equal(pct(a, "supplierName").correct, 0);
    assert.equal(pct(a, "supplierName").empty, 100);
    assert.equal(pct(b, "supplierName").correct, 100);
  });
});

describe("a kalibracio: egy szandekos rontas CSOKKENTI a szazalekot", () => {
  it("egy atirt szamlaszam-cimke a szamlaszam szazalekat viszi le, a tobbit nem", () => {
    const broken = ten.map((s, i) =>
      i < 4
        ? { ...s, lines: invoiceLines(i + 1, { number: "Referenznummer" }) }
        : s,
    );
    const base = evaluate(ten, "A");
    const report = evaluate(broken, "A");
    assert.ok(
      pct(report, "documentNumber").correct! <
        pct(base, "documentNumber").correct!,
    );
    assert.equal(pct(report, "documentNumber").correct, 60);
    assert.equal(pct(report, "issueDate").correct, 100);
    assert.equal(pct(report, "grossAmount").correct, 100);
    assert.ok(percentages(total(report.groups.ALL)).correct! < 100);
    assert.deepEqual(report.documentsAllCorrect.ALL, { all: 10, correct: 6 });
  });

  it("egy ROSSZ ertek (nem ures) a rossz%-ot es a precizio csokkenti, nem a sima ures%-ot", () => {
    const wrong = ten.map((s, i) =>
      i < 2 ? { ...s, expected: { ...s.expected, currency: "USD" } } : s,
    );
    const p = pct(evaluate(wrong, "A"), "currency");
    assert.equal(p.wrong, 20);
    assert.equal(p.empty, 0);
    assert.equal(p.correct, 80);
    assert.equal(p.precision, 80);
  });

  it("a szkennelt minta (nincs szovegreteg) URES, nem ROSSZ: a precizio nem esik", () => {
    const scanned = [
      ...ten.slice(0, 8),
      sample(11, { lines: null }),
      sample(12, { lines: null }),
    ];
    const report = evaluate(scanned, "A");
    assert.equal(report.scanned, 2);
    const p = pct(report, "grossAmount");
    assert.equal(p.empty, 20);
    assert.equal(p.wrong, 0);
    assert.equal(p.precision, 100);
  });
});

describe("a kezzel javitott (MANUAL) mezok kulon csoport", () => {
  it("a MANUAL mezo kikerul az automatikus sorbol, es a sajat sorban latszik; az ALL tartalmazza mindket", () => {
    const manual = ten.map((s, i) =>
      i < 3
        ? {
            ...s,
            expected: { ...s.expected, netAmount: "999.99" },
            manualFields: ["netAmount" as const],
          }
        : s,
    );
    const report = evaluate(manual, "A");
    assert.equal(percentages(report.groups.AUTO.netAmount).correct, 100);
    assert.equal(percentages(report.groups.AUTO.netAmount).expected, 7);
    assert.equal(percentages(report.groups.MANUAL.netAmount).correct, 0);
    assert.equal(percentages(report.groups.MANUAL.netAmount).wrong, 100);
    assert.equal(percentages(report.groups.MANUAL.netAmount).expected, 3);
    assert.equal(percentages(report.groups.ALL.netAmount).correct, 70);
    // az AUTO dokumentum-szazalekbol a kezzel javitott mezo kimarad
    assert.deepEqual(report.documentsAllCorrect.AUTO, { all: 10, correct: 10 });
    assert.deepEqual(report.documentsAllCorrect.ALL, { all: 10, correct: 7 });
  });
});

describe("a pontozas szabalyai", () => {
  it("osszegek szamszeruen, ketto tizedesre egyeznek", () => {
    assert.ok(sameValue("netAmount", "100.5", "100.50"));
    assert.ok(sameValue("grossAmount", "1000", "1000.00"));
    assert.ok(!sameValue("grossAmount", "1000.00", "1000.01"));
    assert.ok(!sameValue("grossAmount", "1000.00", "nem szam"));
  });

  it("az adoszam szokoz, kotojel, pont nelkul es nagybetuvel, a szallitonev kisbetuvel egyezik", () => {
    assert.ok(
      sameValue(
        "supplierEuTaxNumber",
        "NL 8123.45.678.B01",
        "nl8123-45-678b01",
      ),
    );
    assert.ok(
      sameValue(
        "supplierName",
        "Koholt  Akvarium GmbH",
        " koholt akvarium gmbh ",
      ),
    );
    assert.ok(!sameValue("documentNumber", "KT-1", "kt-1"));
  });

  it("nincs elvart ertek: nincs itelet; a felesleges kiolvasas kulon szamlalo", () => {
    assert.equal(judge("dueDate", null, "2026-04-01"), null);
    assert.equal(judge("dueDate", "2026-04-01", null), "EMPTY");
    assert.equal(judge("dueDate", "2026-04-01", "2026-04-02"), "WRONG");
    const report = evaluate(
      [sample(1, { expected: { ...expectedFor(1), dueDate: null } })],
      "A",
    );
    assert.equal(report.groups.ALL.dueDate.blankExpected, 1);
    assert.equal(report.groups.ALL.dueDate.extra, 1);
    assert.equal(percentages(report.groups.ALL.dueDate).extra, 100);
  });

  it("B mod: a parositas nelkuli minta A-kent megy, es a jelentes megmondja hany ilyen volt", () => {
    const report = evaluate(ten, "B");
    assert.equal(report.withoutPairing, 10);
    assert.match(formatReport(report), /parositas nelkuli minta: 10/);
  });
});

describe("csoportonkenti jelentes", () => {
  it("a csoportok kulon szazalekot kapnak, a rontas csak a sajat csoportjat viszi le", () => {
    const feed = ten.slice(0, 5).map((s) => ({ ...s, group: "feed" }));
    const verified = ten
      .slice(5)
      .map((s, i) => ({
        ...s,
        group: "verified",
        lines: invoiceLines(i + 6, { number: "Referenznummer" }),
      }));
    const groups = evaluateByGroup([...feed, ...verified], "A");
    assert.deepEqual([...groups.keys()], ["feed", "verified"]);
    assert.equal(pct(groups.get("feed")!, "documentNumber").correct, 100);
    assert.equal(pct(groups.get("verified")!, "documentNumber").correct, 0);
    assert.equal(pct(groups.get("verified")!, "grossAmount").correct, 100);
  });

  it("csoport nelkuli mintak egy kozos csoportba kerulnek", () => {
    assert.deepEqual(
      [...evaluateByGroup(ten, "A").keys()],
      ["(nincs csoport)"],
    );
  });
});

describe("a kiiras CSAK mezonevet es szazalekot tartalmaz", () => {
  it("nincs benne minta-azonosito, szamlaszam, szallitonev, adoszam, osszeg", () => {
    const text = formatReport(evaluate(ten, "A"));
    assert.match(text, /A mod: banki parositas NELKUL/);
    assert.match(text, /documentNumber/);
    for (const forbidden of [
      "koholt-",
      "KT-2026",
      "Koholt Akvarium",
      "DE10000",
      "121",
      "EUR",
    ]) {
      assert.ok(
        !text.includes(forbidden),
        `a kiiras tartalmazza: ${forbidden}`,
      );
    }
  });
});
