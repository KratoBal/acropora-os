import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STRIPE_PAYOUT_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../../common/list-sort.js";
import { PAYOUT_SORT } from "./stripe-payout-sort.js";

/**
 * A STRIPE-KIFIZETÉSEK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje
 * megváltozik (kifizetés napja csökkenő, létrehozás, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez, vagy nem a
 * kért irányra; ha a döntetlen-feloldó nem az irányt követi (lapozáskor egy azonos napú sor vándorolna); ha a fehér lista mezője
 * hiányzik a térképből; ha egy ismeretlen kulcs (vagy egy öröklött: `constructor`) átmegy a fehér listán.
 */
describe("a Stripe-kifizetések rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: kifizetés napja csökkenő, létrehozás, azonosító", () => {
    assert.deepEqual(listOrderBy(PAYOUT_SORT, undefined, undefined), [
      { arrivalDate: "desc" },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("mindegyik fehér-listás mező a SAJÁT mezőjére rendez, a kért irányra, a döntetlen-feloldó követi az irányt", () => {
    const expected: Record<string, string> = {
      arrivalDate: "arrivalDate",
      amount: "amount",
      grossTotal: "grossTotal",
      refundTotal: "refundTotal",
      feeTotal: "feeTotal",
    };
    assert.deepEqual(
      [...STRIPE_PAYOUT_SORT_FIELDS].sort(),
      Object.keys(expected).sort(),
    );
    for (const field of STRIPE_PAYOUT_SORT_FIELDS) {
      for (const direction of ["asc", "desc"] as const) {
        assert.deepEqual(listOrderBy(PAYOUT_SORT, field, direction), [
          { [expected[field]!]: direction },
          { createdAt: direction },
          { id: direction },
        ]);
      }
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(listOrderBy(PAYOUT_SORT, "amount", undefined)[0], {
      amount: "asc",
    });
    for (const bad of ["status", "constructor", "toString"]) {
      assert.deepEqual(
        listOrderBy(PAYOUT_SORT, bad as never, "asc"),
        listOrderBy(PAYOUT_SORT, undefined, undefined),
        bad,
      );
    }
  });
});
