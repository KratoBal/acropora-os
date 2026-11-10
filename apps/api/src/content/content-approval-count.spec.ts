import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { ContentRepository } from "./content.repository.js";
import { ContentService } from "./content.service.js";

/*
  THE COUNT OF CONTENT WAITING FOR APPROVAL (T5.1 PR2). WHAT TURNS THIS RED: the count taken over another state (the review
  stage, the revision stage, the ready-to-send stage are not "waiting for an approver"); the count narrowed to a viewer or an
  author (the approval is every approver's, and the Rám vár approver view is not narrowed); the service answering anything but
  the repository's number.
*/
const restorers: (() => void)[] = [];
afterEach(() => {
  while (restorers.length) restorers.pop()!();
});

describe("awaiting approval", () => {
  it("the repository counts the items in AWAITING_APPROVAL, all of them, and nothing else", async () => {
    const asked: unknown[] = [];
    const delegate = prisma.contentItem as unknown as Record<string, unknown>;
    const original = delegate.count;
    delegate.count = async (args: unknown) => {
      asked.push(args);
      return 7;
    };
    restorers.push(() => {
      delegate.count = original;
    });
    assert.equal(await new ContentRepository().countAwaitingApproval(), 7);
    assert.deepEqual(asked, [{ where: { state: "AWAITING_APPROVAL" } }]);
  });

  it("the service counts the items and the ones that have waited 48 hours or more", async () => {
    const now = new Date("2026-11-10T20:00:00.000Z");
    const hoursAgo = (hours: number) =>
      new Date(now.getTime() - hours * 3_600_000);
    const service = new ContentService({
      awaitingApprovalSince: async () => [
        hoursAgo(1),
        hoursAgo(47.99),
        hoursAgo(48),
        hoursAgo(200),
      ],
    } as unknown as ContentRepository);
    assert.deepEqual(await service.awaitingApproval(now), {
      total: 4,
      overdue: 2,
    });
  });

  it("the repository reads each item's LAST move into the stage from the log, and falls back to its last update", async () => {
    const asked: unknown[] = [];
    const delegate = prisma.contentItem as unknown as Record<string, unknown>;
    const original = delegate.findMany;
    const logged = new Date("2026-11-08T10:00:00.000Z");
    const updated = new Date("2026-11-09T10:00:00.000Z");
    delegate.findMany = async (args: unknown) => {
      asked.push(args);
      return [
        { updatedAt: updated, stateEvents: [{ createdAt: logged }] },
        { updatedAt: updated, stateEvents: [] },
      ];
    };
    restorers.push(() => {
      delegate.findMany = original;
    });
    assert.deepEqual(await new ContentRepository().awaitingApprovalSince(), [
      logged,
      updated,
    ]);
    const args = asked[0] as {
      where: unknown;
      select: {
        stateEvents: { where: unknown; orderBy: unknown; take: number };
      };
    };
    assert.deepEqual(args.where, { state: "AWAITING_APPROVAL" });
    assert.deepEqual(args.select.stateEvents.where, {
      toState: "AWAITING_APPROVAL",
    });
    assert.equal(args.select.stateEvents.take, 1);
    assert.deepEqual(args.select.stateEvents.orderBy, [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });
});
