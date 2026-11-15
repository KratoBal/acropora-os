import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import type { ContentResultsRepository } from "./content-results.repository.js";
import { ContentResultsService } from "./content-results.service.js";

/*
  A WEEK'S NUMBERS, THE RULES (T5.5 S8). What turns this red: numbers on an item that has not gone out; a week given by a
  day that is not its Monday; a week before the item's sending week or after the current one; an empty entry; a machine
  account writing; an unknown range accepted for the summary.
*/
const PERSON = { id: "u1", role: "MANAGER" as const };
// sent on Wednesday 2026-11-04 (Budapest); "now" is Sunday 2026-11-15
function fake(sentAt: Date | null = new Date("2026-11-04T10:00:00Z")) {
  const saved: unknown[] = [];
  const repo = {
    item: async (id: string) =>
      id === "missing"
        ? null
        : { id, sentAt, state: sentAt ? "SENT" : "DRAFTING" },
    weeks: async () => [],
    saveWeek: async (...args: unknown[]) => {
      saved.push(args);
    },
  } as unknown as ContentResultsRepository;
  return {
    service: new ContentResultsService(
      repo,
      () => new Date("2026-11-15T12:00:00Z"),
    ),
    saved,
  };
}

describe("ContentResultsService.saveWeek", () => {
  it("the sending week and the current week are accepted; an entered number is kept, the rest is null", async () => {
    const { service, saved } = fake();
    await service.saveWeek("c1", "2026-11-02", { reach: 120 }, PERSON);
    await service.saveWeek("c1", "2026-11-09", { clicks: 0 }, PERSON);
    assert.deepEqual(saved[0], [
      "c1",
      "2026-11-02",
      {
        reach: 120,
        reactions: null,
        opens: null,
        clicks: null,
        preorders: null,
        orders: null,
      },
      "u1",
    ]);
    // 0 is a number, not "not entered"
    const [, , second] = saved[1] as [
      string,
      string,
      { clicks: number | null },
    ];
    assert.equal(second.clicks, 0);
  });

  for (const [what, week, input, pattern] of [
    ["a day that is not a Monday", "2026-11-03", { reach: 1 }, /hétfőjével/],
    ["an impossible day", "2026-02-30", { reach: 1 }, /hétfőjével/],
    [
      "a week before the sending week",
      "2026-10-26",
      { reach: 1 },
      /kiküldés hete előtt/,
    ],
    [
      "a week after the current one",
      "2026-11-16",
      { reach: 1 },
      /mostani hét után/,
    ],
    ["an empty entry", "2026-11-02", {}, /legalább egy számot/],
  ] as const)
    it(`refuses ${what} with a 400 that names it, and saves nothing`, async () => {
      const { service, saved } = fake();
      await assert.rejects(
        service.saveWeek("c1", week, input, PERSON),
        (error: unknown) =>
          error instanceof BadRequestException && pattern.test(error.message),
      );
      assert.deepEqual(saved, []);
    });

  it("an item that has not gone out takes no numbers; a missing one is a 404; a machine account is a 403", async () => {
    await assert.rejects(
      fake(null).service.saveWeek("c1", "2026-11-09", { reach: 1 }, PERSON),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /még nem ment ki/.test(error.message),
    );
    await assert.rejects(
      fake().service.saveWeek("missing", "2026-11-09", { reach: 1 }, PERSON),
      NotFoundException,
    );
    const { service, saved } = fake();
    await assert.rejects(
      service.saveWeek(
        "c1",
        "2026-11-09",
        { reach: 1 },
        { id: "a", role: "CONTENT_AGENT" },
      ),
      ForbiddenException,
    );
    assert.deepEqual(saved, []);
  });
});

describe("ContentResultsService.summary", () => {
  it("refuses a reversed or a too long range", async () => {
    const { service } = fake();
    for (const [from, to] of [
      ["2026-11", "2026-10"],
      ["2025-11", "2026-11"],
      ["2026-13", "2026-13"],
    ] as const)
      await assert.rejects(service.summary(from, to), BadRequestException);
  });
});
