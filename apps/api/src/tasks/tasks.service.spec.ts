import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import type { TasksRepository } from "./tasks.repository.js";
import { TasksService } from "./tasks.service.js";

const owner = { id: "user-balazs", displayName: "Balázs" };
const other = { id: "user-luca", displayName: "Luca" };

const taskRow = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  title: "Nyers termékexport",
  description: "Enélkül polip nem tud importra kész fájlt adni.",
  status: "OPEN" as const,
  linkUrl: null,
  source: "MANUAL" as const,
  sourceRef: null,
  assigneeId: owner.id,
  createdById: owner.id,
  closedById: null,
  closedAt: null,
  createdAt: new Date("2026-08-16T10:00:00.000Z"),
  updatedAt: new Date("2026-08-16T10:00:00.000Z"),
  assignee: owner,
  createdBy: owner,
  closedBy: null,
  ...overrides,
});

const repository = (overrides: Record<string, unknown> = {}) =>
  ({
    listForAssignee: async () => ({
      items: [],
      openCount: 0,
      doneCount: 0,
      truncated: false,
    }),
    assigneeOptions: async () => [owner, other],
    activeUser: async () => other,
    findActionable: async () => taskRow(),
    create: async (data: Record<string, unknown>) => ({
      id: "task-new",
      ...data,
    }),
    close: async () => ({ id: "task-1", status: "DONE" }),
    reopen: async () => ({ id: "task-1", status: "OPEN" }),
    ...overrides,
  }) as unknown as TasksRepository;

describe("TasksService", () => {
  it("assigns the task to the caller when no assignee is given", async () => {
    const created = (await new TasksService(repository()).create(
      { title: "Kategóriafa export" },
      owner.id,
    )) as unknown as { assigneeId: string; createdById: string };
    assert.equal(created.assigneeId, owner.id);
    assert.equal(created.createdById, owner.id);
  });

  it("lets a user assign a task to another active user", async () => {
    const created = (await new TasksService(repository()).create(
      { title: "Márkalista", assigneeId: other.id },
      owner.id,
    )) as unknown as { assigneeId: string };
    assert.equal(created.assigneeId, other.id);
  });

  it("rejects an unknown or inactive assignee", async () =>
    assert.rejects(
      () =>
        new TasksService(repository({ activeUser: async () => null })).create(
          { title: "Árlista", assigneeId: "user-ghost" },
          owner.id,
        ),
      BadRequestException,
    ));

  it("does not look up the assignee when assigning to oneself", async () => {
    let looked = false;
    await new TasksService(
      repository({
        activeUser: async () => {
          looked = true;
          return null;
        },
      }),
    ).create({ title: "Saját tétel", assigneeId: owner.id }, owner.id);
    assert.equal(looked, false);
  });

  it("rejects a title that is only whitespace", async () =>
    assert.rejects(
      () => new TasksService(repository()).create({ title: "   " }, owner.id),
      BadRequestException,
    ));

  it("rejects a link that is not an absolute http(s) URL", async () =>
    assert.rejects(
      () =>
        new TasksService(repository()).create(
          { title: "Kérdés", linkUrl: "javascript:alert(1)" },
          owner.id,
        ),
      BadRequestException,
    ));

  it("trims the description and drops it when empty", async () => {
    const created = (await new TasksService(repository()).create(
      { title: "Kérdés", description: "   " },
      owner.id,
    )) as unknown as { description?: string };
    assert.equal(created.description, undefined);
  });

  it("reports somebody else's task as missing, not as forbidden", async () =>
    assert.rejects(
      () =>
        new TasksService(
          repository({ findActionable: async () => null }),
        ).close("task-1", owner.id),
      NotFoundException,
    ));

  it("closing an already closed task is a no-op", async () => {
    let closed = false;
    const service = new TasksService(
      repository({
        findActionable: async () =>
          taskRow({ status: "DONE", closedAt: new Date(), closedBy: owner }),
        close: async () => {
          closed = true;
          return { id: "task-1" };
        },
      }),
    );
    const result = await service.close("task-1", owner.id);
    assert.equal(closed, false);
    assert.equal(result.status, "DONE");
  });

  it("reopening an open task is a no-op", async () => {
    let reopened = false;
    const service = new TasksService(
      repository({
        reopen: async () => {
          reopened = true;
          return { id: "task-1" };
        },
      }),
    );
    const result = await service.reopen("task-1", owner.id);
    assert.equal(reopened, false);
    assert.equal(result.status, "OPEN");
  });

  it("records who closed the task", async () => {
    let closedBy: string | undefined;
    await new TasksService(
      repository({
        close: async (_id: string, userId: string) => {
          closedBy = userId;
          return { id: "task-1", status: "DONE" };
        },
      }),
    ).close("task-1", other.id);
    assert.equal(closedBy, other.id);
  });

  it("lists only the caller's own board", async () => {
    let requested: string | undefined;
    await new TasksService(
      repository({
        listForAssignee: async (assigneeId: string) => {
          requested = assigneeId;
          return { items: [], openCount: 0, doneCount: 0, truncated: false };
        },
      }),
    ).listMine(owner.id, { status: "ALL" });
    assert.equal(requested, owner.id);
  });
});
