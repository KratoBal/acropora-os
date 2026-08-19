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
    const where: Prisma.TaskWhereInput = {
      assigneeId,
      ...(status === "ALL" ? {} : { status }),
    };
    const [tasks, openCount, doneCount] = await Promise.all([
      this.database.task.findMany({
        where,
        include: taskInclude,
        // The enum is declared OPEN, DONE, and PostgreSQL orders enum values
        // by declaration order - so ascending status puts open work first,
        // and newest-first within each group.
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: TASK_LIST_LIMIT + 1,
      }),
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
  };
}
