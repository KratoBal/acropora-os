import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONTRACT_KINDS, contractKindSwitchBlocker } from "./contract.js";

// A FAJTAVÁLTÁS ZÁRJA, MINDEN IRÁNYBAN (hétfői lista M4, barracuda #1661, és a
// javítási fajta: karbantartási felmérés S0/3, Balázs 2026-10-15). A szerver és
// a választókapcsoló ugyanezt a függvényt kérdezi. MI PIROSÍT: ha számla után a
// beszerzési szerződés bármelyik másik fajtára átáll; ha megrendelőlap után a
// karbantartási Beszerzésre vagy Javításra áll; ha a Karbantartásra váltás
// javításiból zárt; ha zár nélkül (nulla darab) bármi zárt.
const INVOICE =
  "Ebből a szerződésből már készült számla, ezért nem állítható vissza Karbantartásra vagy Javításra.";
const ORDER =
  "Ehhez a szerződéshez már készült karbantartási megrendelőlap, ezért nem állítható át Beszerzésre vagy Javításra.";

describe("contractKindSwitchBlocker", () => {
  it("a teljes mátrix, számlával és megrendelőlappal", () => {
    const counts = { maintenanceOrderCount: 1, invoiceCount: 1 };
    const matrix = Object.fromEntries(
      CONTRACT_KINDS.flatMap((from) =>
        CONTRACT_KINDS.map((to) => [
          `${from}->${to}`,
          contractKindSwitchBlocker(from, to, counts),
        ]),
      ),
    );
    assert.deepEqual(matrix, {
      "MAINTENANCE->MAINTENANCE": null,
      "MAINTENANCE->PURCHASE": ORDER,
      "MAINTENANCE->REPAIR": ORDER,
      "PURCHASE->MAINTENANCE": INVOICE,
      "PURCHASE->PURCHASE": null,
      "PURCHASE->REPAIR": INVOICE,
      "REPAIR->MAINTENANCE": null,
      "REPAIR->PURCHASE": ORDER,
      "REPAIR->REPAIR": null,
    });
  });

  it("nulla számla és nulla megrendelőlap mellett minden váltás szabad", () => {
    const counts = { maintenanceOrderCount: 0, invoiceCount: 0 };
    const blocked = CONTRACT_KINDS.flatMap((from) =>
      CONTRACT_KINDS.filter(
        (to) => contractKindSwitchBlocker(from, to, counts) !== null,
      ).map((to) => `${from}->${to}`),
    );
    assert.deepEqual(blocked, []);
  });
});
