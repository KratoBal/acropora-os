import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buyerTaxCheckLine,
  buyerTaxCheckReason,
  buyerTaxCheckWhere,
  invoicesWithoutBuyerTaxNumber,
  type BuyerTaxCheckRow,
  type BuyerTaxFinding,
} from "./buyer-tax-check.js";
import {
  BuyerTaxCheckScheduler,
  buyerTaxCheckEnabled,
  catchUpOnStart,
  delayUntilNextRun,
  type BuyerTaxCheckRepository,
} from "./buyer-tax-check.scheduler.js";

/**
 * A KIÁLLÍTOTT SZÁMLÁK NAPI ADÓSZÁM-ELLENŐRZÉSE (kártya aaf4f09d; acrobot 42375, 42382).
 * MI PIROSÍT: ha a partner-tükör, az ismeretlen típus vagy a cég adószám nélkül nem
 * jelez; ha a magánszemély vagy az adószámos jelez; ha a naplósor alakja eltér attól,
 * amit a flotta keres; ha a hibás futás nem ír sort; ha a futás nem az előző budapesti
 * napot nézi; ha a sztornó vagy a vevő nélküli sor bekerül.
 */
const row = (over: Partial<BuyerTaxCheckRow> = {}): BuyerTaxCheckRow => ({
  invoiceNumber: "ACRW-2026/00510",
  issueDate: new Date("2026-11-03T09:00:00.000Z"),
  partnerName: "Fővárosi Állat- és Növénykert",
  partnerTaxNumber: null,
  buyerSnapshot: null,
  customer: { type: "COMPANY", partner: null },
  ...over,
});

describe("melyik kiállított számla jelez", () => {
  it("a szabály a kapué: partner-tükör, ismeretlen típus és cég adószám nélkül jelez", () => {
    const flagged = invoicesWithoutBuyerTaxNumber([
      row({ invoiceNumber: "A" }),
      row({
        invoiceNumber: "B",
        customer: { type: "PERSON", partner: { id: "s-1" } },
      }),
      row({ invoiceNumber: "C", customer: null }),
      row({
        invoiceNumber: "D",
        customer: { type: "PERSON", partner: null },
        partnerName: "Kovács Anna",
      }),
      row({ invoiceNumber: "E", partnerTaxNumber: "15490658-2-42" }),
      row({
        invoiceNumber: "F",
        buyerSnapshot: { name: "Reef GmbH", euTaxNumber: "DE123456789" },
      }),
    ]);
    assert.deepEqual(
      flagged.map((finding) => finding.invoiceNumber),
      ["A", "B", "C"],
    );
    assert.match(flagged[0]!.problem, /^A vevőnek nincs adószáma:/);
  });

  it("a kiküldött pillanatkép a mérvadó, a partner-adószám csak ha az nincs", () => {
    // the snapshot has no tax number: the invoice row's partner tax number is not asked
    assert.equal(
      invoicesWithoutBuyerTaxNumber([
        row({
          buyerSnapshot: { name: "Valami Kft.", taxNumber: "12345678-2-42" },
        }),
      ]).length,
      0,
    );
    const [finding] = invoicesWithoutBuyerTaxNumber([
      row({
        buyerSnapshot: { name: "Valami Kft.", taxNumber: "  " },
        customer: { type: "PERSON", partner: null },
      }),
    ]);
    assert.equal(finding!.buyerName, "Valami Kft.");
  });

  it("a lekérdezés csak a kiállított, vevőhöz kötött, nem sztornó számlákat kéri", () => {
    const from = new Date("2026-11-02T23:00:00.000Z");
    const to = new Date("2026-11-03T23:00:00.000Z");
    assert.deepEqual(buyerTaxCheckWhere(from, to), {
      status: "ISSUED",
      documentType: { not: "STORNO" },
      customerId: { not: null },
      issueDate: { gte: from, lt: to },
    });
  });
});

describe("a naplósor, amit a flotta keres", () => {
  const finding = (n: number): BuyerTaxFinding => ({
    invoiceNumber: `ACRW-2026/${String(n).padStart(5, "0")}`,
    issueDate: null,
    buyerName: "x",
    problem: "y",
  });

  it("nulla, találat, levágott lista és hiba: mindig egy sor, ugyanazzal a fejjel", () => {
    assert.equal(
      buyerTaxCheckLine("2026-11-03", { ok: true, findings: [] }),
      "ADOSZAM-ELLENORZES datum=2026-11-03 talalat=0",
    );
    assert.equal(
      buyerTaxCheckLine("2026-11-03", {
        ok: true,
        findings: [finding(510), finding(511)],
      }),
      "ADOSZAM-ELLENORZES datum=2026-11-03 talalat=2 szamlak=ACRW-2026/00510,ACRW-2026/00511",
    );
    const many = Array.from({ length: 23 }, (_, i) => finding(i + 1));
    const line = buyerTaxCheckLine("2026-11-03", { ok: true, findings: many });
    assert.match(
      line,
      /^ADOSZAM-ELLENORZES datum=2026-11-03 talalat=23 szamlak=/,
    );
    assert.match(line, /ACRW-2026\/00020 \(\+3\)$/);
    assert.equal(
      buyerTaxCheckLine("2026-11-03", { ok: false, reason: "TypeError" }),
      "ADOSZAM-ELLENORZES datum=2026-11-03 HIBA ok=TypeError",
    );
  });

  it("a hiba oka a típus neve, nem a szövege", () => {
    assert.equal(
      buyerTaxCheckReason(new TypeError("titkos vevő neve")),
      "TypeError",
    );
    assert.equal(buyerTaxCheckReason("x"), "ismeretlen");
  });
});

describe("a napi futás", () => {
  const scheduler = (issuedBetween: BuyerTaxCheckRepository["issuedBetween"]) =>
    new BuyerTaxCheckScheduler({ issuedBetween } as BuyerTaxCheckRepository);

  it("az előző budapesti napot nézi, és a találatot írja", async () => {
    const asked: [string, string][] = [];
    const line = await scheduler(async (from, to) => {
      asked.push([from.toISOString(), to.toISOString()]);
      return [row()];
    }).runOnce(new Date("2026-11-04T05:00:00.000Z"));
    // Budapest is UTC+1 in November: the day of 2026-11-03 is [11-02 23:00Z, 11-03 23:00Z)
    assert.deepEqual(asked, [
      ["2026-11-02T23:00:00.000Z", "2026-11-03T23:00:00.000Z"],
    ]);
    assert.equal(
      line,
      "ADOSZAM-ELLENORZES datum=2026-11-03 talalat=1 szamlak=ACRW-2026/00510",
    );
  });

  it("a hibás futás is sort ír, és nem dob", async () => {
    const line = await scheduler(async () => {
      throw new RangeError("adatbázis");
    }).runOnce(new Date("2026-11-04T05:00:00.000Z"));
    assert.equal(
      line,
      "ADOSZAM-ELLENORZES datum=2026-11-03 HIBA ok=RangeError",
    );
  });

  it("hat után induló API egyszer pótolja az előző napot (barracuda, #2159)", () => {
    // 05:59 and 06:00 Budapest in November (UTC+1)
    assert.equal(catchUpOnStart(new Date("2026-11-04T04:59:00.000Z")), false);
    assert.equal(catchUpOnStart(new Date("2026-11-04T05:00:00.000Z")), true);
    assert.equal(catchUpOnStart(new Date("2026-11-04T22:30:00.000Z")), true);
  });

  it("budapesti reggel hatkor indul, alapból bekapcsolva", () => {
    // 05:00 Budapest (04:00Z) -> one hour; 07:00 Budapest (06:00Z) -> 23 hours
    assert.equal(
      delayUntilNextRun(new Date("2026-11-04T04:00:00.000Z")),
      3_600_000,
    );
    assert.equal(
      delayUntilNextRun(new Date("2026-11-04T06:00:00.000Z")),
      23 * 3_600_000,
    );
    assert.equal(buyerTaxCheckEnabled({}), true);
    assert.equal(
      buyerTaxCheckEnabled({ BUYER_TAX_CHECK_ENABLED: "false" }),
      false,
    );
  });
});
