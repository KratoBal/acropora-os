import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MissingInvoiceItem } from "@acropora/types";

import { sortMissingInvoiceItems } from "./missing-invoice-sort.js";

/**
 * A HIÁNYZÓ SZÁMLÁK RENDEZÉSE (Balázs, 2026-11-02 12:49 UTC). MI PIROSÍT: ha az
 * összeg szövegként rendezne (a „900” az „11 000” előtt állna); ha a név az
 * ékezetet a „Z” utánra tenné, vagy az „Ö”-t az „O” elé; ha az üres érték
 * csökkenő sorrendben az elejére kerülne; ha a rendezés a lista addigi
 * sorrendjét egyenlő kulcsnál összekeverné (a lapozás két kérésen át mást adna);
 * ha a megadott mező nélkül a sorrend változna.
 */
let n = 0;
const item = (over: Partial<MissingInvoiceItem> = {}): MissingInvoiceItem => ({
  id: `i${++n}`,
  bookingDate: "2026-08-10",
  account: { id: "acc", name: "Fő számla" },
  partner: "Szállító Kft.",
  narrative: "",
  amount: "1000",
  currency: "HUF",
  original: null,
  category: "DOMESTIC_SUPPLIER",
  categoryRule: "",
  categoryOverridden: false,
  state: "FOUND",
  document: { id: "d", number: "SZ-1", source: "NAV" },
  matchedBy: "RULE",
  documentNumbers: [],
  missingNumbers: [],
  amountDifference: null,
  refund: null,
  comment: null,
  paperOriginal: false,
  ...over,
});
const ids = (items: readonly MissingInvoiceItem[]) => items.map((i) => i.id);

describe("sorting the missing invoices list", () => {
  it("date: chronological, both ways, the same day keeps the list's order", () => {
    const a = item({ bookingDate: "2026-08-20" });
    const b = item({ bookingDate: "2026-08-03" });
    const c = item({ bookingDate: "2026-08-20" });
    assert.deepEqual(ids(sortMissingInvoiceItems([a, b, c], "date", "asc")), [
      b.id,
      a.id,
      c.id,
    ]);
    assert.deepEqual(ids(sortMissingInvoiceItems([a, b, c], "date", "desc")), [
      a.id,
      c.id,
      b.id,
    ]);
  });

  it("amount: as a number, not as text (900 before 11 000, and a decimal amount in place)", () => {
    const a = item({ amount: "11000" });
    const b = item({ amount: "900" });
    const c = item({ amount: "1234.50", currency: "EUR" });
    assert.deepEqual(ids(sortMissingInvoiceItems([a, b, c], "amount", "asc")), [
      b.id,
      c.id,
      a.id,
    ]);
    assert.deepEqual(
      ids(sortMissingInvoiceItems([a, b, c], "amount", "desc")),
      [a.id, c.id, b.id],
    );
  });

  it("amount: decimals compare as numbers (10.25 before 10.5, where a text or digit-group comparison says the opposite)", () => {
    const a = item({ amount: "10.5", currency: "EUR" });
    const b = item({ amount: "10.25", currency: "EUR" });
    const c = item({ amount: "9.99", currency: "EUR" });
    assert.deepEqual(ids(sortMissingInvoiceItems([a, b, c], "amount", "asc")), [
      c.id,
      b.id,
      a.id,
    ]);
  });

  it("partner: Hungarian alphabet with the accents in place (á after a, cs after c, ö after o)", () => {
    const names = [
      "Zsolt Bt.",
      "Árpád Kft.",
      "Aladár Kft.",
      "Ödön Bt.",
      "Olga Kft.",
      "Csaba Kft.",
      "Cecília Kft.",
    ];
    const items = names.map((partner) => item({ partner }));
    const sorted = sortMissingInvoiceItems(items, "partner", "asc").map(
      (i) => i.partner,
    );
    assert.deepEqual(sorted, [
      "Aladár Kft.",
      "Árpád Kft.",
      "Cecília Kft.",
      "Csaba Kft.",
      "Olga Kft.",
      "Ödön Bt.",
      "Zsolt Bt.",
    ]);
    const desc = sortMissingInvoiceItems(items, "partner", "desc").map(
      (i) => i.partner,
    );
    assert.deepEqual(desc, [...sorted].reverse());
  });

  it("an empty value is last in both directions (no partner, no document)", () => {
    const none = item({ partner: null, document: null });
    const blank = item({ partner: "  ", document: null });
    const a = item({
      partner: "Béla Kft.",
      document: { id: "d", number: "B-2", source: "MAILBOX" },
    });
    const b = item({
      partner: "Ági Kft.",
      document: { id: "d", number: "A-1", source: "NAV" },
    });
    for (const direction of ["asc", "desc"] as const) {
      const byPartner = sortMissingInvoiceItems(
        [none, a, blank, b],
        "partner",
        direction,
      );
      assert.deepEqual(
        ids(byPartner.slice(2)),
        [none.id, blank.id],
        `partner ${direction}`,
      );
      const byInvoice = sortMissingInvoiceItems(
        [none, a, blank, b],
        "invoice",
        direction,
      );
      assert.deepEqual(
        ids(byInvoice.slice(2)),
        [none.id, blank.id],
        `invoice ${direction}`,
      );
      const bySource = sortMissingInvoiceItems(
        [none, a, blank, b],
        "source",
        direction,
      );
      assert.deepEqual(
        ids(bySource.slice(2)),
        [none.id, blank.id],
        `source ${direction}`,
      );
    }
  });

  it("state, category and source sort by the word on the screen, not by the English key", () => {
    const found = item({ state: "FOUND" }); // Megvan
    const noInvoice = item({ state: "NO_INVOICE" }); // Nincs számla
    const original = item({ state: "ORIGINAL_MISSING" }); // Eredeti hiányzik
    assert.deepEqual(
      ids(
        sortMissingInvoiceItems([found, noInvoice, original], "state", "asc"),
      ),
      [original.id, found.id, noInvoice.id],
    );
    const tax = item({ category: "TAX" }); // Adó
    const domestic = item({ category: "DOMESTIC_SUPPLIER" }); // Magyar szállító
    const foreign = item({ category: "FOREIGN_SUPPLIER" }); // Külföldi szállító
    assert.deepEqual(
      ids(sortMissingInvoiceItems([domestic, tax, foreign], "category", "asc")),
      [tax.id, foreign.id, domestic.id],
    );
    const mailbox = item({
      document: { id: "d", number: "x", source: "MAILBOX" },
    }); // Postafiók
    const nav = item({ document: { id: "d", number: "y", source: "NAV" } }); // NAV
    assert.deepEqual(
      ids(sortMissingInvoiceItems([mailbox, nav], "source", "asc")),
      [nav.id, mailbox.id],
    );
  });

  it("invoice numbers: the digits count as numbers (INV-2 before INV-10)", () => {
    const a = item({ document: { id: "d", number: "INV-10", source: "NAV" } });
    const b = item({ document: { id: "d", number: "INV-2", source: "NAV" } });
    assert.deepEqual(ids(sortMissingInvoiceItems([a, b], "invoice", "asc")), [
      b.id,
      a.id,
    ]);
  });

  it("no field: the list's order stays; the input is not changed", () => {
    const list = [
      item({ amount: "5" }),
      item({ amount: "1" }),
      item({ amount: "3" }),
    ];
    const before = ids(list);
    assert.deepEqual(
      ids(sortMissingInvoiceItems(list, undefined, "desc")),
      before,
    );
    sortMissingInvoiceItems(list, "amount", "asc");
    assert.deepEqual(ids(list), before);
  });

  it("the sort covers the whole set, not a page: the largest amount is first, wherever it stood", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      item({ amount: String(100 + i) }),
    );
    const biggest = item({ amount: "999999" });
    const all = [...rows, biggest]; // on a page 3 of 25, in the list's own order
    const sorted = sortMissingInvoiceItems(all, "amount", "desc");
    assert.equal(sorted[0]!.id, biggest.id);
    assert.deepEqual(ids(sorted.slice(0, 25)).includes(biggest.id), true);
  });
});
