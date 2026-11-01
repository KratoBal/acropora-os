import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Optional,
  Post,
  Query,
} from "@nestjs/common";
import type { Vocabulary } from "@acropora/knowledge-base";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { VocabularyRepository } from "../vocabulary/vocabulary.repository.js";
import {
  FLAG_LIMITS,
  FLAG_TARGETS,
  parseFlagWrite,
  parseLimit,
  parseTarget,
  type FlagView,
  type FlagWriteResult,
} from "./model-flag.js";
import { ModelFlagRepository } from "./model-flag.repository.js";

export type ModelFlagStore = Pick<
  ModelFlagRepository,
  "pending" | "write" | "latest"
>;

export interface ModelFlagDeps {
  store: ModelFlagStore;
  approvedVocabulary: () => Promise<Vocabulary>;
}

/** The dependencies, injectable for the tests. */
export const MODEL_FLAG_DEPS = Symbol("MODEL_FLAG_DEPS");

const ID = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class ModelFlagService {
  private readonly deps: ModelFlagDeps;

  constructor(
    @Optional()
    @Inject(MODEL_FLAG_DEPS)
    deps: ModelFlagDeps | null = null,
  ) {
    this.deps = deps ?? {
      store: new ModelFlagRepository(),
      approvedVocabulary: () => new VocabularyRepository().approvedVocabulary(),
    };
  }

  async pending(query: Record<string, unknown>) {
    const targetType = parseTarget(query.targetType);
    const limit = parseLimit(query.limit);
    const problems = [
      ...(targetType === null
        ? [`targetType: ${FLAG_TARGETS.join(" vagy ")}.`]
        : []),
      ...(limit === null ? [`limit: 1-${FLAG_LIMITS.perRequest}.`] : []),
    ];
    if (problems.length > 0) throw new BadRequestException(problems);
    return this.deps.store.pending(
      targetType!,
      limit!,
      await this.deps.approvedVocabulary(),
    );
  }

  async write(
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<FlagWriteResult> {
    const parsed = parseFlagWrite(body);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    return this.deps.store.write(
      parsed.value,
      user.id,
      await this.deps.approvedVocabulary(),
    );
  }

  async latest(
    query: Record<string, unknown>,
  ): Promise<Record<string, FlagView | null>> {
    const targetType = parseTarget(query.targetType);
    const ids =
      typeof query.ids === "string" && query.ids !== ""
        ? [...new Set(query.ids.split(","))]
        : [];
    if (
      targetType === null ||
      ids.length === 0 ||
      ids.length > 500 ||
      !ids.every((id) => ID.test(id))
    )
      throw new BadRequestException([
        `targetType: ${FLAG_TARGETS.join(" vagy ")}; ids: 1-500 azonosító, vesszővel.`,
      ]);
    return this.deps.store.latest(
      targetType,
      ids,
      await this.deps.approvedVocabulary(),
    );
  }
}

/**
 * A MÁSODIK MODELL JELZÉSEI (terv v4, 7a 3.; S4). A flotta húzza a jelzésre
 * váró tételeket (`knowledge.view`) és tolja vissza a jelzéseket
 * (`knowledge.manage`); az OS semmit nem hív kifelé. Írás csak hozzáfűzés,
 * AuditLog-sorral; a jelzés egyetlen állapotot sem változtat.
 */
@Controller("knowledge-base/model-flags")
export class ModelFlagController {
  constructor(private readonly flags: ModelFlagService) {}

  @Get("pending")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  pending(@Query() query: Record<string, unknown>) {
    return this.flags.pending(query);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  latest(@Query() query: Record<string, unknown>) {
    return this.flags.latest(query);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  write(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.flags.write(body, user);
  }
}
