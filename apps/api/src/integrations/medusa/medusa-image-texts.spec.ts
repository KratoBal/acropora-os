import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  csakATermekNeve,
  fajlnevAlakuAlt,
  imageTextsFor,
  imageTextsMetadataPatch,
  imageTextsMetadataValue,
} from "./medusa-image-texts.js";

describe("imageTextsFor", () => {
  it("pairs the published urls with the rows by index, trimmed", () => {
    assert.deepEqual(
      imageTextsFor(
        ["https://m/1.jpg", "https://m/2.jpg"],
        [
          { altText: "  Pumpa elolrol ", title: null },
          { altText: "   ", title: "Cim" },
        ],
        "Eheim pumpa",
      ),
      [
        { url: "https://m/1.jpg", alt: "Pumpa elolrol", title: null },
        { url: "https://m/2.jpg", alt: null, title: "Cim" },
      ],
    );
  });

  it("gives null for no list, and for a length mismatch", () => {
    assert.equal(imageTextsFor(null, [], null), null);
    assert.equal(
      imageTextsFor(
        ["https://m/1.jpg"],
        [
          { altText: "a", title: null },
          { altText: "b", title: null },
        ],
        null,
      ),
      null,
    );
  });
});

describe("imageTextsMetadataValue", () => {
  it("keeps only images with text, in order", () => {
    assert.equal(
      imageTextsMetadataValue([
        { url: "u1", alt: null, title: null },
        { url: "u2", alt: "b", title: null },
        { url: "u3", alt: null, title: "c" },
      ]),
      JSON.stringify([
        { url: "u2", alt: "b", title: null },
        { url: "u3", alt: null, title: "c" },
      ]),
    );
  });

  it("is null when no image has text", () => {
    assert.equal(
      imageTextsMetadataValue([{ url: "u1", alt: null, title: null }]),
      null,
    );
    assert.equal(imageTextsMetadataValue([]), null);
  });
});

describe("imageTextsMetadataPatch", () => {
  it("null list keeps the existing string value, and nothing else", () => {
    assert.deepEqual(
      imageTextsMetadataPatch(null, { acropora_images: "[]x" }),
      { acropora_images: "[]x" },
    );
    assert.deepEqual(imageTextsMetadataPatch(null, { acropora_images: 5 }), {});
    assert.deepEqual(imageTextsMetadataPatch(null, null), {});
  });

  it("a list says the current state, even when it overrides the old one", () => {
    assert.deepEqual(
      imageTextsMetadataPatch([{ url: "u", alt: null, title: null }], {
        acropora_images: "regi",
      }),
      {},
    );
  });
});

describe("fajlnevAlakuAlt", () => {
  it("a file-name shaped alt is not an alt", () => {
    for (const alt of [
      "IMG_1234.jpg",
      "DSC00012.JPG",
      "kep.webp",
      "IMG_1234",
      "DSC00012",
      "PXL_20260101_101010",
    ])
      assert.equal(fajlnevAlakuAlt(alt, {}), true, alt);
  });

  it("matches the row's own file name or url tail, with or without extension", () => {
    const kep = {
      fileName: "eheim-pumpa-1.jpg",
      url: "https://unas.test/img/Eheim%20Pumpa.png?v=2",
    };
    assert.equal(fajlnevAlakuAlt("eheim-pumpa-1", kep), true);
    assert.equal(fajlnevAlakuAlt("EHEIM-PUMPA-1.JPG", kep), true);
    assert.equal(fajlnevAlakuAlt("Eheim Pumpa", kep), true);
  });

  it("keeps a real description, also one with a number in it", () => {
    const kep = {
      fileName: "eheim-pumpa-1.jpg",
      url: "https://unas.test/img/1.jpg",
    };
    assert.equal(fajlnevAlakuAlt("Eheim pumpa elölről", kep), false);
    assert.equal(fajlnevAlakuAlt("Eheim 1200 pumpa", kep), false);
    assert.equal(fajlnevAlakuAlt("Photo of the reef", kep), false);
  });
});

describe("imageTextsFor with a file-name alt", () => {
  it("drops the file-name alt to null, keeps the title", () => {
    assert.deepEqual(
      imageTextsFor(
        ["https://m/1.jpg"],
        [{ altText: "IMG_1234.jpg", title: "Cim", fileName: "IMG_1234.jpg" }],
        null,
      ),
      [{ url: "https://m/1.jpg", alt: null, title: "Cim" }],
    );
  });
});

/**
 * MEASURED IN PRODUCTION (acrobot 28126): 3449 of 3456 alts are the product
 * name, 103 of them entity-encoded, and names with an apostrophe were cut at it.
 */
describe("an alt that only repeats the product name", () => {
  it("is null when it is the name, a cut-off start of it, or the encoded name", () => {
    const nev = "Gyorscsatlakozó könyök 1/4''";
    assert.equal(csakATermekNeve("Gyorscsatlakozó könyök 1/4''", nev), true);
    assert.equal(csakATermekNeve("gyorscsatlakozó  KÖNYÖK 1/4'", nev), true);
    assert.equal(
      csakATermekNeve("Korallen-Zucht Pohl", "Korallen-Zucht Pohl's Xtra"),
      true,
    );
    assert.equal(
      csakATermekNeve('Tunze "Turbelle"', 'Tunze "Turbelle" 6040'),
      true,
    );
  });

  it("keeps an alt that says more or other than the name", () => {
    assert.equal(
      csakATermekNeve("Coris aygula felnőtt nőstény", "Coris aygula"),
      false,
    );
    assert.equal(csakATermekNeve("Pumpa elölről", "Eheim pumpa"), false);
    assert.equal(csakATermekNeve("Eheim pumpa", null), false);
  });

  it("imageTextsFor decodes entities, and drops the name-only alt", () => {
    assert.deepEqual(
      imageTextsFor(
        ["https://m/1.jpg", "https://m/2.jpg"],
        [
          { altText: "Tunze &quot;Turbelle&quot; 6040", title: null },
          { altText: "Tunze &quot;Turbelle&quot; &amp; tartó", title: null },
        ],
        'Tunze "Turbelle" 6040',
      ),
      [
        { url: "https://m/1.jpg", alt: null, title: null },
        {
          url: "https://m/2.jpg",
          alt: 'Tunze "Turbelle" & tartó',
          title: null,
        },
      ],
    );
  });
});
