import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ServiceJobStatusCounts } from "@acropora/types";

import { ticketScopeTotal } from "./ticket-scope-counts.js";

/**
 * A FÜL-TALÁLATSZÁM HELYES BONTÁSA -- MÉRT, NEM TALÁLGATOTT.
 *
 * A számokat úgy választottuk, hogy mind a nyolc állapot MÁS értéket kapjon:
 * egy hibás particionálás (pl. WAITING_FOR_PARTS "closed"-nak számítva)
 * azonnal más összeget adna, nem csak elcsúszna egy véletlenül egyező
 * számmal. Ez a kalibráció: egy 1-1 kézzel elrontott bontás (bármelyik státusz
 * átkerül a másik ágra) ITT piros lenne, mert az összeg megváltozna.
 */
const COUNTS: ServiceJobStatusCounts = {
  NEW: 1,
  TRIAGED: 2,
  SCHEDULED: 3,
  IN_PROGRESS: 4,
  WAITING_FOR_PARTS: 5,
  WAITING_FOR_CUSTOMER: 6,
  COMPLETED: 7,
  CANCELLED: 8,
};

describe("ticketScopeTotal", () => {
  it("'open' a hat NEM lezárt állapot összege (1+2+3+4+5+6)", () => {
    assert.equal(ticketScopeTotal(COUNTS, "open"), 21);
  });

  it("'closed' KIZÁRÓLAG a COMPLETED és a CANCELLED összege (7+8)", () => {
    assert.equal(ticketScopeTotal(COUNTS, "closed"), 15);
  });

  it("'all' mind a nyolc állapot összege", () => {
    assert.equal(ticketScopeTotal(COUNTS, "all"), 36);
  });

  /*
    POZITÍV KONTROLL: a nyitott és a lezárt fül összege pontosan az
    "összes" fület adja. Ha a particionálás egy állapotot elveszítene vagy
    duplán számolna, ez az invariáns bukna, még ha az egyes fülek száma
    véletlenül helyesnek is látszana.
  */
  it("nyitott + lezárt === összes", () => {
    assert.equal(
      ticketScopeTotal(COUNTS, "open") + ticketScopeTotal(COUNTS, "closed"),
      ticketScopeTotal(COUNTS, "all"),
    );
  });

  it("üres (csupa nulla) counts mellett mindhárom fül nulla", () => {
    const ures: ServiceJobStatusCounts = {
      NEW: 0,
      TRIAGED: 0,
      SCHEDULED: 0,
      IN_PROGRESS: 0,
      WAITING_FOR_PARTS: 0,
      WAITING_FOR_CUSTOMER: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    };
    assert.equal(ticketScopeTotal(ures, "open"), 0);
    assert.equal(ticketScopeTotal(ures, "closed"), 0);
    assert.equal(ticketScopeTotal(ures, "all"), 0);
  });
});
