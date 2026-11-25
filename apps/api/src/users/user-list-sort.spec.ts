import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { USER_LIST_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { USER_LIST_SORT } from "./user-list-sort.js";

/**
 * A FELHASZNÁLÓK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik
 * (vezetéknév, keresztnév, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez, vagy nem a kért irányra; ha a
 * döntetlen-feloldó nem az irányt követi; ha a fehér lista bővül egy nem tárolt mezővel (becenév, szerepkör, státusz); ha egy ismeretlen
 * vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a felhasználók listájának rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: vezetéknév, keresztnév, azonosító", () => {
    assert.deepEqual(listOrderBy(USER_LIST_SORT, undefined, undefined), [
      { lastName: "asc" },
      { firstName: "asc" },
      { id: "asc" },
    ]);
  });

  it("a fehér lista pontosan a megjelenítendő név és az e-mail; a kért irányra rendez, a döntetlen-feloldó követi az irányt", () => {
    assert.deepEqual([...USER_LIST_SORT_FIELDS].sort(), [
      "displayName",
      "email",
    ]);
    for (const direction of ["asc", "desc"] as const)
      for (const field of ["displayName", "email"] as const)
        assert.deepEqual(listOrderBy(USER_LIST_SORT, field, direction), [
          { [field]: direction },
          { id: direction },
        ]);
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(listOrderBy(USER_LIST_SORT, "email", undefined)[0], {
      email: "asc",
    });
    for (const bad of ["nickname", "role", "isActive", "constructor"])
      assert.deepEqual(
        listOrderBy(USER_LIST_SORT, bad as never, "asc"),
        listOrderBy(USER_LIST_SORT, undefined, undefined),
        bad,
      );
  });
});
