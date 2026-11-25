import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import {
  CashRegisterController,
  receiptListOrderBy,
} from "./cash-register.controller.js";

/**
 * A NYUGTA-LISTA RENDEZÉSE (Balázs kérése, kártya 2f6369a4). Mi pirosít: ha a rendezés nélküli sorrend változik (kelt szerint
 * csökkenő); ha a megadott mező vagy irány nem érvényesül, vagy az azonosító döntetlen-feloldó hiányzik (lapozáskor az azonos értékű sorok
 * cserélgetnék a helyüket); ha egy ismeretlen mező vagy irány a kapun átmegy (az `orderBy`-ba egy kérés-szöveg kerülne) ahelyett, hogy 400
 * lenne.
 */
describe("receiptListOrderBy", () => {
  it("keeps the old order without a sort", () => {
    assert.deepEqual(receiptListOrderBy(undefined, undefined), [
      { issuedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("sorts by the whitelisted column and direction, the id breaking ties the same way", () => {
    assert.deepEqual(receiptListOrderBy("total", "asc"), [
      { total: "asc" },
      { id: "asc" },
    ]);
    assert.deepEqual(receiptListOrderBy("receiptNumber", "desc"), [
      { receiptNumber: "desc" },
      { id: "desc" },
    ]);
    assert.deepEqual(receiptListOrderBy("issuedAt", undefined)[0], {
      issuedAt: "asc",
    });
  });
});

describe("CashRegisterController.list: the sort parameters", () => {
  const controller = new CashRegisterController();

  it("refuses an unknown sort field or direction with a 400, before any query", () => {
    for (const [sort, direction] of [
      ["password", "asc"],
      ["constructor", "asc"],
      ["total", "sideways"],
    ] as const)
      assert.throws(
        () => controller.list("2099-10-03", "1", sort, direction),
        BadRequestException,
        `${sort} ${direction}`,
      );
  });
});
