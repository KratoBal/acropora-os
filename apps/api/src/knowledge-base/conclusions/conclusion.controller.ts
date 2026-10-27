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
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { parseConclusionInput, parseReason } from "./conclusion.js";
import {
  ConclusionConflict,
  ConclusionNotFound,
  ConclusionRepository,
  type ConclusionView,
} from "./conclusion.repository.js";

/** The repository, injectable for the tests. */
export const CONCLUSION_REPOSITORY = Symbol("CONCLUSION_REPOSITORY");

export type ConclusionStore = Pick<
  ConclusionRepository,
  "list" | "detail" | "create" | "update" | "approve" | "withdraw"
>;

@Injectable()
export class ConclusionService {
  private readonly repository: ConclusionStore;

  constructor(
    @Optional()
    @Inject(CONCLUSION_REPOSITORY)
    repository: ConclusionStore | null = null,
  ) {
    this.repository = repository ?? new ConclusionRepository();
  }

  list(): Promise<ConclusionView[]> {
    return this.repository.list();
  }

  detail(id: string): Promise<ConclusionView> {
    return this.mapped(() => this.repository.detail(id));
  }

  async create(
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<ConclusionView> {
    const parsed = parseConclusionInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    return this.mapped(() => this.repository.create(parsed.value, user.id));
  }

  async update(
    id: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<ConclusionView> {
    const parsed = parseConclusionInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    return this.mapped(() => this.repository.update(id, parsed.value, user.id));
  }

  approve(id: string, user: AuthenticatedUser): Promise<ConclusionView> {
    return this.mapped(() => this.repository.approve(id, user.id));
  }

  async withdraw(
    id: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<ConclusionView> {
    const parsed = parseReason(body);
    if (!parsed.ok) throw new BadRequestException(parsed.problems);
    return this.mapped(() =>
      this.repository.withdraw(id, parsed.value, user.id),
    );
  }

  private async mapped<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ConclusionNotFound)
        throw new NotFoundException("Nincs ilyen következtetés.");
      if (error instanceof ConclusionConflict)
        throw new ConflictException(error.message);
      throw error;
    }
  }
}

/**
 * SAJÁT KÖVETKEZTETÉSEK (S5). Olvasás `knowledge.view`, tervezet írása
 * `knowledge.manage`, jóváhagyás és visszavonás `knowledge.approve` joggal
 * (a végleges jóváhagyás Balázsé, acrobot 35807); minden írás AuditLog-sort ír.
 */
@Controller("knowledge-base/conclusions")
export class ConclusionController {
  constructor(private readonly conclusions: ConclusionService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  list() {
    return this.conclusions.list();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  detail(@Param("id") id: string) {
    return this.conclusions.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  create(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conclusions.create(body, user);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  update(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conclusions.update(id, body, user);
  }

  @Post(":id/approve")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_APPROVE)
  approve(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.conclusions.approve(id, user);
  }

  @Post(":id/withdraw")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_APPROVE)
  withdraw(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conclusions.withdraw(id, body, user);
  }
}
