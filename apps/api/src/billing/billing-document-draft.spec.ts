import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BillingDocumentDraftInput } from "@acropora/types";

import { normalizeBillingDraft } from "./billing-document-draft.js";

/**
 * A SZÁMLÁZÁSI VÁZLAT NORMALIZÁLÁSA (brief 3., 5., 10., 13-15., 32. pont):
 * a formátum a típus képessége szerint, az összeg a szerveren, a kedvezmény
 * külön negatív sor, a tételmegjegyzés megmarad.
 */
function input(
  overrides: Partial<BillingDocumentDraftInput> = {},
): BillingDocumentDraftInput {
  return {
    documentType: "INVOICE",
    invoiceFormat: "ELECTRONIC",
    customerId: "cust-1",
    fulfillmentDate: "2026-09-30",
    dueDate: "2026-10-08",
    paymentMethod: "Átutalás",
    currency: "huf",
    language: "HU",
    reference: " PROJ-0268 ",
    note: "",
    sourceType: null,
    sourceId: null,
    lines: [
      {
        productId: null,
        description: "Karbantartási munkadíj",
        quantity: "1",
        unit: "db",
        unitNet: "280000",
        vatRatePercent: "27",
        discountPercent: null,
        comment: "Szeptember havi átalány",
      },
    ],
    ...overrides,
  };
}

let counter = 0;
const newId = () => `id-${++counter}`;

function ok(value: BillingDocumentDraftInput) {
  const result = normalizeBillingDraft(value, newId);
  assert.ok(result.ok, JSON.stringify(result));
  return result.draft;
}

describe("normalizeBillingDraft", () => {
  it("számla e-számlaként: a kiküldés a kiállítás része, az összeget a szerver számolja", () => {
    const draft = ok(input());
    assert.equal(draft.invoiceFormat, "ELECTRONIC");
    assert.equal(draft.emailStatus, "PENDING");
    assert.equal(draft.grossAmount, "355600.0000");
    assert.equal(draft.lines[0]!.grossAmount, "355600.0000");
    assert.equal(draft.currency, "HUF");
    assert.equal(draft.language, "hu");
    assert.equal(draft.reference, "PROJ-0268");
    assert.equal(draft.note, null);
    assert.equal(draft.sourceType, "MANUAL");
  });

  it("papír számlánál a kiküldés nem kötelező", () => {
    assert.equal(
      ok(input({ invoiceFormat: "PAPER" })).emailStatus,
      "NOT_REQUIRED",
    );
  });

  /*
    A FORMÁTUM A TÍPUS KÉPESSÉGE SZERINT. MI PIROSÍT: ha a díjbekérőre küldött
    e-számla jelző csendben elesne (vagy átmenne), vagy ha a számla formátum
    nélkül is elmenne (brief 32. pont).
  */
  it("díjbekérőre küldött formátum hiba, számla formátum nélkül is hiba", () => {
    const proforma = normalizeBillingDraft(
      input({ documentType: "PROFORMA", invoiceFormat: "ELECTRONIC" }),
      newId,
    );
    assert.equal(proforma.ok, false);
    const invoice = normalizeBillingDraft(
      input({ invoiceFormat: null }),
      newId,
    );
    assert.equal(invoice.ok, false);
    assert.equal(
      ok(input({ documentType: "PROFORMA", invoiceFormat: null }))
        .invoiceFormat,
      null,
    );
  });

  it("szállítólevélnél a fizetési mezők nem tárolódnak, és nincs kiküldés", () => {
    const draft = ok(
      input({ documentType: "DELIVERY_NOTE", invoiceFormat: null }),
    );
    assert.equal(draft.dueDate, null);
    assert.equal(draft.paymentMethod, null);
    assert.equal(draft.emailStatus, "NOT_REQUIRED");
  });

  it("a kedvezmény külön negatív sor, közvetlenül a tétele alatt", () => {
    const draft = ok(
      input({
        lines: [
          { ...input().lines[0]!, id: "item-a", discountPercent: "10" },
          { ...input().lines[0]!, description: "Második", comment: " " },
        ],
      }),
    );
    assert.deepEqual(
      draft.lines.map((line) => [
        line.kind,
        line.position,
        line.parentLineId,
        line.netAmount,
      ]),
      [
        ["ITEM", 1, null, "280000.0000"],
        ["DISCOUNT", 2, "item-a", "-28000.0000"],
        ["ITEM", 3, null, "280000.0000"],
      ],
    );
    assert.equal(draft.lines[1]!.description, "Kedvezmény (10%)");
    assert.equal(draft.netAmount, "532000.0000");
  });

  it("a tételmegjegyzés megmarad, az üres megjegyzés null", () => {
    const draft = ok(
      input({
        lines: [input().lines[0]!, { ...input().lines[0]!, comment: "   " }],
      }),
    );
    assert.deepEqual(
      draft.lines.map((line) => line.comment),
      ["Szeptember havi átalány", null],
    );
  });

  it("a hibás összeg-mezőt a tétel sorszámával nevezi meg", () => {
    const result = normalizeBillingDraft(
      input({
        lines: [
          input().lines[0]!,
          { ...input().lines[0]!, quantity: "1.1234567" },
        ],
      }),
      newId,
    );
    assert.ok(!result.ok);
    assert.equal(
      result.error.message,
      "A(z) 2. tétel mennyiség mezője túl sok tizedesjegyet tartalmaz.",
    );
  });
});
