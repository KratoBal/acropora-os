import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ProductBarcodeListResponse,
  ProductBarcodeSummary,
} from "@acropora/types";

import { parseBarcode } from "./barcode.util.js";
import { ProductBarcodeRepository } from "./product-barcode.repository.js";
import type { AddProductBarcodeDto } from "./dto/product-barcode.dto.js";

@Injectable()
export class ProductBarcodeService {
  constructor(private readonly repository: ProductBarcodeRepository) {}

  async list(variantId: string): Promise<ProductBarcodeListResponse> {
    await this.requireVariant(variantId);
    return { variantId, items: await this.repository.list(variantId) };
  }

  async add(
    variantId: string,
    input: AddProductBarcodeDto,
  ): Promise<ProductBarcodeSummary> {
    await this.requireVariant(variantId);

    const parsed = parseBarcode(input.code);
    if (!parsed.valid) throw new BadRequestException(parsed.reason);

    // Rejected only when the code *claims* to be an EAN/UPC and its own check
    // digit disagrees - i.e. `false`, never `null`. A code that is not
    // EAN-shaped at all (the shop's internal numbering) yields `null` and
    // passes, so this refuses fabrications without locking out the codes the
    // feature exists for. Seven such fabrications are known to be in the
    // catalogue already; this field is typed into by hand every day, so the
    // check belongs here as well as in the one-off import.
    if (parsed.eanCheckDigitValid === false)
      throw new BadRequestException(
        "Ez a vonalkód EAN/UPC alakú, de az ellenőrző számjegye hibás. Ellenőrizd a beolvasást, vagy használj belső (nem EAN) kódot.",
      );

    const owner = await this.repository.owner(parsed.code);
    if (owner) {
      // Naming the SKU is deliberate: this endpoint requires products.manage,
      // so the reader is staff, and "already in use" without saying where
      // turns a ten-second fix into a hunt.
      throw new ConflictException(
        owner.variantId === variantId
          ? "Ez a vonalkód már szerepel ennél a változatnál."
          : `Ez a vonalkód már a(z) ${owner.sku} cikkszámú változathoz tartozik.`,
      );
    }

    return this.repository.add(variantId, parsed.code, input.isPrimary);
  }

  async setPrimary(
    variantId: string,
    barcodeId: string,
  ): Promise<ProductBarcodeListResponse> {
    await this.requireBarcode(variantId, barcodeId);
    return {
      variantId,
      items: await this.repository.setPrimary(variantId, barcodeId),
    };
  }

  async remove(
    variantId: string,
    barcodeId: string,
  ): Promise<ProductBarcodeListResponse> {
    await this.requireBarcode(variantId, barcodeId);
    return {
      variantId,
      items: await this.repository.remove(variantId, barcodeId),
    };
  }

  private async requireVariant(variantId: string) {
    if (!(await this.repository.variantExists(variantId)))
      throw new NotFoundException("A termékváltozat nem található.");
  }

  /**
   * Looks the barcode up *within* the variant, so an id belonging to another
   * variant is reported as missing rather than acted upon.
   */
  private async requireBarcode(variantId: string, barcodeId: string) {
    await this.requireVariant(variantId);
    if (!(await this.repository.find(variantId, barcodeId)))
      throw new NotFoundException(
        "A vonalkód nem található ennél a változatnál.",
      );
  }
}
