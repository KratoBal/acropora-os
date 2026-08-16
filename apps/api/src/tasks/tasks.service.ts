import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  TaskAssigneeOptionsResponse,
  TaskListResponse,
  TaskSummary,
} from "@acropora/types";

import { parseTaskLink } from "./task-link.util.js";
import { toSummary, TasksRepository } from "./tasks.repository.js";
import type { CreateTaskDto, TaskListQueryDto } from "./dto/task.dto.js";

@Injectable()
export class TasksService {
  constructor(private readonly repository: TasksRepository) {}

  listMine(userId: string, query: TaskListQueryDto): Promise<TaskListResponse> {
    return this.repository.listForAssignee(userId, query.status);
  }

  async assigneeOptions(): Promise<TaskAssigneeOptionsResponse> {
    return { items: await this.repository.assigneeOptions() };
  }

  async create(input: CreateTaskDto, userId: string): Promise<TaskSummary> {
    const title = input.title.trim();
    if (!title) throw new BadRequestException("A feladat címe nem lehet üres.");

    const link = parseTaskLink(input.linkUrl);
    if (!link.valid)
      throw new BadRequestException(
        "A hivatkozásnak teljes http:// vagy https:// címnek kell lennie.",
      );

    const assigneeId = input.assigneeId?.trim() || userId;
    if (
      assigneeId !== userId &&
      !(await this.repository.activeUser(assigneeId))
    )
      throw new BadRequestException(
        "A megadott felelős nem található vagy inaktív.",
      );

    const description = input.description?.trim();
    return this.repository.create({
      title,
      ...(description ? { description } : {}),
      ...(link.value ? { linkUrl: link.value } : {}),
      assigneeId,
      createdById: userId,
    });
  }

  async close(id: string, userId: string): Promise<TaskSummary> {
    const task = await this.actionable(id, userId);
    if (task.status === "DONE") return toSummary(task);
    return this.repository.close(id, userId);
  }

  async reopen(id: string, userId: string): Promise<TaskSummary> {
    const task = await this.actionable(id, userId);
    if (task.status === "OPEN") return toSummary(task);
    return this.repository.reopen(id);
  }

  /**
   * A task the requester may not act on is reported as missing, not as
   * forbidden: a 403 would confirm that the id exists and belongs to
   * somebody else.
   */
  private async actionable(id: string, userId: string) {
    const task = await this.repository.findActionable(id, userId);
    if (!task) throw new NotFoundException("A feladat nem található.");
    return task;
  }
}
