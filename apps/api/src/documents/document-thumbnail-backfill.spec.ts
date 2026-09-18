import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeThumbnailCoverage,
  describeThumbnailGain,
  planThumbnailBackfill,
  type ThumbnailBackfillRow,
} from "./document-thumbnail-backfill.js";

function sor(
  reszlet: Partial<ThumbnailBackfillRow> = {},
): ThumbnailBackfillRow {
  return {
    owner: "asset",
    ownerId: "eszkoz-1",
    documentId: "dok-1",
    contentType: "image/jpeg",
    sizeBytes: 1000,
    hasThumbnail: false,
    ...reszlet,
  };
}

describe("kihez kell utolag belyegkep", () => {
  it("a belyegkep nelkuli kepeket valasztja, a tobbit nem", () => {
    const terv = planThumbnailBackfill([
      sor({ documentId: "kell-1" }),
      sor({ documentId: "kell-2", contentType: "image/png" }),
      sor({ documentId: "mar-van", hasThumbnail: true }),
      sor({ documentId: "pdf", contentType: "application/pdf" }),
    ]);

    assert.deepEqual(
      terv.candidates.map((jelolt) => jelolt.documentId),
      ["kell-1", "kell-2"],
    );
    assert.equal(terv.covered, 1);
    assert.equal(terv.notImages, 1);
  });

  /**
   * A PDF NEM SZAMIT A NEVEZOBE, es ez nem kozmetika: beleszamolva a
   * lefedettseg SOHA nem erne el a szazat, tehat a szam nem mondana meg,
   * mikor vagyunk keszen.
   */
  it("a lefedettseg nevezoje a KEPEK szama, nem az osszes sore", () => {
    const terv = planThumbnailBackfill([
      sor({ hasThumbnail: true }),
      sor({ documentId: "pdf-1", contentType: "application/pdf" }),
      sor({ documentId: "pdf-2", contentType: "application/pdf" }),
    ]);
    assert.match(describeThumbnailCoverage(terv), /kep-sor: 1.*\(100%\)/);
  });

  it("a jeloltek eredeti bajtjait osszegzi", () => {
    const terv = planThumbnailBackfill([
      sor({ documentId: "a", sizeBytes: 4_000_000 }),
      sor({ documentId: "b", sizeBytes: 6_000_000 }),
      sor({ documentId: "mar-van", sizeBytes: 9_000_000, hasThumbnail: true }),
    ]);
    assert.equal(terv.candidateBytes, 10_000_000);
  });

  /**
   * AZ ISMERETLEN TIPUS NEM KEP. A tarolt sor a KANONIKUS alakot viseli; ha
   * megis mas all ott, az maga a lelet -- es addig is a biztonsagos irany az,
   * hogy nem probalunk belole kepet csinalni.
   */
  it("az ismeretlen tipust nem kepnek szamolja", () => {
    const terv = planThumbnailBackfill([
      sor({ contentType: "image/heic" }),
      sor({ documentId: "jpg-alak", contentType: "image/jpg" }),
    ]);
    assert.equal(terv.candidates.length, 0);
    assert.equal(terv.notImages, 2);
  });

  it("ures bemenetre nem allit lefedettseget", () => {
    assert.match(
      describeThumbnailCoverage(planThumbnailBackfill([])),
      /nincs mit lefedni/,
    );
  });
});

describe("a mert nyereseg", () => {
  it("aranyt is mond, nem csak ket szamot", () => {
    assert.match(describeThumbnailGain(10_000_000, 100_000), /100x kisebb/);
  });

  it("belyegkep nelkul nem allit aranyt", () => {
    assert.match(describeThumbnailGain(10_000_000, 0), /nincs mit merni/);
  });
});
