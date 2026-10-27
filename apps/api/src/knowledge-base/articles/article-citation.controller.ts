import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  Param,
  Post,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { parseAnswerInput, parseCitationInput } from "./article-citation.js";
import {
  ArticleCitationConflict,
  ArticleCitationInvalid,
  ArticleCitationNotFound,
  ArticleCitationRepository,
  type ArticleCitationReport,
} from "./article-citation.repository.js";

/** The repository, injectable for the tests. */
export const ARTICLE_CITATION_REPOSITORY = Symbol(
  "ARTICLE_CITATION_REPOSITORY",
);

export type ArticleCitationStore = Pick<
  ArticleCitationRepository,
  "report" | "add" | "remove" | "answer"
>;

@Injectable()
export class ArticleCitationService {
  private readonly repository: ArticleCitationStore;

  constructor(
    @Optional()
    @Inject(ARTICLE_CITATION_REPOSITORY)
    repository: ArticleCitationStore | null = null,
  ) {
    this.repository = repository ?? new ArticleCitationRepository();
  }

  report(contentId: string): Promise<ArticleCitationReport> {
    return this.mapped(() => this.repository.report(contentId));
  }

  async add(
    contentId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<ArticleCitationReport> {
    const parsed = parseCitationInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    return this.mapped(() =>
      this.repository.add(contentId, parsed.value, user.id),
    );
  }

  remove(
    contentId: string,
    citationId: string,
    user: AuthenticatedUser,
  ): Promise<ArticleCitationReport> {
    return this.mapped(() =>
      this.repository.remove(contentId, citationId, user.id),
    );
  }

  async answer(
    contentId: string,
    citationId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<ArticleCitationReport> {
    const parsed = parseAnswerInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    return this.mapped(() =>
      this.repository.answer(contentId, citationId, parsed.value, user.id),
    );
  }

  private async mapped<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ArticleCitationNotFound)
        throw new NotFoundException(error.message);
      if (error instanceof ArticleCitationInvalid)
        throw new BadRequestException([error.message]);
      if (error instanceof ArticleCitationConflict)
        throw new ConflictException(error.message);
      throw error;
    }
  }
}

/**
 * A CIKK HIVATKOZÁSAI (S5): melyik mondat melyik VERIFIED állításra vagy
 * jóváhagyott következtetésre épül, és a hivatkozás-ellenőrző jelentése.
 * Olvasás `knowledge.view`, írás és a figyelmeztetések megválaszolása
 * `knowledge.manage` joggal; minden írás AuditLog-sort ír.
 */
@Controller("knowledge-base/articles/:contentId/citations")
export class ArticleCitationController {
  constructor(private readonly citations: ArticleCitationService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  report(@Param("contentId") contentId: string) {
    return this.citations.report(contentId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  add(
    @Param("contentId") contentId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.citations.add(contentId, body, user);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  remove(
    @Param("contentId") contentId: string,
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.citations.remove(contentId, id, user);
  }

  @Post(":id/answer")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  answer(
    @Param("contentId") contentId: string,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.citations.answer(contentId, id, body, user);
  }
}
