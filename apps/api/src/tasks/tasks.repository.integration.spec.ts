import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { TasksRepository } from "./tasks.repository.js";

// The scoping guarantee of the personal board ("you only ever see your own
// tasks") and the idempotency guarantee of machine ingest are both
// database-level properties - a mocked repository can only prove that the
// service asked for the right thing, not that Postgres enforces it.
//
// This suite writes and deletes rows, so it runs only against a database
// named for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);

// Every row this suite creates carries this domain, so a run that was killed
// before its cleanup does not poison the next one.
const TEST_EMAIL_DOMAIN = "tasks-integration.invalid";

describe("TasksRepository integration", { skip: gate.mode === "skip" }, () => {
  const suffix = Date.now();
  const repository = new TasksRepository();
  let ownerId: string;
  let otherId: string;

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    const owner = await prisma.user.create({
      data: {
        email: `tasks-owner-${suffix}@${TEST_EMAIL_DOMAIN}`,
        displayName: "Tasks Integration Owner",
        role: "OWNER",
        isActive: true,
      },
    });
    const other = await prisma.user.create({
      data: {
        email: `tasks-other-${suffix}@${TEST_EMAIL_DOMAIN}`,
        displayName: "Tasks Integration Other",
        role: "MANAGER",
        isActive: true,
      },
    });
    ownerId = owner.id;
    otherId = other.id;
  });

  after(async () => {
    if (gate.mode !== "run") return;
    await removeLeftovers();
  });

  /**
   * Deletes only rows this suite could have written, matched by the test
   * e-mail domain. Runs before as well as after, so an aborted run cleans up
   * on the next attempt instead of leaving debris behind.
   */
  async function removeLeftovers() {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `@${TEST_EMAIL_DOMAIN}` } },
      select: { id: true },
    });
    if (!users.length) return;
    const ids = users.map((user) => user.id);
    await prisma.task.deleteMany({
      where: {
        OR: [{ assigneeId: { in: ids } }, { createdById: { in: ids } }],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  it("lists only the tasks assigned to the requester", async () => {
    await repository.create({
      title: "Owner tétel",
      assigneeId: ownerId,
      createdById: ownerId,
    });
    await repository.create({
      title: "Other tétel",
      assigneeId: otherId,
      createdById: ownerId,
    });

    const ownerBoard = await repository.listForAssignee(ownerId, "ALL");
    assert.equal(ownerBoard.items.length, 1);
    assert.equal(ownerBoard.items[0]?.title, "Owner tétel");
    assert.equal(ownerBoard.openCount, 1);

    const otherBoard = await repository.listForAssignee(otherId, "ALL");
    assert.equal(otherBoard.items.length, 1);
    assert.equal(otherBoard.items[0]?.title, "Other tétel");
  });

  it("does not return another user's task as actionable", async () => {
    const task = await repository.create({
      title: "Csak a felelősé",
      assigneeId: otherId,
      createdById: otherId,
    });
    assert.equal(await repository.findActionable(task.id, ownerId), null);
    assert.notEqual(await repository.findActionable(task.id, otherId), null);
  });

  it("keeps a task actionable for the person who created it", async () => {
    const task = await repository.create({
      title: "Kérdés Lucának",
      assigneeId: otherId,
      createdById: ownerId,
    });
    assert.notEqual(await repository.findActionable(task.id, ownerId), null);
  });

  it("closes and reopens a task, tracking who closed it", async () => {
    const task = await repository.create({
      title: "Lezárható",
      assigneeId: ownerId,
      createdById: ownerId,
    });

    const closed = await repository.close(task.id, ownerId);
    assert.equal(closed.status, "DONE");
    assert.equal(closed.closedBy?.id, ownerId);
    assert.ok(closed.closedAt);

    const reopened = await repository.reopen(task.id);
    assert.equal(reopened.status, "OPEN");
    assert.equal(reopened.closedBy, undefined);
    assert.equal(reopened.closedAt, undefined);
  });

  it("filters by status and counts both buckets", async () => {
    const done = await repository.create({
      title: "Számolható",
      assigneeId: ownerId,
      createdById: ownerId,
    });
    await repository.close(done.id, ownerId);

    const openOnly = await repository.listForAssignee(ownerId, "OPEN");
    assert.ok(openOnly.items.every((item) => item.status === "OPEN"));
    assert.ok(openOnly.doneCount >= 1);

    const doneOnly = await repository.listForAssignee(ownerId, "DONE");
    assert.ok(doneOnly.items.every((item) => item.status === "DONE"));
    assert.ok(doneOnly.openCount >= 1);
  });

  it("puts open tasks before closed ones", async () => {
    const board = await repository.listForAssignee(ownerId, "ALL");
    const firstDone = board.items.findIndex((item) => item.status === "DONE");
    const lastOpen = board.items.reduce(
      (last, item, index) => (item.status === "OPEN" ? index : last),
      -1,
    );
    if (firstDone !== -1 && lastOpen !== -1) assert.ok(lastOpen < firstDone);
  });

  it("rejects a duplicate machine source reference but allows many manual ones", async () => {
    const sourceRef = `agent-test-${suffix}`;
    await prisma.task.create({
      data: {
        title: "Gépi tétel",
        assigneeId: ownerId,
        source: "AGENT",
        sourceRef,
      },
    });
    await assert.rejects(
      () =>
        prisma.task.create({
          data: {
            title: "Gépi tétel újra",
            assigneeId: ownerId,
            source: "AGENT",
            sourceRef,
          },
        }),
      (error: unknown) =>
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002",
    );

    // Manual tasks carry a NULL sourceRef, and in PostgreSQL every NULL is
    // distinct from every other NULL - so the unique index never limits how
    // many tasks a person can enter by hand.
    await repository.create({
      title: "Kézi egy",
      assigneeId: ownerId,
      createdById: ownerId,
    });
    await repository.create({
      title: "Kézi kettő",
      assigneeId: ownerId,
      createdById: ownerId,
    });
  });

  it("lists only active users as assignee options", async () => {
    await prisma.user.update({
      where: { id: otherId },
      data: { isActive: false },
    });
    const options = await repository.assigneeOptions();
    assert.ok(!options.some((option) => option.id === otherId));
    assert.equal(await repository.activeUser(otherId), null);

    await prisma.user.update({
      where: { id: otherId },
      data: { isActive: true },
    });
    assert.notEqual(await repository.activeUser(otherId), null);
  });
});
