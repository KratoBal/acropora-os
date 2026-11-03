import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  IncomingDocumentListItem,
  OutgoingDocumentListItem,
} from "./types";
import {
  externalDetailView,
  formatDay,
  incomingDetailView,
  incomingRow,
  isDocumentKind,
  outgoingRow,
  ownDetailView,
} from "./presentation";

/*
  A SZÁMLÁK SORAI TELEFONON (Balázs, 2026-11-03, kártya 050e138b), csak olvasásra. MI PIROSÍT: ha egy vázlat vagy egy
  ellenőrizendő bejövő sor megnyitható lenne (az írás, a weben marad); ha egy kiállított sor rossz adatlapra nyitna (a
  külső bizonylat a saját helyett); ha a sztornózott számla fizetési állapotot mutatna; ha a dátum nem magyar alakú.
*/
const kimeno = (patch: Partial<OutgoingDocumentListItem> = {}) =>
  ({
    id: "inv-1",
    documentType: "INVOICE",
    documentNumber: "ACRW-2026/00512",
    customerName: "Fővárosi Állat- és Növénykert",
    issueDate: "2026-11-03",
    dueDate: "2026-11-11",
    grossAmount: "485140",
    currency: "HUF",
    status: "ISSUED",
    opens: "DETAIL",
    externalKindLabel: null,
    paymentState: "UNPAID",
    ...patch,
  }) satisfies OutgoingDocumentListItem;

const bejovo = (patch: Partial<IncomingDocumentListItem> = {}) =>
  ({
    id: "in-1",
    origin: "SZAMLAZZ",
    documentNumber: "TS-2026-118",
    kindLabel: "Számla",
    cancelled: false,
    supplierName: "Tropic Marin",
    issueDate: "2026-10-30",
    dueDate: null,
    currency: "EUR",
    grossAmount: "1100.70",
    paymentState: "PAID",
    review: null,
    hasPdf: true,
    ...patch,
  }) satisfies IncomingDocumentListItem;

describe("a kimenő számla sora", () => {
  it("a kiállított saját számla a saját adatlapra nyit, a fizetési állapottal", () => {
    const row = outgoingRow(kimeno());
    assert.equal(row.opens, "own");
    assert.equal(row.title, "ACRW-2026/00512");
    assert.equal(row.meta, "Számla · 2026. 11. 03.");
    assert.deepEqual(row.badge, { label: "Nincs fizetve", tone: "danger" });
    assert.equal(row.closedReason, null);
  });

  it("a külső bizonylat a külső adatlapra nyit, a saját típusfeliratával", () => {
    const row = outgoingRow(
      kimeno({ opens: "EXTERNAL_DETAIL", externalKindLabel: "Sztornó számla" }),
    );
    assert.equal(row.opens, "external");
    assert.match(row.meta, /^Sztornó számla · /);
  });

  it("a vázlat nem nyitható, és kimondja, miért", () => {
    const row = outgoingRow(
      kimeno({
        opens: "EDITOR",
        status: "DRAFT",
        documentNumber: null,
        documentType: "PROFORMA",
        issueDate: null,
        paymentState: null,
      }),
    );
    assert.equal(row.opens, null);
    assert.equal(row.title, "Díjbekérő (piszkozat)");
    assert.equal(row.meta, "Díjbekérő · nincs");
    assert.deepEqual(row.badge, { label: "Piszkozat", tone: "neutral" });
    assert.match(row.closedReason ?? "", /weben/);
  });

  it("a sztornózott számla nem mutat fizetési állapotot", () => {
    assert.deepEqual(outgoingRow(kimeno({ cancelled: true })).badge, {
      label: "Sztornózva",
      tone: "neutral",
    });
  });
});

describe("a bejövő számla sora", () => {
  it("a rendes sor a bejövő adatlapra nyit", () => {
    const row = incomingRow(bejovo());
    assert.equal(row.opens, "incoming");
    assert.equal(row.partner, "Tropic Marin");
    assert.deepEqual(row.badge, { label: "Fizetve", tone: "success" });
  });

  it("az ellenőrizendő sor nem nyitható (a jóváhagyás a weben marad)", () => {
    const row = incomingRow(bejovo({ origin: "MAILBOX", review: "TO_REVIEW" }));
    assert.equal(row.opens, null);
    assert.deepEqual(row.badge, { label: "Ellenőrizendő", tone: "warning" });
    assert.match(row.closedReason ?? "", /weben/);
  });

  it("a név és az összeg hiányát kimondja, nem üres", () => {
    const row = incomingRow(bejovo({ supplierName: "", grossAmount: null }));
    assert.equal(row.partner, "név nélkül");
    assert.equal(row.amount, "nincs összeg");
  });
});

describe("a dátum és az útvonal-paraméter", () => {
  it("a dátum magyar alakú, a hiányzó „nincs”", () => {
    assert.equal(formatDay("2026-11-03"), "2026. 11. 03.");
    assert.equal(formatDay("2026-11-03T10:00:00.000Z"), "2026. 11. 03.");
    assert.equal(formatDay(null), "nincs");
    assert.equal(formatDay("11/03/2026"), "nincs");
  });

  it("csak a három ismert adatlap-fajtát fogadja el", () => {
    for (const kind of ["own", "external", "incoming"])
      assert.equal(isDocumentKind(kind), true, kind);
    for (const kind of ["", "EDITOR", "draft", undefined, ["own"]])
      assert.equal(isDocumentKind(kind), false, String(kind));
  });
});

/*
  AZ ADATLAP EGY ALAKBAN (kártya 050e138b). MI PIROSÍT: ha a bejövőn a partner „Vevő” lenne (a szállító helyett); ha a
  PDF-gomb ott is megjelenne, ahol a szerver szerint nincs PDF; ha a kedvezmény-sor tételnek látszana; ha az összesítő
  nem a bizonylat pénznemében állna.
*/
describe("az adatlap nézete", () => {
  it("a saját számla: vevő, tételek, összesítő, a PDF a szerver szerint", () => {
    const view = ownDetailView({
      id: "inv-1",
      status: "ISSUED",
      documentNumber: "ACRW-2026/00512",
      documentType: "INVOICE",
      customer: { name: "FANK", address: "1146 Budapest", taxNumber: "1-2-3" },
      fulfillmentDate: "2026-11-03",
      dueDate: "2026-11-11",
      paymentMethod: "átutalás",
      currency: "HUF",
      issueDate: "2026-11-03",
      lines: [
        {
          id: "l1",
          kind: "ITEM",
          description: "Szivattyú",
          quantity: "2",
          unit: "db",
          grossAmount: "254000",
        },
        {
          id: "l2",
          kind: "DISCOUNT",
          description: "törzsvevő",
          quantity: "1",
          unit: null,
          grossAmount: "-12700",
        },
      ],
      totals: {
        netAmount: "190000",
        vatAmount: "51300",
        grossAmount: "241300",
      },
      pdf: { available: false },
    });
    assert.equal(view.partnerLabel, "Vevő");
    assert.equal(view.title, "ACRW-2026/00512");
    assert.equal(view.lines[0]?.quantity, "2 db");
    assert.match(view.lines[1]?.name ?? "", /^Kedvezmény: /);
    assert.equal(view.pdfAvailable, false);
    assert.deepEqual(
      view.totals.map((t) => t.label),
      ["Nettó", "ÁFA", "Bruttó"],
    );
    assert.match(view.totals[2]?.value ?? "", /241/);
    assert.deepEqual(view.facts[0], { label: "Kelt", value: "2026. 11. 03." });
  });

  it("a bejövő számla: szállító, a fizetési állapot, a PDF a hasPdf szerint", () => {
    const view = incomingDetailView({
      id: "in-1",
      documentNumber: "TS-2026-118",
      kindLabel: "Számla",
      cancelled: false,
      issueDate: "2026-10-30",
      fulfillmentDate: null,
      dueDate: "2026-11-15",
      paymentMethod: null,
      currency: "EUR",
      netAmount: "866.69",
      vatAmount: "234.01",
      grossAmount: "1100.70",
      paymentState: "PARTIAL",
      supplier: { name: "Tropic Marin", address: null, taxNumber: null },
      lines: [
        {
          name: "Pro Reef Salt",
          quantity: "4",
          unit: "zsák",
          grossAmount: "1100.70",
        },
      ],
      hasPdf: true,
    });
    assert.equal(view.partnerLabel, "Szállító");
    assert.equal(view.partnerName, "Tropic Marin");
    assert.deepEqual(view.badge, { label: "Részben fizetve", tone: "warning" });
    assert.equal(view.pdfAvailable, true);
    assert.deepEqual(view.facts[3], { label: "Fizetési mód", value: "nincs" });
  });

  it("a külső bizonylat: a sztornó jelzés elnyomja a fizetési állapotot", () => {
    const view = externalDetailView({
      id: "ext-1",
      pdfAvailable: false,
      kindLabel: "Sztornó számla",
      documentNumber: "SZ-2026-77",
      issueDate: "2026-10-01",
      fulfillmentDate: null,
      dueDate: null,
      paymentMethod: "kártya",
      currency: "HUF",
      customer: { name: "", taxNumber: null, address: null },
      lines: [],
      totals: { netAmount: "0", vatAmount: "0", grossAmount: "0" },
      cancelled: true,
      paymentState: "PAID",
    });
    assert.deepEqual(view.badge, { label: "Sztornózva", tone: "neutral" });
    assert.equal(view.partnerName, "név nélkül");
    assert.equal(view.typeLabel, "Sztornó számla");
  });
});
