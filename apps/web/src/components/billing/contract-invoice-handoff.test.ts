import { describe, expect, it } from "vitest";

import { contractItemRemovalBlocker } from "@/components/contracts/pilot/contract-items";

import { contractInvoiceHandoffLines } from "./contract-invoice-handoff";

// Feladat d510: a „Számla” gomb csak a maradékot adja át, tételenként a
// hivatkozással. MI PIROSÍT: a teljesen számlázott tétel bekerül; a maradék
// helyett a szerződéses mennyiség megy; összesítő nélkül (régi API) eltűnik a
// tétel; a sorról lemarad a tétel-hivatkozás; egy számlázott tétel törölhető.
const items = [
  {
    id: "a",
    description: "Szivattyú",
    quantity: "3",
    unitNet: "1000",
    vatRatePercent: "27",
    unitOfMeasure: { code: "db" },
  },
  {
    id: "b",
    description: "Só",
    quantity: "2",
    unitNet: "500",
    vatRatePercent: "27",
    unitOfMeasure: null,
  },
];

describe("contractInvoiceHandoffLines", () => {
  it("HANDOFF-REMAINDER: the remainder per item, a fully invoiced item left out, each line with its item", () => {
    const lines = contractInvoiceHandoffLines(items, {
      state: "PARTIAL",
      items: [
        {
          contractItemId: "a",
          quantity: "3",
          invoicedQuantity: "1",
          remainingQuantity: "2",
          overInvoiced: false,
        },
        {
          contractItemId: "b",
          quantity: "2",
          invoicedQuantity: "2",
          remainingQuantity: "0",
          overInvoiced: false,
        },
      ],
    });
    expect(lines).toEqual([
      {
        contractItemId: "a",
        description: "Szivattyú",
        quantity: "2",
        unit: "db",
        unitNet: "1000",
        vatRatePercent: "27",
      },
    ]);
  });

  it("HANDOFF-NO-SUMMARY: an API without the summary keeps the full quantities, with the item link", () => {
    expect(
      contractInvoiceHandoffLines(items, undefined).map((l) => [
        l.contractItemId,
        l.quantity,
        l.unit,
      ]),
    ).toEqual([
      ["a", "3", "db"],
      ["b", "2", "db"],
    ]);
  });
});

describe("contractItemRemovalBlocker", () => {
  it("ITEM-INVOICED: an invoiced item cannot be removed; an order still wins the message", () => {
    expect([
      contractItemRemovalBlocker("a", new Set(), new Set(["a"])),
      contractItemRemovalBlocker("a", new Set(["a"]), new Set(["a"])),
      contractItemRemovalBlocker("b", new Set(), new Set(["a"])),
    ]).toEqual([
      "Ehhez a tételhez már készült számla, ezért nem törölhető.",
      "Ehhez a tételhez már készült megrendelőlap, ezért nem törölhető.",
      null,
    ]);
  });
});
