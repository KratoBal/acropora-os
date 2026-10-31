import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import {
  parseScreeningDecision,
  parseSourceListQuery,
  parseStudyTypeDecision,
} from "./source-screening.js";
import {
  SourceClassifyRefused,
  SourceNotFound,
  SourceScreeningRepository,
  type ScreeningSummary,
  type SourceList,
  type SourceRow,
} from "./source-screening.repository.js";

/** The repository, injectable for the tests. */
export const SOURCE_SCREENING_REPOSITORY = Symbol(
  "SOURCE_SCREENING_REPOSITORY",
);

export type SourceScreeningStore = Pick<
  SourceScreeningRepository,
  "list" | "summary" | "decide" | "classify"
>;

@Injectable()
export class SourceScreeningService {
  private readonly repository: SourceScreeningStore;

  constructor(
    @Optional()
    @Inject(SOURCE_SCREENING_REPOSITORY)
    repository: SourceScreeningStore | null = null,
  ) {
    this.repository = repository ?? new SourceScreeningRepository();
  }

  async list(query: Record<string, unknown>): Promise<SourceList> {
    const parsed = parseSourceListQuery(query);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    return this.repository.list(parsed.value);
  }

  summary(): Promise<ScreeningSummary> {
    return this.repository.summary();
  }

  async decide(
    sourceId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<SourceRow> {
    const parsed = parseScreeningDecision(body);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    try {
      return await this.repository.decide(sourceId, parsed.value, user.id);
    } catch (error) {
      if (error instanceof SourceNotFound)
        throw new NotFoundException("Nincs ilyen forrás.");
      throw error;
    }
  }

  async classify(
    sourceId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<SourceRow> {
    const parsed = parseStudyTypeDecision(body);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    try {
      return await this.repository.classify(sourceId, parsed.value, user.id);
    } catch (error) {
      if (error instanceof SourceNotFound)
        throw new NotFoundException("Nincs ilyen forrás.");
      if (error instanceof SourceClassifyRefused)
        throw new ConflictException(error.message);
      throw error;
    }
  }
}
