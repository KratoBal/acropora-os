import type { BillingDocumentDetail } from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  billingPreview,
  effectiveFormat,
  emptyLine,
  formatMoney,
  fromDetail,
  hiddenFilledFields,
  missingForSave,
  newEditorState,
  toDraftInput,
  trimDecimal,
  type EditorState,
} from "./billing-editor-state";

/**
 * A SZÁMLÁZÁSI SZERKESZTŐ ÁLLAPOTA (brief 4-7., 10., 23. pont): alapértékek,
 * a típus szerinti formátum, a típusváltás adatvesztés nélkül, és a mentés
 * törzse, amiben a rejtett mező és az összeg nem megy el.
 */
function state(overrides: Partial<EditorState> = {}): EditorState {
  return {
    ...newEditorState({ id: "draft-1", today: "2026-09-30" }),
    customer: {
      id: "cust-1",
      name: "Állatkert",
      address: null,
      taxNumber: null,
      euTaxNumber: null,
      contactName: null,
      email: "szamlazas@partner.hu",
      internalCode: "V-1",
    },
    lines: [
      emptyLine({
        description: "Munkadíj",
        unitNet: "280000",
        comment: "Szeptember",
      }),
    ],
    ...overrides,
  };
}

describe("billing editor state", () => {
  it("defaults: invoice, e-invoice, due eight days after fulfilment, bank transfer", () => {
    const fresh = newEditorState({ id: "d", today: "2026-09-30" });
    expect([
      fresh.documentType,
      effectiveFormat(fresh),
      fresh.fulfillmentDate,
      fresh.dueDate,
      fresh.paymentMethod,
      fresh.currency,
    ]).toEqual([
      "INVOICE",
      "ELECTRONIC",
      "2026-09-30",
      "2026-10-08",
      "Átutalás",
      "HUF",
    ]);
  });

  it("the format follows the type: none for a proforma, the chosen one back on an invoice", () => {
    const paper = state({ preferredFormat: "PAPER" });
    expect(effectiveFormat({ ...paper, documentType: "PROFORMA" })).toBeNull();
    expect(effectiveFormat({ ...paper, documentType: "INVOICE" })).toBe(
      "PAPER",
    );
  });

  /*
    A TÍPUSVÁLTÁS NEM TÖRÖL (brief 23. pont). MI PIROSÍT: ha a szállítólevél
    elküldené a fizetési mezőket, vagy ha a visszaváltás után elvesznének.
  */
  it("a delivery note hides the payment fields from the save, but keeps them for switching back", () => {
    const note = { ...state(), documentType: "DELIVERY_NOTE" as const };
    const input = toDraftInput(note, "create");
    expect([input.dueDate, input.paymentMethod, input.invoiceFormat]).toEqual([
      null,
      null,
      null,
    ]);
    expect(hiddenFilledFields(note)).toEqual([
      "fizetési határidő",
      "fizetési mód",
    ]);
    const back = toDraftInput({ ...note, documentType: "INVOICE" }, "create");
    expect([back.dueDate, back.paymentMethod]).toEqual([
      "2026-10-08",
      "Átutalás",
    ]);
    expect(input.lines[0]!.comment).toBe("Szeptember");
  });

  it("the save body: the client id on create, the timestamp on update, no amounts", () => {
    const create = toDraftInput(state(), "create");
    expect(create.id).toBe("draft-1");
    expect(create).not.toHaveProperty("expectedUpdatedAt");
    const update = toDraftInput(
      state({ savedUpdatedAt: "2026-09-30T10:00:00.000Z" }),
      "update",
    );
    expect(update.expectedUpdatedAt).toBe("2026-09-30T10:00:00.000Z");
    expect(update).not.toHaveProperty("id");
    expect(JSON.stringify(create)).not.toMatch(/Amount|total/i);
  });

  it("loading folds the discount line back into its item", () => {
    const detail = {
      id: "d1",
      status: "DRAFT",
      emailStatus: "PENDING",
      documentNumber: null,
      documentType: "INVOICE",
      invoiceFormat: "PAPER",
      customer: null,
      fulfillmentDate: "2026-09-30",
      dueDate: null,
      paymentMethod: null,
      currency: "HUF",
      language: "hu",
      reference: null,
      note: null,
      sourceType: "MANUAL",
      sourceId: null,
      lines: [
        {
          id: "l1",
          kind: "ITEM",
          parentLineId: null,
          productId: null,
          description: "Munkadíj",
          quantity: "2.000000",
          unit: "óra",
          unitNet: "10000.0000",
          vatRatePercent: "27.00",
          discountPercent: "10.00",
          netAmount: "20000.0000",
          vatAmount: "5400.0000",
          grossAmount: "25400.0000",
          comment: "Helyszín",
        },
        {
          id: "l2",
          kind: "DISCOUNT",
          parentLineId: "l1",
          productId: null,
          description: "Kedvezmény (10%)",
          quantity: "1.000000",
          unit: null,
          unitNet: "-2000.0000",
          vatRatePercent: "27.00",
          discountPercent: "10.00",
          netAmount: "-2000.0000",
          vatAmount: "-540.0000",
          grossAmount: "-2540.0000",
          comment: null,
        },
      ],
      totals: {
        netAmount: "18000.0000",
        vatAmount: "4860.0000",
        grossAmount: "22860.0000",
        byVatRate: [],
      },
      createdAt: "2026-09-30T10:00:00.000Z",
      updatedAt: "2026-09-30T10:05:00.000Z",
    } as BillingDocumentDetail;
    const loaded = fromDetail(detail);
    expect(loaded.lines).toHaveLength(1);
    expect(loaded.lines[0]).toMatchObject({
      id: "l1",
      quantity: "2",
      unitNet: "10000",
      vatRatePercent: "27",
      discountPercent: "10",
      comment: "Helyszín",
    });
    expect([loaded.savedUpdatedAt, loaded.preferredFormat]).toEqual([
      "2026-09-30T10:05:00.000Z",
      "PAPER",
    ]);
  });

  it("names what is missing for a save", () => {
    expect(missingForSave(state({ customer: null, lines: [] }))).toEqual([
      "partner",
      "legalább egy tétel",
    ]);
    expect(missingForSave(state())).toEqual([]);
  });

  it("formats forint without decimals and other currencies with two", () => {
    expect(formatMoney("485140.0000", "HUF").replace(/\s/g, " ")).toBe(
      "485 140 Ft",
    );
    expect(formatMoney("12.5000", "EUR").replace(/\s/g, " ")).toBe("12,50 EUR");
    expect(trimDecimal("-0.0000")).toBe("0");
  });

  /*
    A VÉGÖSSZEG A SZÁMLÁZZ.HU SZABÁLYÁVAL (#1275, nautilus mérései): tételenként
    kerekített bruttó, a forint egészre. Két 2350,40 Ft-os sor 4700 Ft, nem
    4701 (az összeg kerekítése azt adná). MI PIROSÍT: ha a felület a 4
    tizedesjegyes összeget mutatná, vagy az összeget egyben kerekítené.
  */
  it("the preview totals follow the Számlázz.hu rule: per-line rounding in forint", () => {
    const preview = billingPreview(
      state({
        lines: [
          emptyLine({ description: "A", unitNet: "1850.71" }),
          emptyLine({ description: "B", unitNet: "1850.71" }),
        ],
      }),
    )!;
    expect(preview.lines[0]!.item.grossAmount).toBe("2350.40");
    expect(preview.totals.grossAmount).toBe("4700");
    expect(preview.byVatRate).toEqual([
      {
        vatRatePercent: "27",
        netAmount: preview.totals.netAmount,
        vatAmount: preview.totals.vatAmount,
        grossAmount: "4700",
        zeroForintLines: [],
      },
    ]);
  });

  it("names a line that rounds to 0 Ft, instead of losing it", () => {
    const preview = billingPreview(
      state({
        lines: [
          emptyLine({ description: "A", unitNet: "1000" }),
          emptyLine({ description: "B", unitNet: "0.16" }),
        ],
      }),
    )!;
    expect(preview.zeroForintLines).toEqual([1]);
  });

  it("the discount goes as its own line: quantity 1, the negative net", () => {
    const preview = billingPreview(
      state({
        lines: [
          emptyLine({
            description: "A",
            quantity: "2",
            unitNet: "30000",
            discountPercent: "10",
          }),
        ],
      }),
    )!;
    expect(preview.lines[0]!.discount).toEqual({
      ok: true,
      netAmount: "-6000.00",
      vatAmount: "-1620.00",
      grossAmount: "-7620.00",
    });
    expect(preview.totals.grossAmount).toBe("68580");
  });
});
