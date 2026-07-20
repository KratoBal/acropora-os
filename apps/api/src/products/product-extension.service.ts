import { Injectable, NotFoundException } from "@nestjs/common";

import type { UpsertProductExtensionDto } from "./dto/upsert-product-extension.dto.js";
import { ProductExtensionRepository } from "./product-extension.repository.js";

@Injectable()
export class ProductExtensionService {
  constructor(private readonly extensions: ProductExtensionRepository) {}

  async getByVariantId(variantId: string) {
    await this.requireVariant(variantId);
    return this.extensions.findByVariantId(variantId);
  }

  async upsert(
    variantId: string,
    input: UpsertProductExtensionDto,
    actorUserId: string,
  ) {
    await this.requireVariant(variantId);
    return this.extensions.upsert(variantId, input, actorUserId);
  }

  private async requireVariant(variantId: string) {
    if (!(await this.extensions.variantExists(variantId))) {
      throw new NotFoundException("A termékváltozat nem található.");
    }
  }
}
