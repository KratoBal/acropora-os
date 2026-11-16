import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { CalendarFeedRepository } from "./calendar-feed.repository.js";
import { CalendarFeedService } from "./calendar-feed.service.js";

/*
  THE CALENDAR FEED SERVICE (T5.5 S1). What turns this red: a failed read of ANY source answered as a feed without it
  (an empty calendar reads "nothing happens", spec 8B); a bad range read anyway; the read time not stamped; the
  undated orders dropped instead of counted; the hand-entered events (S2) not read or not placed.
*/
const NOW = new Date("2026-11-15T10:00:00Z");
const SOURCES = [
  "content",
  "livestock",
  "purchaseLines",
  "undatedOpenOrders",
  "sales",
  "events",
] as const;

function repository(failing?: (typeof SOURCES)[number]) {
  const calls: string[] = [];
  const answer = {
    content: [],
    livestock: [],
    purchaseLines: [],
    undatedOpenOrders: 2,
    sales: [
      {
        source: "UNAS tükör",
        product: { id: "p1", name: "Egyik" },
        startsAt: null,
        endsAt: null,
      },
    ],
    events: [
      {
        id: "e1",
        kind: "HOLIDAY",
        title: "Zárva",
        startsOn: "2026-11-10",
        endsOn: "2026-11-11",
        location: null,
        responsible: null,
      },
    ],
  } as const;
  const repo = Object.fromEntries(
    SOURCES.map((name) => [
      name,
      async () => {
        calls.push(name);
        if (name === failing) throw new Error("connection refused");
        return answer[name];
      },
    ]),
  ) as unknown as CalendarFeedRepository;
  return { repo, calls };
}

const service = (repo: CalendarFeedRepository) => {
  const s = new CalendarFeedService(repo, () => NOW);
  (s as unknown as { logger: { error(): void } }).logger = { error() {} };
  return s;
};

describe("CalendarFeedService.feed", () => {
  it("stamps the read, says the range, and counts the orders it cannot place", async () => {
    const feed = await service(repository().repo).feed(
      "2026-11-01",
      "2026-11-30",
    );
    assert.equal(feed.queriedAt, NOW.toISOString());
    assert.equal(feed.from, "2026-11-01");
    assert.equal(feed.to, "2026-11-30");
    assert.deepEqual(feed.withoutDay, { purchaseOrders: 2 });
    assert.deepEqual(
      feed.entries.map((e) => [e.kind, e.startsOn]),
      [
        ["SALE", "ismeretlen"],
        ["EVENT", "2026-11-10"],
      ],
    );
  });

  for (const failing of SOURCES)
    it(`a failing ${failing} read is a 503 that says it is NOT an empty calendar`, async () => {
      await assert.rejects(
        service(repository(failing).repo).feed("2026-11-01", "2026-11-30"),
        (error: unknown) =>
          error instanceof ServiceUnavailableException &&
          /nem üres naptár/.test(error.message),
      );
    });

  it("a bad range is a 400 that names the problem, and nothing is read", async () => {
    const { repo, calls } = repository();
    await assert.rejects(
      service(repo).feed("2026-11-30", "2026-11-01"),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /from előtt/.test(error.message),
    );
    assert.deepEqual(calls, []);
  });
});
