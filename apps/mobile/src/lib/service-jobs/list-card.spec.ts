import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  serviceJobAssigneeLine,
  serviceJobCardMeta,
  serviceJobStatTiles,
  shortWhen,
} from "./list-card";

/**
 * THE JOB CARD'S LINE (service redesign, Figma 423:876, 2026-10-04):
 * "Felelős: Ádám, Péter · 2 ML · ma 08:14".
 */
const now = new Date(2026, 9, 4, 12, 0);
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const person = (name: string) => ({
  userId: name,
  name,
  assignedAt: "2026-10-04T08:00:00.000Z",
});

describe("a hibajegy-kártya felelős-sora", () => {
  it("nevekkel, üres listánál nincs kiosztva", () => {
    assert.equal(
      serviceJobAssigneeLine(
        { assignees: [person("Ádám"), person("Péter")] },
        false,
      ),
      "Felelős: Ádám, Péter",
    );
    assert.equal(
      serviceJobAssigneeLine({ assignees: [] }, false),
      "Felelős: nincs kiosztva",
    );
  });

  /**
   * THE OLD SAVED ROW: no `assignees` key at all. It must never read as
   * "nincs kiosztva" (the brief, point 2): that would state a fact nobody
   * knows.
   */
  it("régi mentett sornál ismeretlen, sosem nincs kiosztva", () => {
    const line = serviceJobAssigneeLine({}, false);
    assert.equal(line, "Felelős: nem ismert");
    assert.doesNotMatch(line!, /nincs kiosztva/i);
  });

  it("partner szemnek nincs felelős-sor", () => {
    assert.equal(
      serviceJobAssigneeLine({ assignees: [person("Ádám")] }, true),
      null,
    );
    assert.equal(
      serviceJobCardMeta(
        {
          assignees: [person("Ádám")],
          worksheetCount: 1,
          createdAt: at(4, 8, 14),
        },
        true,
        now,
      ),
      "1 ML · ma 08:14",
    );
  });

  it("a teljes sor a terv alakjában", () => {
    assert.equal(
      serviceJobCardMeta(
        {
          assignees: [person("Ádám"), person("Péter")],
          worksheetCount: 2,
          createdAt: at(4, 8, 14),
        },
        false,
        now,
      ),
      "Felelős: Ádám, Péter · 2 ML · ma 08:14",
    );
  });
});

describe("a rövid időpont", () => {
  it("ma, tegnap, majd hónap és nap", () => {
    assert.equal(shortWhen(at(4, 8, 14), now), "ma 08:14");
    assert.equal(shortWhen(at(3, 15, 42), now), "tegnap 15:42");
    assert.equal(shortWhen(at(2, 11, 6), now), "okt. 2.");
    assert.equal(
      shortWhen(new Date(2025, 11, 30, 9, 0).toISOString(), now),
      "2025. dec. 30.",
    );
  });
});

describe("a három csempe", () => {
  it("a szerver számlálóiból, számláló nélkül semmi", () => {
    assert.equal(serviceJobStatTiles(undefined), null);
    const tiles = serviceJobStatTiles({
      NEW: 2,
      TRIAGED: 1,
      SCHEDULED: 1,
      IN_PROGRESS: 3,
      WAITING_FOR_PARTS: 2,
      WAITING_FOR_CUSTOMER: 1,
      COMPLETED: 20,
      CANCELLED: 8,
    });
    assert.deepEqual(
      tiles?.map((tile) => [tile.label, tile.value]),
      [
        ["Nyitott", 7],
        ["Várakozik", 3],
        ["Lezárt", 28],
      ],
    );
  });
});
