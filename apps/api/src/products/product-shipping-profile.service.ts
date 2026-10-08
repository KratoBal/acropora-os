import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "@acropora/database";

import type { UpsertProductShippingProfileDto } from "./dto/upsert-product-shipping-profile.dto.js";
import type { BulkProductShippingProfileDto } from "./dto/bulk-product-shipping-profile.dto.js";
import { ProductShippingProfileRepository } from "./product-shipping-profile.repository.js";
import { runShippingBulk } from "./shipping-profile-bulk.js";
import { SHIPPING_FLAGS } from "./shipping-profile-sources.js";

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

  /**
   * A TÖMEGES SZERKESZTÉS (a82ed229). Legalább egy teendő kell, és egy jelző nem
   * lehet egyszerre beállítandó és visszaállítandó.
   */
  async bulk(input: BulkProductShippingProfileDto, actorUserId: string) {
    const set = Object.fromEntries(
      Object.entries(input.set ?? {}).filter(([, v]) => v !== undefined),
    ) as BulkProductShippingProfileDto["set"] & object;
    const resetToUnas = input.resetToUnas ?? [];
    if (Object.keys(set).length === 0 && resetToUnas.length === 0)
      throw new BadRequestException(
        "Adj meg legalább egy beállítandó vagy visszaállítandó jelzőt.",
      );
    const mindketto = SHIPPING_FLAGS.filter(
      (f) => f in set && resetToUnas.includes(f),
    );
    if (mindketto.length)
      throw new BadRequestException(
        `Egy jelző nem lehet egyszerre beállítva és visszaállítva: ${mindketto.join(", ")}`,
      );
    return runShippingBulk(
      prisma,
      input.productIds,
      { set, resetToUnas },
      actorUserId,
    );
  }

  private async requireProduct(productId: string) {
    if (!(await this.profiles.productExists(productId))) {
      throw new NotFoundException("A termék nem található.");
    }
  }
}
