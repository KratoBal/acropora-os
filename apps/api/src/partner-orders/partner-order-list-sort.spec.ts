import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PARTNER_ORDER_LIST_SORT_FIELDS } from "@acropora/types";

import { listOrderBy } from "../common/list-sort.js";
import { PartnerOrdersController } from "./partner-orders.controller.js";
import { PARTNER_ORDER_LIST_SORT } from "./partner-order-list-sort.js";

/**
 * A MEGRENDELÉSEK LISTÁJÁNAK RENDEZÉSE (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a rendezetlen lista sorrendje megváltozik
 * (létrehozás csökkenő, azonosító); ha a megrendelés száma nem a saját mezőjére, a partner nem a kapcsolaton át rendez, vagy nem a kért
 * irányra; ha a döntetlen-feloldó nem az irányt követi; ha a fehér lista bővül egy számolt mezővel (nettó összeg, lánc, hátralék); ha
 * egy ismeretlen vagy öröklött kulcs (`constructor`) átmegy.
 */
describe("a megrendelések listájának rendezése", () => {
  it("rendezés nélkül az eddigi sorrend: létrehozás csökkenő, azonosító", () => {
    assert.deepEqual(
      listOrderBy(PARTNER_ORDER_LIST_SORT, undefined, undefined),
      [{ createdAt: "desc" }, { id: "desc" }],
    );
  });

  it("a fehér lista pontosan a szám és a partner; a kért irányra rendez, a partner a kapcsolaton át", () => {
    assert.deepEqual([...PARTNER_ORDER_LIST_SORT_FIELDS].sort(), [
      "customerName",
      "orderNumber",
    ]);
    for (const direction of ["asc", "desc"] as const) {
      assert.deepEqual(
        listOrderBy(PARTNER_ORDER_LIST_SORT, "orderNumber", direction),
        [{ orderNumber: direction }, { id: direction }],
      );
      assert.deepEqual(
        listOrderBy(PARTNER_ORDER_LIST_SORT, "customerName", direction),
        [{ customer: { displayName: direction } }, { id: direction }],
      );
    }
  });

  it("irány nélkül növekvő; ismeretlen vagy öröklött kulcs az alapsorrendet adja", () => {
    assert.deepEqual(
      listOrderBy(PARTNER_ORDER_LIST_SORT, "orderNumber", undefined)[0],
      { orderNumber: "asc" },
    );
    for (const bad of ["netTotal", "status", "chain", "constructor"])
      assert.deepEqual(
        listOrderBy(PARTNER_ORDER_LIST_SORT, bad as never, "asc"),
        listOrderBy(PARTNER_ORDER_LIST_SORT, undefined, undefined),
        bad,
      );
  });
});

describe("a megrendelés-lista kontrollere", () => {
  it("a rendezést és az irányt átadja a szolgáltatásnak, és nélkülük nem ad át semmit (a kontroller a mezőket egyenként másolja)", async () => {
    const seen: unknown[][] = [];
    const service = {
      list: async (...args: unknown[]) => {
        seen.push(args);
        return { page: 1, pageSize: 25, total: 0, items: [] };
      },
    };
    const controller = new PartnerOrdersController(service as never);
    await controller.list({
      page: 1,
      pageSize: 25,
      sort: "customerName",
      direction: "desc",
    } as never);
    await controller.list({ page: 1, pageSize: 25 } as never);
    const first = seen[0]![2] as { sort?: string; direction?: string };
    const second = seen[1]![2] as { sort?: string; direction?: string };
    assert.equal(first.sort, "customerName");
    assert.equal(first.direction, "desc");
    assert.equal(second.sort, undefined);
    assert.equal(second.direction, undefined);
  });
});
