import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  Param,
  Query,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ClaimStoreInputError, parseLayer } from "./claim-store.js";
import {
  ClaimStoreNotFound,
  ClaimStoreRepository,
  type ClaimStoreDetail,
  type ClaimStoreList,
} from "./claim-store.repository.js";

/** The repository, injectable for the tests. */
export const CLAIM_STORE_REPOSITORY = Symbol("CLAIM_STORE_REPOSITORY");

export type ClaimStoreStore = Pick<ClaimStoreRepository, "list" | "detail">;

@Injectable()
export class ClaimStoreService {
  private readonly repository: ClaimStoreStore;

  constructor(
    @Optional()
    @Inject(CLAIM_STORE_REPOSITORY)
    repository: ClaimStoreStore | null = null,
  ) {
    this.repository = repository ?? new ClaimStoreRepository();
  }

  async list(layer: unknown): Promise<ClaimStoreList> {
    try {
      return await this.repository.list(parseLayer(layer));
    } catch (error) {
      if (error instanceof ClaimStoreInputError)
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      throw error;
    }
  }

  async detail(claimId: string): Promise<ClaimStoreDetail> {
    try {
      return await this.repository.detail(claimId);
    } catch (error) {
      if (error instanceof ClaimStoreNotFound)
        throw new NotFoundException("Nincs ilyen állítás.");
      throw error;
    }
  }
}

/**
 * ÁLLÍTÁS-TÁR (S5, Figma 3:229): the verified claims by layer, and one
 * claim's evidence, anchors and relations. Read only, `knowledge.view`.
 */
@Controller("knowledge-base/claims")
export class ClaimStoreController {
  constructor(private readonly store: ClaimStoreService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  list(@Query("layer") layer: unknown) {
    return this.store.list(layer);
  }

  @Get(":id/detail")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  detail(@Param("id") id: string) {
    return this.store.detail(id);
  }
}
