import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { TaskIngestResult } from "@acropora/types";

export interface IngestTaskData {
  title: string;
  description?: string;
  linkUrl?: string;
  assigneeId: string;
  sourceRef: string;
  tokenSlug: string;
}

@Injectable()
export class TaskIngestRepository extends Repository {
  constructor() {
    super(prisma);
  }

  activeUserByEmail(email: string) {
    return this.database.user.findFirst({
      where: { email: email.trim().toLowerCase(), isActive: true },
      select: { id: true },
    });
  }

  async findBySourceRef(sourceRef: string): Promise<TaskIngestResult | null> {
    const task = await this.database.task.findUnique({
      where: { source_sourceRef: { source: "AGENT", sourceRef } },
      select: { id: true, status: true },
    });
    return task ? { id: task.id, status: task.status, created: false } : null;
  }

  /**
   * How many tasks this token filed since `since`. Counted from the stored
   * rows rather than from a counter column, so the cap cannot drift out of
   * sync with reality.
   */
  countIngestedSince(tokenSlug: string, since: Date): Promise<number> {
    return this.database.task.count({
      where: {
        source: "AGENT",
        sourceRef: { startsWith: `${tokenSlug}:` },
        createdAt: { gte: since },
      },
    });
  }

  /**
   * Writes the task and its audit trail in one transaction. `createdById`
   * stays NULL because there is no acting user; the acting service token is
   * recorded in the audit metadata instead. Neither the title nor the
   * description is logged - they carry the caller's content, and an audit
   * row is not the place for it.
   */
  async ingest(data: IngestTaskData): Promise<TaskIngestResult> {
    return this.database.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          title: data.title,
          description: data.description ?? null,
          linkUrl: data.linkUrl ?? null,
          assigneeId: data.assigneeId,
          source: "AGENT",
          sourceRef: data.sourceRef,
        },
        select: { id: true, status: true },
      });
      await tx.auditLog.create({
        data: {
          userId: null,
          action: "task.ingested",
          entityType: "Task",
          entityId: task.id,
          metadata: {
            serviceToken: data.tokenSlug,
            sourceRef: data.sourceRef,
          } satisfies Prisma.JsonObject,
        },
      });
      return { id: task.id, status: task.status, created: true };
    });
  }
}
