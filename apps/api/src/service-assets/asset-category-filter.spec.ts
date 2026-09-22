import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assetCategoryWhere } from "./asset-category-filter.js";

describe("a kategória szerinti szűrés", () => {
  it("F1: szűrő nélkül üres feltétel", () => {
    assert.deepEqual(assetCategoryWhere(undefined, undefined), {});
  });

  /**
   * F2: A „NINCS KATEGORIAJA" AG.
   *
   * MI PIROSIT: ha a `without` ugyanazt adna, mint a `with`. Akkor a
   * kategoria nelkuli eszkozok -- amiket az atvezeto migracio szandekosan
   * hagyott `NULL`-on -- MEGKERDEZHETETLENEK maradnanak, es a halmaz
   * csendben nőne.
   */
  it("F2: a `without` a kategória NÉLKÜLIEKET kéri", () => {
    assert.deepEqual(assetCategoryWhere("without", undefined), {
      categoryId: null,
    });
  });

  it("F3: a `with` a kategóriával RENDELKEZŐKET kéri", () => {
    assert.deepEqual(assetCategoryWhere("with", undefined), {
      categoryId: { not: null },
    });
  });

  it("F4: a konkrét azonosító pontos egyezés", () => {
    assert.deepEqual(assetCategoryWhere(undefined, "cat-1"), {
      categoryId: "cat-1",
    });
  });

  /**
   * F5: KONTROLL -- a ketto EGYUTT `AND`, nem az egyik felulirja a masikat.
   *
   * E nelkul a fenti negy allitas zold maradna egy olyan megvalositason is,
   * ami MINDIG csak az utolso feltetelt adja vissza. Az ellentmondo par ures
   * halmazt ad, es ez a helyes: a kerdes maga ellentmondasos.
   */
  it("F5: KONTROLL: a kettő együtt AND-ként áll", () => {
    assert.deepEqual(assetCategoryWhere("without", "cat-1"), {
      AND: [{ categoryId: null }, { categoryId: "cat-1" }],
    });
  });
});
