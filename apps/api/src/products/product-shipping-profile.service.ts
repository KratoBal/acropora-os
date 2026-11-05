import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

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

  /**
   * TÖMEGES SZERKESZTÉS (a82ed229, 2c): sok terméken ugyanazok a jelzők. Termékenként a mai jelzőkből indul, az
   * írás tranzakciójában olvasva (`patch`), csak a megadottakat írja át, és ugyanazon az úton ír, mint a kártya: termékenként napló,
   * csak a megváltozott jelző lesz kézi, és sor nélküli terméknél a UNAS-szal egyező jelző UNAS marad. Egy nem
   * létező termék nem állítja meg a többit: a válasz megnevezi.
   */
  async bulk(
    productIds: readonly string[],
    changes: Partial<UpsertProductShippingProfileDto>,
    actorUserId: string,
  ): Promise<{ updated: number; notFound: string[] }> {
    const flags = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => typeof value === "boolean"),
    ) as Partial<UpsertProductShippingProfileDto>;
    if (Object.keys(flags).length === 0)
      throw new BadRequestException("Legalább egy jelzőt meg kell adni.");
    const notFound: string[] = [];
    let updated = 0;
    for (const productId of new Set(productIds)) {
      if (!(await this.profiles.productExists(productId))) {
        notFound.push(productId);
        continue;
      }
      await this.profiles.patch(productId, flags, actorUserId);
      updated += 1;
    }
    return { updated, notFound };
  }

  private async requireProduct(productId: string) {
    if (!(await this.profiles.productExists(productId))) {
      throw new NotFoundException("A termék nem található.");
    }
  }
}
