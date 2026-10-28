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
import {
  GoldSetInputError,
  parseCompleteness,
  parseFreezeInput,
  parseMissedClaim,
} from "./gold-set.js";
import {
  GoldSetConflict,
  GoldSetNotFound,
  GoldSetRepository,
  type GoldSetView,
} from "./gold-set.repository.js";

/** The repository, injectable for the tests. */
export const GOLD_SET_REPOSITORY = Symbol("GOLD_SET_REPOSITORY");

export type GoldSetStore = Pick<
  GoldSetRepository,
  "view" | "freeze" | "addMissed" | "removeMissed" | "setCompleteness"
>;

@Injectable()
export class GoldSetService {
  private readonly repository: GoldSetStore;

  constructor(
    @Optional()
    @Inject(GOLD_SET_REPOSITORY)
    repository: GoldSetStore | null = null,
  ) {
    this.repository = repository ?? new GoldSetRepository();
  }

  view(): Promise<GoldSetView> {
    return this.repository.view();
  }

  freeze(body: unknown, user: AuthenticatedUser): Promise<GoldSetView> {
    return this.write(async () => {
      await this.repository.freeze(parseFreezeInput(body), user.id);
    });
  }

  addMissed(
    sourceId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<GoldSetView> {
    return this.write(async () => {
      await this.repository.addMissed(
        sourceId,
        parseMissedClaim(body),
        user.id,
      );
    });
  }

  removeMissed(
    missedId: string,
    user: AuthenticatedUser,
  ): Promise<GoldSetView> {
    return this.write(() => this.repository.removeMissed(missedId, user.id));
  }

  setCompleteness(
    sourceId: string,
    body: unknown,
    user: AuthenticatedUser,
  ): Promise<GoldSetView> {
    return this.write(async () => {
      await this.repository.setCompleteness(
        sourceId,
        parseCompleteness(body),
        user.id,
      );
    });
  }

  /** A write, then the whole sheet again: the screen shows the new score. */
  private async write(run: () => Promise<void>): Promise<GoldSetView> {
    try {
      await run();
    } catch (error) {
      if (error instanceof GoldSetInputError)
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      if (error instanceof GoldSetConflict)
        throw new ConflictException({
          code: error.code,
          message: error.message,
        });
      if (error instanceof GoldSetNotFound)
        throw new NotFoundException(error.message);
      throw error;
    }
    return this.repository.view();
  }
}

/**
 * T3 ARANY-KÉSZLET (terv v4, 10. pont): a rögzített tíz forrás gépi
 * állításai soronként, a szerkesztő mezőnkénti döntéseiből számolt ítélettel,
 * a kimaradt állítások és a pontszám. Olvasás `knowledge.view`, minden írás
 * `knowledge.manage` és AuditLog-sor.
 */
@Controller("knowledge-base/gold-set")
export class GoldSetController {
  constructor(private readonly goldSet: GoldSetService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  view() {
    return this.goldSet.view();
  }

  @Post("freeze")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  freeze(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goldSet.freeze(body, user);
  }

  @Post("sources/:sourceId/missed")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  addMissed(
    @Param("sourceId") sourceId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goldSet.addMissed(sourceId, body, user);
  }

  @Delete("missed/:id")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  removeMissed(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goldSet.removeMissed(id, user);
  }

  @Post("sources/:sourceId/completeness")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  setCompleteness(
    @Param("sourceId") sourceId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goldSet.setCompleteness(sourceId, body, user);
  }
}
