import { Injectable, NotFoundException } from "@nestjs/common";

import type { UpsertProductShippingProfileDto } from "./dto/upsert-product-shipping-profile.dto.js";
import { ProductShippingProfileRepository } from "./product-shipping-profile.repository.js";

@Injectable()
export class ProductShippingProfileService {
  constructor(private readonly profiles: ProductShippingProfileRepository) {}

  /**
   * A HIANYZO PROFIL `null`, ES EZ NEM UGYANAZ, MINT A NEGY HAMIS.
   *
   * A hivo azt olvassa ki belole, hogy a termeket MEG SENKI NEM NEZTE MEG. Ha
   * itt egy "minden hamis" alapertelmezest adnank vissza, a felulet egy meg nem
   * vizsgalt termeket ugyanugy rajzolna ki, mint egy megvizsgaltat, amelyikre
   * semmi nem all -- es epp ezt a kulonbseget orzi a tabla alakja.
   */
  async getByProductId(productId: string) {
    await this.requireProduct(productId);
    return this.profiles.findByProductId(productId);
  }

  async upsert(
    productId: string,
    input: UpsertProductShippingProfileDto,
    actorUserId: string,
  ) {
    await this.requireProduct(productId);
    return this.profiles.upsert(productId, input, actorUserId);
  }

  private async requireProduct(productId: string) {
    if (!(await this.profiles.productExists(productId))) {
      throw new NotFoundException("A termék nem található.");
    }
  }
}
