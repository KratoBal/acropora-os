import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";
import { AQUARIUM_LIST_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { AQUARIUM_LIST_SORT } from "./aquarium-list-sort.js";
import { AquariumsService } from "./aquariums.service.js";

/**
 * AZ AKVÁRIUMOK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik
 * (létrehozás csökkenő, azonosító); ha egy fehér-listás oszlop nem a saját mezőjére rendez (az ügyfél neve a kapcsolaton át), vagy nem
 * a kért irányra; ha a térfogat üres értéke valamelyik irányban nem a végére kerül; ha a döntetlen-feloldó nem az irányt követi; ha egy
 * ismeretlen vagy öröklött kulcs (`constructor`) átmegy; és HA A SZOLGÁLTATÁS NEM ADJA ÁT a rendezést a tárolónak (ez a lista a
 * mezőket egyenként másolja, tehát egy új mező csendben elveszne).
 */
describe("az akváriumok listájának rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: létrehozás csökkenő, azonosító", () => {
    assert.deepEqual(listOrderBy(AQUARIUM_LIST_SORT, undefined, undefined), [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("a mezők a SAJÁT mezőjükre rendeznek, a kért irányra; az ügyfél a kapcsolaton át, a térfogat az üres értékkel a végén", () => {
    assert.deepEqual([...AQUARIUM_LIST_SORT_FIELDS].sort(), [
      "customerName",
      "name",
      "systemVolumeLiters",
    ]);
    for (const direction of ["asc", "desc"] as const) {
      assert.deepEqual(listOrderBy(AQUARIUM_LIST_SORT, "name", direction), [
        { name: direction },
        { id: direction },
      ]);
      assert.deepEqual(
        listOrderBy(AQUARIUM_LIST_SORT, "customerName", direction),
        [{ customer: { displayName: direction } }, { id: direction }],
      );
      assert.deepEqual(
        listOrderBy(AQUARIUM_LIST_SORT, "systemVolumeLiters", direction),
        [
          { systemVolumeLiters: { sort: direction, nulls: "last" } },
          { id: direction },
        ],
      );
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(listOrderBy(AQUARIUM_LIST_SORT, "name", undefined)[0], {
      name: "asc",
    });
    for (const bad of ["waterBodyType", "ownershipType", "constructor"])
      assert.deepEqual(
        listOrderBy(AQUARIUM_LIST_SORT, bad as never, "asc"),
        listOrderBy(AQUARIUM_LIST_SORT, undefined, undefined),
        bad,
      );
  });

  it("a szolgáltatás a rendezést és az irányt átadja a tárolónak, és nélkülük nem ad át semmit", async () => {
    const seen: unknown[] = [];
    const repository = {
      list: async (query: unknown) => {
        seen.push(query);
        return { items: [], pagination: {} };
      },
    };
    const service = new AquariumsService(repository as never, {} as never);
    const internal = { id: "u-int", role: "SERVICE" } as AuthenticatedUser;
    await service.list(
      { page: 1, pageSize: 25, sort: "customerName", direction: "desc" },
      internal,
    );
    await service.list({ page: 1, pageSize: 25 }, internal);
    assert.equal((seen[0] as { sort?: string }).sort, "customerName");
    assert.equal((seen[0] as { direction?: string }).direction, "desc");
    assert.equal((seen[1] as { sort?: string }).sort, undefined);
    assert.equal((seen[1] as { direction?: string }).direction, undefined);
  });
});
