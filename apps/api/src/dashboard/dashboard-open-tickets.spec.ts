import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OPEN_TICKET_WHERE } from "./dashboard.repository.js";

/*
  A KEZDŐLAP "NYITOTT HIBAJEGY" NEM SZÁMOLJA A KARBANTARTÁSI LAPOT (Balázs és Luca, 2026-11-18; acrobot 55785). MI PIROSÍT: ha a feltételből
  kiesik a `kind: "REPAIR"` (a szerződésből felvett karbantartások a csempén hibajegyként jelennének meg); ha a lezárt vagy rejtett jegy
  bekerül.
*/
describe("a kezdőlap nyitott hibajegy feltétele", () => {
  it("csak a hibajegy (REPAIR), nem lezárt, nem rejtett", () => {
    assert.equal(OPEN_TICKET_WHERE.kind, "REPAIR");
    assert.deepEqual(OPEN_TICKET_WHERE.status, {
      notIn: ["COMPLETED", "CANCELLED"],
    });
    assert.equal(OPEN_TICKET_WHERE.hiddenAt, null);
  });
});
