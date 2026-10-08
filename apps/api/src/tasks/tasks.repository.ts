import { Injectable } from "@nestjs/common";
import {
  Prisma,
  Repository,
  prisma,
  type Task,
  type User,
} from "@acropora/database";
import type {
  TaskListResponse,
  TaskPersonSummary,
  TaskStatusFilter,
  TaskSummary,
} from "@acropora/types";

/**
 * The personal board is not paginated - it is a working list for a single
 * person, not an archive. This cap keeps an unbounded query from ever
 * reaching the client; `truncated` in the response tells the UI when it
 * was hit, so a clipped list is never mistaken for a complete one.
 */
export const TASK_LIST_LIMIT = 200;

/**
 * THE ORDER, BY GROUP. Open work by due date, soonest first (#1582 P8), and
 * the undated tasks (every MANUAL and AGENT one) newest-first after them, as
 * before. Closed work stays newest-first: ordered by due date, the oldest
 * closed offer follow-ups would stand first, and the cap would push the
 * hand-made tasks out of the closed view (barracuda's #1636 review).
 */
const ORDER = {
  OPEN: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  DONE: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
} satisfies Record<"OPEN" | "DONE", Prisma.TaskOrderByWithRelationInput[]>;

type TaskWithPeople = Task & {
  assignee: Pick<User, "id" | "displayName" | "nickname">;
  createdBy: Pick<User, "id" | "displayName" | "nickname"> | null;
  closedBy: Pick<User, "id" | "displayName" | "nickname"> | null;
};

const personSelect = {
  select: { id: true, displayName: true, nickname: true },
} as const;

const taskInclude = {
  assignee: personSelect,
  createdBy: personSelect,
  closedBy: personSelect,
} satisfies Prisma.TaskInclude;

export interface CreateTaskData {
  title: string;
  description?: string;
  linkUrl?: string;
  assigneeId: string;
  createdById: string;
}

@Injectable()
export class TasksRepository extends Repository {
  constructor() {
    super(prisma);
  }

  async listForAssignee(
    assigneeId: string,
    status: TaskStatusFilter,
  ): Promise<TaskListResponse> {
    const find = (group: "OPEN" | "DONE") =>
      this.database.task.findMany({
        where: { assigneeId, status: group },
        include: taskInclude,
        orderBy: ORDER[group],
        take: TASK_LIST_LIMIT + 1,
      });
    const [tasks, openCount, doneCount] = await Promise.all([
      // ALL: open work first, each group in its own order, then the cap
      status === "ALL"
        ? Promise.all([find("OPEN"), find("DONE")]).then(([open, done]) => [
            ...open,
            ...done,
          ])
        : find(status),
      this.database.task.count({ where: { assigneeId, status: "OPEN" } }),
      this.database.task.count({ where: { assigneeId, status: "DONE" } }),
    ]);
    const truncated = tasks.length > TASK_LIST_LIMIT;
    return {
      items: tasks.slice(0, TASK_LIST_LIMIT).map((task) => toSummary(task)),
      openCount,
      doneCount,
      truncated,
    };
  }

  async assigneeOptions(): Promise<TaskPersonSummary[]> {
    const users = await this.database.user.findMany({
      where: { isActive: true },
      select: { id: true, displayName: true, nickname: true },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    });
    return users;
  }

  activeUser(id: string) {
    return this.database.user.findFirst({
      where: { id, isActive: true },
      select: { id: true, displayName: true, nickname: true },
    });
  }

  /**
   * Returns the task only when the requester is allowed to act on it: the
   * assignee, or the person who created it. Callers turn a `null` into a
   * 404 rather than a 403, so an id belonging to somebody else's task is
   * indistinguishable from an id that does not exist.
   */
  findActionable(id: string, userId: string) {
    return this.database.task.findFirst({
      where: { id, OR: [{ assigneeId: userId }, { createdById: userId }] },
      include: taskInclude,
    });
  }

  async create(data: CreateTaskData): Promise<TaskSummary> {
    const task = await this.database.task.create({
      data: {
        title: data.title,
        description: data.description ?? null,
        linkUrl: data.linkUrl ?? null,
        assigneeId: data.assigneeId,
        createdById: data.createdById,
        source: "MANUAL",
      },
      include: taskInclude,
    });
    return toSummary(task);
  }

  async close(id: string, userId: string): Promise<TaskSummary> {
    const task = await this.database.task.update({
      where: { id },
      data: { status: "DONE", closedAt: new Date(), closedById: userId },
      include: taskInclude,
    });
    return toSummary(task);
  }

  async reopen(id: string): Promise<TaskSummary> {
    const task = await this.database.task.update({
      where: { id },
      data: { status: "OPEN", closedAt: null, closedById: null },
      include: taskInclude,
    });
    return toSummary(task);
  }
}

export function toSummary(task: TaskWithPeople): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    status: task.status,
    ...(task.linkUrl ? { linkUrl: task.linkUrl } : {}),
    source: task.source,
    assignee: task.assignee,
    ...(task.createdBy ? { createdBy: task.createdBy } : {}),
    ...(task.closedBy ? { closedBy: task.closedBy } : {}),
    createdAt: task.createdAt.toISOString(),
    ...(task.closedAt ? { closedAt: task.closedAt.toISOString() } : {}),
    ...(task.dueAt ? { dueAt: task.dueAt.toISOString() } : {}),
  };
}
