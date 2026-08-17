import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma, type ServiceToken } from "@acropora/database";
import type { TaskIngestResult } from "@acropora/types";

import { parseTaskLink } from "./task-link.util.js";
import { ServiceTokenRepository } from "./service-token.repository.js";
import { TaskIngestRepository } from "./task-ingest.repository.js";
import type { IngestTaskDto } from "./dto/task-ingest.dto.js";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TaskIngestService {
  private readonly logger = new Logger(TaskIngestService.name);

  constructor(
    private readonly repository: TaskIngestRepository,
    private readonly tokens: ServiceTokenRepository,
  ) {}

  async ingest(
    input: IngestTaskDto,
    token: ServiceToken,
  ): Promise<TaskIngestResult> {
    const title = input.title.trim();
    if (!title) throw new BadRequestException("A feladat címe nem lehet üres.");

    const link = parseTaskLink(input.linkUrl);
    if (!link.valid)
      throw new BadRequestException(
        "A hivatkozásnak teljes http:// vagy https:// címnek kell lennie.",
      );

    // The namespace is taken from the authenticated token, never from the
    // payload. A caller cannot file a task under another caller's prefix,
    // and cannot collide with one either.
    const sourceRef = `${token.slug}:${input.reference.trim()}`;

    const existing = await this.repository.findBySourceRef(sourceRef);
    if (existing) {
      void this.touch(token.id);
      return existing;
    }

    const assignee = await this.repository.activeUserByEmail(
      input.assigneeEmail,
    );
    if (!assignee)
      throw new UnprocessableEntityException("Ismeretlen felelős.");

    const used = await this.repository.countIngestedSince(
      token.slug,
      new Date(Date.now() - DAY_MS),
    );
    if (used >= token.dailyLimit)
      throw new HttpException(
        "A token napi felviteli kerete elfogyott.",
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const description = input.description?.trim();

    try {
      const result = await this.repository.ingest({
        title,
        ...(description ? { description } : {}),
        ...(link.value ? { linkUrl: link.value } : {}),
        assigneeId: assignee.id,
        sourceRef,
        tokenSlug: token.slug,
      });
      void this.touch(token.id);
      return result;
    } catch (error) {
      // Two identical calls in flight at once: the loser of the race hits
      // the [source, sourceRef] unique index. That is the idempotency
      // guarantee working, not a failure, so resolve to the winner's row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await this.repository.findBySourceRef(sourceRef);
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * `lastUsedAt` is operational bookkeeping, not part of the result. A
   * failure to record it must not turn a successfully filed task into an
   * error for the caller.
   */
  private async touch(id: string): Promise<void> {
    try {
      await this.tokens.touch(id);
    } catch (error) {
      this.logger.warn(
        `Failed to record service token usage: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
}
