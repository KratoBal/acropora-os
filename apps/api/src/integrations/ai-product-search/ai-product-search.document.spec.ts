import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDocument,
  chooseDescription,
  AI_PRODUCT_SEARCH_DOCUMENT_VERSION,
  type DocumentSourceProduct,
} from "./ai-product-search.document.js";

function sourceProduct(
  overrides: Partial<DocumentSourceProduct> = {},
): DocumentSourceProduct {
  return {
    id: "product-1",
    name: "Reef Salt",
    isActive: true,
    mirrorState: "ACTIVE",
    catalogAuthority: "UNAS",
    description: null,
    brand: { name: "Aqua Medic" },
    categories: [{ category: { name: "Tengeri akvarisztika" } }],
    variants: [
      {
        sku: "REEF-SALT-01",
        manufacturerPartNumber: null,
        barcodes: [],
        supplierProducts: [],
      },
    ],
    unasSnapshot: {
      descriptionShort: "Tengeri só",
      descriptionLong: "<p>Hosszabb leírás</p>",
      parameters: null,
    },
    ...overrides,
  };
}

describe("which description the document carries", () => {
  it("uses our own text only when the catalogue is ours AND the text exists", () => {
    /**
     * A TULAJDONJOG DÖNT, NEM A FRISSESSÉG. A két bemenet külön-külön nem
     * elég: az átvett gazdaság üres leírással a tükrözött szöveget hagyja a
     * helyén, különben egy átvétel önmagában KIÜRÍTENÉ a keresést arra a
     * termékre.
     */
    assert.equal(
      chooseDescription({
        catalogAuthority: "ACROPORA",
        description: "Saját leírás",
        unasSnapshot: {
          descriptionShort: "Bolti leírás",
          descriptionLong: null,
        },
      }).source,
      "acropora",
    );
    assert.equal(
      chooseDescription({
        catalogAuthority: "ACROPORA",
        description: "   ",
        unasSnapshot: {
          descriptionShort: "Bolti leírás",
          descriptionLong: null,
        },
      }).source,
      "unas",
    );
    assert.equal(
      chooseDescription({
        catalogAuthority: "UNAS",
        description: "Saját leírás",
        unasSnapshot: {
          descriptionShort: "Bolti leírás",
          descriptionLong: null,
        },
      }).source,
      "unas",
    );
  });

  it("does not claim two texts where one exists", () => {
    // A saját leírás EGY szöveg. A hosszú mező üresen hagyása igaz válasz a
    // "van-e hosszú leírás" kérdésre; a másolat két független szöveget
    // állítana ott, ahol egy van.
    const chosen = chooseDescription({
      catalogAuthority: "ACROPORA",
      description: "Saját leírás",
      unasSnapshot: {
        descriptionShort: "Bolti rövid",
        descriptionLong: "Bolti hosszú",
      },
    });
    assert.equal(chosen.short, "Saját leírás");
    assert.equal(chosen.long, null);
  });
});

describe("the search document a product is turned into", () => {
  it("puts the words in the bands the weights expect", () => {
    const document = buildDocument(sourceProduct());

    assert.equal(document.title, "Reef Salt");
    assert.equal(document.skus, "REEF-SALT-01");
    assert.equal(document.facets, "Aqua Medic Tengeri akvarisztika");
    assert.equal(document.descriptionShort, "Tengeri só");
    // A markup ITT is eltűnik: a dokumentum ugyanazon az úton készül, mint a
    // válasz, különben az index az egyik szöveget tokenizálná, a válasz a
    // másikat.
    assert.equal(document.descriptionLong, "Hosszabb leírás");
    assert.equal(document.documentVersion, AI_PRODUCT_SEARCH_DOCUMENT_VERSION);
  });

  it("flattens the parameter block into words and keeps the names", () => {
    const document = buildDocument(
      sourceProduct({
        unasSnapshot: {
          descriptionShort: null,
          descriptionLong: null,
          parameters: [{ name: "Kiszerelés", value: "4 kg" }],
        },
      }),
    );

    for (const word of ["name", "Kiszerelés", "value", "4 kg"])
      assert.ok(
        document.parameters.includes(word),
        `hiányzik a paraméterekből: ${word}`,
      );
  });

  it("keeps a locally created product searchable", () => {
    /**
     * EZ A TESZT EGY MÉRT HIBÁT ŐRIZ. A jelző első alakja
     * `mirrorState === "ACTIVE"` volt, és a helyben létrehozott terméknek
     * (`origin = LOCAL`) NINCS tükör-állapota: NULL. Azzal a feltétellel a
     * keresés némán csak a tükrözött katalógusról válaszolt volna, miközben
     * minden teszt zöld marad - pontosan az a félig bekötött alak, amit ez a
     * lépés meg akar szüntetni.
     */
    assert.equal(
      buildDocument(sourceProduct({ mirrorState: null })).isSearchable,
      true,
    );
  });

  it("drops the flag but keeps the row when the product goes away", () => {
    // "Ezt árultuk, és mióta nem" megőrzendő tudás, ezért a sor marad.
    assert.equal(
      buildDocument(sourceProduct({ mirrorState: "MISSING" })).isSearchable,
      false,
    );
    assert.equal(
      buildDocument(sourceProduct({ isActive: false })).isSearchable,
      false,
    );
    assert.equal(
      buildDocument(sourceProduct({ mirrorState: "MISSING" })).title,
      "Reef Salt",
    );
  });

  it("leaves a disputed product findable", () => {
    // CONFLICT: az adat vitatott, de a "van ilyenünk" állítás igaz marad.
    assert.equal(
      buildDocument(sourceProduct({ mirrorState: "CONFLICT" })).isSearchable,
      true,
    );
  });
});

describe("every article number lands in the same searchable band", () => {
  const variant = (overrides: Record<string, unknown> = {}) => ({
    sku: "REEF-SALT-01",
    manufacturerPartNumber: null,
    barcodes: [],
    supplierProducts: [],
    ...overrides,
  });

  it("carries the maker's part number, the barcode and the supplier's own code", () => {
    const document = buildDocument(
      sourceProduct({
        variants: [
          variant({
            manufacturerPartNumber: "AM-12345",
            barcodes: [{ code: "5999881234567" }],
            supplierProducts: [{ supplierSku: "SUP-99" }],
          }),
        ],
      }),
    );

    for (const value of [
      "REEF-SALT-01",
      "AM-12345",
      "5999881234567",
      "SUP-99",
    ]) {
      assert.ok(
        document.skus.split(" ").includes(value),
        `${value} is missing from "${document.skus}"`,
      );
    }
  });

  it("collects them across every active variant", () => {
    const document = buildDocument(
      sourceProduct({
        variants: [
          variant({ sku: "A-1", barcodes: [{ code: "111" }] }),
          variant({ sku: "B-2", barcodes: [{ code: "222" }] }),
        ],
      }),
    );

    assert.equal(document.skus, "A-1 111 B-2 222");
  });

  /**
   * The same string is legitimately both our SKU and a supplier's, and a
   * repeat would raise the product's rank for that term without adding
   * anything. This is the assertion, not tidiness.
   */
  it("says each number once, however many places hold it", () => {
    const document = buildDocument(
      sourceProduct({
        variants: [
          variant({
            sku: "SAME",
            manufacturerPartNumber: "SAME",
            barcodes: [{ code: "SAME" }],
            supplierProducts: [{ supplierSku: "SAME" }],
          }),
        ],
      }),
    );

    assert.equal(document.skus, "SAME");
  });

  it("drops empty and whitespace-only values instead of padding the band", () => {
    const document = buildDocument(
      sourceProduct({
        variants: [
          variant({
            sku: "A-1",
            manufacturerPartNumber: "   ",
            barcodes: [{ code: "" }],
          }),
        ],
      }),
    );

    assert.equal(document.skus, "A-1");
  });

  it("trims, so the same number written with a space is not stored twice", () => {
    const document = buildDocument(
      sourceProduct({
        variants: [
          variant({ sku: "A-1", supplierProducts: [{ supplierSku: " A-1 " }] }),
        ],
      }),
    );

    assert.equal(document.skus, "A-1");
  });
});
