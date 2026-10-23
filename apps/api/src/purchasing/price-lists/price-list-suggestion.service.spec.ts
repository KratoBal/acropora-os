import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import type { NameCandidate, NameSuggestion } from "./name-suggestions.js";
import type { PriceListSuggestionRepository } from "./price-list-suggestion.repository.js";
import { PriceListSuggestionService } from "./price-list-suggestion.service.js";

/**
 * A NÉV ALAPÚ JAVASLATOK SZOLGÁLTATÁSA (task arlista-nev-javaslat). Kitalált
 * termékek. MI PIROSÍT: ha a kötés nélküli sorokon kívül mások is kapnának
 * javaslatot; ha a mentés nem a lista beszállítójához történne; ha a kötött vagy
 * elutasított cikkszám újra javaslatot kapna; ha egy nem létező listára hibát
 * helyett csendes nulla jönne; ha a megjelenítés a lista sorának (legfrissebb)
 * adatait vagy a pontszámot összekeverné; ha a döntésnél egy azonosító kétszer
 * számolódna.
 */
const CANDIDATES: NameCandidate[] = [
  {
    variantId: "v1",
    name: "Exbrand Reef Salt tengeri só 2kg",
    brand: "Exbrand",
  },
  {
    variantId: "v2",
    name: "Exbrand Reef Salt tengeri só 500g",
    brand: "Exbrand",
  },
];

function setup(options: {
  list?: { id: string; supplierId: string } | null;
  unmatched?: {
    supplierSku: string;
    supplierName: string | null;
    brand: string | null;
  }[];
}) {
  const saved: { supplierId: string; suggestions: NameSuggestion[] }[] = [];
  const decided: { kind: string; ids: readonly string[]; userId: string }[] =
    [];
  const repository = {
    list: async () =>
      options.list === undefined
        ? { id: "list-1", supplierId: "sup-1" }
        : options.list,
    unmatchedEntries: async () => options.unmatched ?? [],
    candidates: async () => CANDIDATES,
    saveSuggestions: async (
      supplierId: string,
      suggestions: NameSuggestion[],
    ) => {
      saved.push({ supplierId, suggestions: [...suggestions] });
      return suggestions.length;
    },
    pendingIds: async () => ({ ids: ["s2", "s1"], total: 7 }),
    details: async (ids: readonly string[]) =>
      ids.map((id) => ({
        id,
        supplierId: "sup-1",
        supplierSku: `SKU-${id}`,
        variantId: "v1",
        score: { toString: () => "0.912" },
        basis: {
          commonWords: ["reef", "salt"],
          sizes: ["2000g"],
          brand: "exbrand",
        },
        supplier: { name: "Hertlein" },
        variant: {
          name: null,
          sku: "VSKU-1",
          product: { name: "Exbrand Reef Salt 2kg" },
        },
      })),
    latestEntries: async () =>
      new Map([
        [
          "sup-1|SKU-s1",
          {
            supplierName: "Exbrand Reef Salt 2 kg",
            brand: "Exbrand",
            gtin: "04260119453555",
            unitPrice: "12.5",
            currency: "EUR",
          },
        ],
      ]),
    approve: async (ids: readonly string[], userId: string) => {
      decided.push({ kind: "approve", ids, userId });
      return { decided: ids.length, skipped: 0 };
    },
    reject: async (ids: readonly string[], userId: string) => {
      decided.push({ kind: "reject", ids, userId });
      return { decided: ids.length, skipped: 0 };
    },
  } as unknown as PriceListSuggestionRepository;
  return {
    service: new PriceListSuggestionService(repository),
    saved,
    decided,
  };
}

describe("PriceListSuggestionService.generateForList", () => {
  it("suggests for the unmatched rows only and stores them under the list's supplier", async () => {
    const { service, saved } = setup({
      unmatched: [
        {
          supplierSku: "S1",
          supplierName: "Exbrand Reef Salt tengeri só 2 kg",
          brand: "Exbrand",
        },
        {
          supplierSku: "S2",
          supplierName: "Completely Unrelated Thing",
          brand: null,
        },
      ],
    });
    const result = await service.generateForList("list-1");
    assert.deepEqual(result, { considered: 2, withSuggestion: 1, stored: 1 });
    assert.equal(saved.length, 1);
    assert.equal(saved[0]!.supplierId, "sup-1");
    assert.deepEqual(
      saved[0]!.suggestions.map((s) => [s.supplierSku, s.variantId]),
      [["S1", "v1"]],
    );
  });

  it("does nothing, and loads no candidates, when every row is already tied", async () => {
    const { service, saved } = setup({ unmatched: [] });
    assert.deepEqual(await service.generateForList("list-1"), {
      considered: 0,
      withSuggestion: 0,
      stored: 0,
    });
    assert.deepEqual(saved, []);
  });

  it("answers an unknown list with a 404, not a silent zero", async () => {
    const { service } = setup({ list: null });
    await assert.rejects(service.generateForList("nope"), NotFoundException);
  });
});

describe("PriceListSuggestionService.pending and decisions", () => {
  it("shows each suggestion with the supplier's latest row, the candidate and a numeric score, in the page order", async () => {
    const { service } = setup({});
    const page = await service.pending(undefined, 0);
    assert.equal(page.total, 7);
    assert.deepEqual(
      page.items.map((item) => item.id),
      ["s2", "s1"],
    );
    const second = page.items[1]!;
    assert.deepEqual(
      [second.listedName, second.gtin, second.unitPrice, second.currency],
      ["Exbrand Reef Salt 2 kg", "04260119453555", "12.5", "EUR"],
    );
    assert.equal(second.score, 0.912);
    assert.equal(second.variantName, "Exbrand Reef Salt 2kg");
    // a row whose list entry is gone still shows, without the list's data
    assert.deepEqual(
      [page.items[0]!.listedName, page.items[0]!.unitPrice],
      [null, null],
    );
  });

  it("counts an id once, and passes the user who decided", async () => {
    const { service, decided } = setup({});
    await service.approve(["a", "b", "a"], "u-1");
    await service.reject(["c", "c"], "u-2");
    assert.deepEqual(decided, [
      { kind: "approve", ids: ["a", "b"], userId: "u-1" },
      { kind: "reject", ids: ["c"], userId: "u-2" },
    ]);
  });
});
