import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  VOCABULARY_KINDS,
  type VocabularyKind,
} from "@acropora/knowledge-base";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  VocabularyInputError,
  parseNewEntry,
  workingRows,
} from "./vocabulary-versions.js";
import {
  VocabularyConflict,
  VocabularyEntryNotFound,
  VocabularyRepository,
} from "./vocabulary.repository.js";

export const VOCABULARY_REPOSITORY = Symbol("VOCABULARY_REPOSITORY");

export type VocabularyStore = Pick<
  VocabularyRepository,
  "versions" | "state" | "probe" | "addEntry" | "editEntry" | "approve"
>;

export const MAX_PROBE = 1_000;

@Injectable()
export class VocabularyService {
  private readonly repository: VocabularyStore;

  constructor(
    @Optional()
    @Inject(VOCABULARY_REPOSITORY)
    repository: VocabularyStore | null = null,
  ) {
    this.repository = repository ?? new VocabularyRepository();
  }

  state() {
    return this.repository.state();
  }

  probe(body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const sentence = typeof b.sentence === "string" ? b.sentence.trim() : "";
    if (!sentence || sentence.length > MAX_PROBE)
      throw new BadRequestException(
        `sentence: a non-empty text of at most ${MAX_PROBE} characters`,
      );
    return this.repository.probe(
      sentence,
      b.use === "DRAFT" ? "DRAFT" : "APPROVED",
    );
  }

  add(body: unknown, user: AuthenticatedUser) {
    return this.mapped(async () => {
      const rows = workingRows(await this.repository.versions());
      return this.repository.addEntry(parseNewEntry(body, rows), user.id);
    });
  }

  edit(kind: string, key: string, body: unknown, user: AuthenticatedUser) {
    return this.mapped(async () => {
      if (!(VOCABULARY_KINDS as readonly string[]).includes(kind))
        throw new VocabularyEntryNotFound(`${kind}/${key}`);
      return this.repository.editEntry(
        kind as VocabularyKind,
        key,
        body,
        user.id,
      );
    });
  }

  approve(body: unknown, user: AuthenticatedUser) {
    return this.mapped(async () => {
      const b = (body ?? {}) as Record<string, unknown>;
      if (typeof b.version !== "number" || !Number.isInteger(b.version))
        throw new VocabularyInputError(
          "BAD_VERSION",
          "version: the draft version you approve",
        );
      if (
        typeof b.fingerprint !== "string" ||
        !/^[0-9a-f]{64}$/.test(b.fingerprint)
      )
        throw new VocabularyInputError(
          "BAD_FINGERPRINT",
          "fingerprint: the draft's fingerprint as you saw it",
        );
      return this.repository.approve(b.version, b.fingerprint, user.id);
    });
  }

  private async mapped<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof VocabularyInputError)
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      if (error instanceof VocabularyEntryNotFound)
        throw new NotFoundException("Nincs ilyen szótár-elem.");
      if (error instanceof VocabularyConflict)
        throw new ConflictException(error.message);
      throw error;
    }
  }
}

/**
 * SZAKMAI SZÓTÁRAK (S5, a K4 kezelése, Figma 3:425). Olvasás és próba
 * `knowledge.view`, szerkesztés `knowledge.manage`, a változat jóváhagyása
 * `knowledge.approve` joggal (Balázsé, acrobot 35807, 35810). Minden írás a
 * következő változat tervezetébe megy, AuditLog-sorral.
 */
@Controller("knowledge-base/vocabulary")
export class VocabularyController {
  constructor(private readonly vocabulary: VocabularyService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  state() {
    return this.vocabulary.state();
  }

  @Post("probe")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  probe(@Body() body: Record<string, unknown>) {
    return this.vocabulary.probe(body);
  }

  @Post("entries")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  add(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vocabulary.add(body, user);
  }

  @Patch("entries/:kind/:key")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  edit(
    @Param("kind") kind: string,
    @Param("key") key: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vocabulary.edit(kind, key, body, user);
  }

  @Post("draft/approve")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_APPROVE)
  approve(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vocabulary.approve(body, user);
  }
}
