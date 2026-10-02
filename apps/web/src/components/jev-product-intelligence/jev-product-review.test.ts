import type {
  ProductDetail,
  ProductEnrichmentReview,
  ProductFieldReview,
} from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  cardLine,
  currentProductData,
  productReviewSubtitle,
  reviewHref,
  reviewState,
} from "./jev-product-review";

/** Invented values only; just the fields these rules read. */
function product(over: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: "p-1",
    name: "Példa termék",
    origin: "UNAS",
    primarySku: "DEMO-001",
    brand: { id: "b", name: "Aqua Example" },
    primaryCategory: { id: "c", name: "Szivattyúk" },
    categories: [],
    stockOnHand: "4",
    unasMirror: null,
    variants: [
      {
        id: "v-1",
        isActive: true,
        manufacturerPartNumber: "DR-3300",
        barcodes: [],
      },
      {
        id: "v-2",
        isActive: false,
        manufacturerPartNumber: "REGI-1",
        barcodes: [{ id: "x", code: "5999999999999", isPrimary: true }],
      },
    ],
    ...over,
  } as unknown as ProductDetail;
}

const review = (
  over: Partial<ProductEnrichmentReview> = {},
): ProductEnrichmentReview => ({
  availability: "review",
  lastRun: null,
  fields: [],
  ...over,
});

const field = (over: Partial<ProductFieldReview>): ProductFieldReview => ({
  field: "category",
  tier: "B",
  status: "SUGGESTED",
  currentValue: null,
  value: { kind: "text", text: "Keringető szivattyúk" },
  sourceType: "MANUFACTURER_PAGE",
  sourceRef: null,
  retrievedAt: null,
  confidence: null,
  evidence: [],
  ...over,
});

const run = { at: "2026-10-01T20:41:00.000Z", sourceCount: 4, fieldCount: 12 };

describe("a termék JEV ellenőrzésének állapota", () => {
  it("kikapcsolt kapcsolónál nem elérhető, akkor is, ha jönne futás", () => {
    expect(
      reviewState({
        kind: "ready",
        review: review({ availability: "off", lastRun: run }),
      }),
    ).toBe("unavailable");
  });

  it("bekapcsolva, futás nélkül: még nem ellenőrzött", () => {
    expect(reviewState({ kind: "ready", review: review() })).toBe(
      "never-checked",
    );
  });

  it("a hiba hiba, a betöltés betöltés: egyik sem üres, nyugodt állapot", () => {
    expect(reviewState({ kind: "error" })).toBe("error");
    expect(reviewState({ kind: "loading" })).toBe("loading");
    expect(cardLine({ kind: "error" })).toBe(
      "Az ellenőrzés állapota nem tölthető be.",
    );
  });

  it("futás után: ha van döntendő, a panel jön; ha nincs, azt mondja ki", () => {
    const withSuggestion = review({ lastRun: run, fields: [field({})] });
    expect(reviewState({ kind: "ready", review: withSuggestion })).toBeNull();
    expect(cardLine({ kind: "ready", review: withSuggestion })).toBe(
      "1 javaslat vár emberi döntésre.",
    );
    const verifiedOnly = review({
      lastRun: run,
      fields: [field({ status: "VERIFIED" })],
    });
    expect(reviewState({ kind: "ready", review: verifiedOnly })).toBe(
      "no-issues",
    );
  });

  it("a Tier C javaslat nem számít javaslatnak a kártyán sem", () => {
    const tierC = review({
      lastRun: run,
      fields: [field({ field: "ean", tier: "C", status: "SUGGESTED" })],
    });
    expect(cardLine({ kind: "ready", review: tierC })).not.toMatch(/javaslat/);
  });
});

describe("a jelenlegi termékadatok", () => {
  it("valódi adatból, csak az aktív változatokból; üresen kötőjel", () => {
    expect(currentProductData(product())).toEqual([
      { label: "Márka", value: "Aqua Example" },
      { label: "Gyártói cikkszám", value: "DR-3300" },
      { label: "EAN", value: "—" },
      { label: "Kategória", value: "Szivattyúk" },
      { label: "OS készlet", value: "4" },
    ]);
  });

  it("csomagterméknél nem mond saját készletet", () => {
    const rows = currentProductData(
      product({
        unasMirror: { isPackageProduct: true } as ProductDetail["unasMirror"],
      }),
    );
    expect(rows.find((row) => row.label === "OS készlet")?.value).toBe(
      "Csomagtermék",
    );
  });

  it("a fejléc sora és az aloldal címe", () => {
    expect(productReviewSubtitle(product())).toBe(
      "SKU: DEMO-001 · UNAS-termék · 1 változat",
    );
    expect(reviewHref("p 1")).toBe("/products/p%201/adatellenorzes");
  });
});
