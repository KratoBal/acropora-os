import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { ContentRepository } from "./content.repository.js";
import { ContentService } from "./content.service.js";

/*
  THE STATE LOG (T5.1, card db640e6a). WHAT TURNS THIS RED: a move that writes no log row, or writes it outside the move's
  transaction (a refused move leaving a row, a log failure leaving the move); the log row without who, from, to or the note
  (the revision note, the discard reason); a creation that does not start the log (from null, the state it was created in,
  the author); the log getting an edit or delete path; the detail without the history, in the order it happened, with the
  actor's name (and the id kept when the user is gone).
*/
// the Prisma client is a plain object here: the test swaps the one method it needs and puts the original back
const restorers: (() => void)[] = [];
function patch(target: object, key: string, value: unknown) {
  const holder = target as Record<string, unknown>;
  const original = holder[key];
  holder[key] = value;
  restorers.push(() => {
    holder[key] = original;
  });
}
const restoreAll = () => {
  while (restorers.length) restorers.pop()!();
};
afterEach(restoreAll);

type Written = { table: string; data: Record<string, unknown> };

/** A transaction double: `updateMany` answers `count`, every other write is recorded in order. */
function fakeTransaction(count: number, failEvent = false) {
  const written: Written[] = [];
  const tx = {
    // the row lock (T5.3, `content-row-lock.ts`): recorded, so its place in the order is visible
    $queryRaw: async () => {
      written.push({ table: "ContentItem FOR UPDATE", data: {} });
      return [{ id: "c1", state: "AWAITING_APPROVAL" }];
    },
    contentItem: {
      updateMany: async (args: { data: Record<string, unknown> }) => {
        written.push({ table: "contentItem.updateMany", data: args.data });
        return { count };
      },
      // the article step reads the channel; "OTHER" is no article, so the step ends there
      findUnique: async () => ({ channel: "OTHER", title: "t" }),
    },
    contentStateEvent: {
      create: async (args: { data: Record<string, unknown> }) => {
        if (failEvent) throw new Error("log write failed");
        written.push({ table: "contentStateEvent.create", data: args.data });
        return {};
      },
    },
    contentComment: {
      create: async (args: { data: Record<string, unknown> }) => {
        written.push({ table: "contentComment.create", data: args.data });
        return {};
      },
    },
  };
  patch(prisma, "$transaction", async (work: (t: typeof tx) => unknown) =>
    work(tx),
  );
  return written;
}

const move = (over: Record<string, unknown> = {}) =>
  new ContentRepository().moveState({
    id: "c1",
    from: "AWAITING_APPROVAL",
    to: "READY_TO_SEND",
    actorUserId: "user-1",
    ...over,
  } as never);

describe("a move writes its log row in the same transaction", () => {
  it("who, from, to and the time of the move: one row, after the state write", async () => {
    const written = fakeTransaction(1);
    assert.equal(await move(), true);
    assert.deepEqual(
      written.map((w) => w.table),
      [
        "ContentItem FOR UPDATE",
        "contentItem.updateMany",
        "contentStateEvent.create",
      ],
    );
    assert.deepEqual(written[2]!.data, {
      contentId: "c1",
      fromState: "AWAITING_APPROVAL",
      toState: "READY_TO_SEND",
      actorUserId: "user-1",
      note: null,
    });
  });

  it("the revision note and the discard reason travel with the row, and nothing else is a note", async () => {
    const revision = fakeTransaction(1);
    await move({
      to: "AWAITING_REVISION",
      note: { authorId: "user-1", body: "az ár hiányzik" },
    });
    assert.equal(
      revision.find((w) => w.table === "contentStateEvent.create")!.data.note,
      "az ár hiányzik",
    );
    restoreAll();
    const discard = fakeTransaction(1);
    await move({
      from: "DRAFTING",
      to: "DISCARDED",
      discardReason: "elavult",
    });
    assert.equal(
      discard.find((w) => w.table === "contentStateEvent.create")!.data.note,
      "elavult",
    );
    restoreAll();
    // a discard reason is not carried by another move, and neither is a stray note
    const plain = fakeTransaction(1);
    await move({ to: "READY_TO_SEND", discardReason: "nem ide való" });
    assert.equal(
      plain.find((w) => w.table === "contentStateEvent.create")!.data.note,
      null,
    );
  });

  it("a refused move (the item moved meanwhile) leaves no row", async () => {
    const written = fakeTransaction(0);
    assert.equal(await move(), false);
    assert.deepEqual(
      written.map((w) => w.table),
      ["ContentItem FOR UPDATE", "contentItem.updateMany"],
    );
  });

  it("a log write that fails fails the move: nothing is swallowed", async () => {
    fakeTransaction(1, true);
    await assert.rejects(move(), /log write failed/);
  });
});

describe("the creation starts the log", () => {
  it("from null, the state it was created in, the author; an idea by default", async () => {
    const created: Record<string, unknown>[] = [];
    patch(prisma.contentItem, "create", async (args: never) => {
      created.push((args as { data: Record<string, unknown> }).data);
      return { id: "uj" };
    });
    const repository = new ContentRepository();
    await repository.create({
      title: "t",
      channel: "OTHER",
      authorId: "user-9",
      state: "DRAFTING",
    } as never);
    await repository.create({
      title: "t2",
      channel: "OTHER",
      authorId: "user-9",
    } as never);
    assert.deepEqual(created[0]!.stateEvents, {
      create: { fromState: null, toState: "DRAFTING", actorUserId: "user-9" },
    });
    assert.deepEqual(created[1]!.stateEvents, {
      create: { fromState: null, toState: "IDEA", actorUserId: "user-9" },
    });
  });
});

describe("the log is append-only on the repository surface", () => {
  it("there is no method that edits or deletes", () => {
    const names = Object.getOwnPropertyNames(ContentRepository.prototype);
    assert.ok(names.includes("moveState"), "the probe sees the methods");
    assert.deepEqual(
      names.filter((name) => /delete|remove|purge|clear|truncate/i.test(name)),
      [],
    );
  });
});

describe("the detail carries the history", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 9, minute));
  function serviceWith(events: unknown[], names: Map<string, string>) {
    const asked: string[][] = [];
    const repository = {
      detail: async () => ({
        id: "c1",
        state: "AWAITING_APPROVAL",
        channel: "OTHER",
        imageRequired: false,
        imageAttachedAt: null,
        scheduleAnchoredAt: null,
        comments: [],
        stateEvents: events,
      }),
      userNames: async (ids: string[]) => {
        asked.push(ids);
        return names;
      },
      claimsOf: async () => [],
    } as unknown as ContentRepository;
    return { service: new ContentService(repository), asked };
  }

  it("in the order it happened, with the actor's name, the ISO time and the note; no raw rows left", async () => {
    const { service, asked } = serviceWith(
      [
        {
          id: "e1",
          fromState: null,
          toState: "DRAFTING",
          actorUserId: "u-korall",
          note: null,
          createdAt: at(12),
        },
        {
          id: "e2",
          fromState: "AWAITING_REVIEW",
          toState: "AWAITING_REVISION",
          actorUserId: "u-luca",
          note: "az ár hiányzik",
          createdAt: at(30),
        },
      ],
      new Map([
        ["u-korall", "Korall"],
        ["u-luca", "Luca"],
      ]),
    );
    const detail = (await service.detail("c1")) as unknown as {
      history: Record<string, unknown>[];
      stateEvents?: unknown;
    };
    assert.equal("stateEvents" in detail, false);
    assert.deepEqual(detail.history, [
      {
        id: "e1",
        fromState: null,
        toState: "DRAFTING",
        actorUserId: "u-korall",
        actorName: "Korall",
        note: null,
        createdAt: "2026-11-04T09:12:00.000Z",
      },
      {
        id: "e2",
        fromState: "AWAITING_REVIEW",
        toState: "AWAITING_REVISION",
        actorUserId: "u-luca",
        actorName: "Luca",
        note: "az ár hiányzik",
        createdAt: "2026-11-04T09:30:00.000Z",
      },
    ]);
    // one lookup for every actor, each asked once
    assert.deepEqual(asked, [["u-korall", "u-luca"]]);
  });

  it("a user who is gone keeps the id and has no name; an item with no log has an empty history", async () => {
    const gone = serviceWith(
      [
        {
          id: "e1",
          fromState: "DRAFTING",
          toState: "AWAITING_REVIEW",
          actorUserId: "u-torolt",
          note: null,
          createdAt: at(1),
        },
      ],
      new Map(),
    );
    const detail = (await gone.service.detail("c1")) as unknown as {
      history: { actorUserId: string; actorName: string | null }[];
    };
    assert.equal(detail.history[0]!.actorUserId, "u-torolt");
    assert.equal(detail.history[0]!.actorName, null);

    const empty = serviceWith([], new Map());
    const none = (await empty.service.detail("c1")) as unknown as {
      history: unknown[];
    };
    assert.deepEqual(none.history, []);
  });
});
