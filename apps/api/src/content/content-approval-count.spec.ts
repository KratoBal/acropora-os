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

  it("the service answers the repository's number as a total", async () => {
    const service = new ContentService({
      countAwaitingApproval: async () => 4,
    } as unknown as ContentRepository);
    assert.deepEqual(await service.awaitingApproval(), { total: 4 });
  });
});
