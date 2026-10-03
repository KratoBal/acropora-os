import type {
  ProductEnrichmentReview,
  ProductFieldReview,
} from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  conflictHref,
  conflictState,
  decisionLabels,
  explanationLines,
  isEnrichmentField,
} from "./jev-conflict";
import type { ReviewLoad } from "./jev-product-review";

/** Invented readings only. */
const conflict: ProductFieldReview = {
  fieldResultId: "fr-flow",
  field: "flowRate",
  tier: "C",
  status: "CONFLICTING_SOURCES",
  currentValue: { kind: "quantity", amount: "2500", unit: "l/h" },
  value: null,
  sourceType: null,
  sourceRef: null,
  retrievedAt: null,
  confidence: null,
  evidence: [
    {
      sourceType: "MANUFACTURER_DOCUMENT",
      value: { kind: "quantity", amount: "3000", unit: "l/h" },
      sourceRef: null,
      retrievedAt: null,
    },
    {
      sourceType: "MANUFACTURER_PAGE",
      value: { kind: "quantity", amount: "3000", unit: "l/h" },
      sourceRef: null,
      retrievedAt: null,
    },
    {
      sourceType: "SUPPLIER_PAGE",
      value: { kind: "quantity", amount: "2800", unit: "l/h" },
      sourceRef: null,
      retrievedAt: null,
    },
    {
      sourceType: "OS_PRODUCT_MASTER",
      value: { kind: "quantity", amount: "2500", unit: "l/h" },
      sourceRef: null,
      retrievedAt: null,
    },
  ],
};

const run = { at: "2026-10-01T20:41:00.000Z", sourceCount: 4, fieldCount: 12 };
const ready = (over: Partial<ProductEnrichmentReview> = {}): ReviewLoad => ({
  kind: "ready",
  review: { availability: "review", lastRun: null, fields: [], ...over },
});

describe("a forrásütközés nézet szabályai", () => {
  it("csak ismert mezőkulcs, prototípus-név sem", () => {
    expect(isEnrichmentField("flowRate")).toBe(true);
    expect(isEnrichmentField("nincsilyen")).toBe(false);
    expect(isEnrichmentField("toString")).toBe(false);
    expect(conflictHref("p 1", "flowRate")).toBe(
      "/products/p%201/adatellenorzes/flowRate",
    );
  });

  it("tárolt futás nélkül őszinte állapot, nem kitalált ütközés", () => {
    expect(
      conflictState(
        ready({ availability: "off", lastRun: run, fields: [conflict] }),
        "flowRate",
      ).state,
    ).toBe("unavailable");
    expect(conflictState(ready(), "flowRate").state).toBe("never-checked");
    expect(conflictState({ kind: "error" }, "flowRate").state).toBe("error");
    expect(conflictState(ready({ lastRun: run }), "flowRate").state).toBe(
      "not-reviewed",
    );
  });

  it("csak a valódi ütközés ütközés", () => {
    expect(
      conflictState(ready({ lastRun: run, fields: [conflict] }), "flowRate"),
    ).toEqual({ state: "conflict", review: conflict });
    expect(
      conflictState(
        ready({
          lastRun: run,
          fields: [{ ...conflict, status: "VERIFIED" }],
        }),
        "flowRate",
      ).state,
    ).toBe("no-conflict");
  });

  it("a magyarázat minden forrást kimond, a belső adatot önmagát nem igazolóként", () => {
    expect(explanationLines(conflict)).toEqual([
      "Gyártói adatlap: 3000 l/h.",
      "Gyártói termékoldal: 3000 l/h.",
      "Beszállítói oldal: 2800 l/h.",
      "Acropora OS: 2500 l/h (belső adat, önmagát nem igazolhatja).",
      "A Jev nem írhatja felül csendben a termékadatot.",
    ]);
  });

  it("döntés-gomb minden eltérő KÜLSŐ értékre egy; a belső adat a megtartás", () => {
    expect(decisionLabels(conflict)).toEqual([
      "3000 l/h elfogadása",
      "2800 l/h elfogadása",
      "Jelenlegi érték megtartása",
      "Nem eldönthető",
    ]);
    expect(decisionLabels(null)).toEqual([
      "Jelenlegi érték megtartása",
      "Nem eldönthető",
    ]);
  });
});
