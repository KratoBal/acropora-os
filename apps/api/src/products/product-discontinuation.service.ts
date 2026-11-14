import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ProductDiscontinuation } from "@acropora/types";

import { isPrismaErrorCode } from "../common/prisma-error.util.js";
import {
  MarkRefused,
  ProductDiscontinuationRepository,
  type MarkRefusal,
} from "./product-discontinuation.repository.js";

const MESSAGE: Record<MarkRefusal, string> = {
  PRODUCT_NOT_FOUND: "A termék nem található.",
  MARK_NOT_FOUND: "A termék nincs végleg megszűntnek jelölve.",
  REPLACEMENT_IS_SELF: "A termék nem lehet a saját helyettesítője.",
  REPLACEMENT_NOT_FOUND: "A helyettesítő termék nem található.",
  REPLACEMENT_NOT_SELLABLE:
    "A helyettesítő termék most nem értékesíthető a webshopban.",
  REPLACEMENT_ALSO_DISCONTINUED:
    "A helyettesítő termék maga is végleg megszűnt.",
  PRODUCT_IS_A_REPLACEMENT:
    "A termék egy másik végleg megszűnt termék jóváhagyott helyettesítője; előbb annál válassz mást.",
};

@Injectable()
export class ProductDiscontinuationService {
  constructor(private readonly marks: ProductDiscontinuationRepository) {}

  /** `null` is a product nobody marked; an unknown product is a 404. */
  async get(productId: string): Promise<ProductDiscontinuation | null> {
    if (!(await this.marks.productExists(productId)))
      throw new NotFoundException(MESSAGE.PRODUCT_NOT_FOUND);
    return this.marks.find(productId);
  }

  async set(
    productId: string,
    replacementProductId: string | null | undefined,
    actorUserId: string,
  ): Promise<ProductDiscontinuation> {
    return this.translate(() =>
      this.marks.set(productId, replacementProductId ?? null, actorUserId),
    );
  }

  async remove(productId: string, actorUserId: string): Promise<void> {
    await this.translate(() => this.marks.remove(productId, actorUserId));
  }

  private async translate<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // two people saving at once: the Serializable transaction lost, nothing was written, saving again works
      if (isPrismaErrorCode(error, "P2034"))
        throw new ConflictException(
          "Közben más is módosította a jelölést. Próbáld újra.",
        );
      if (!(error instanceof MarkRefused)) throw error;
      if (
        error.refusal === "PRODUCT_NOT_FOUND" ||
        error.refusal === "MARK_NOT_FOUND"
      )
        throw new NotFoundException(MESSAGE[error.refusal]);
      throw new BadRequestException(MESSAGE[error.refusal]);
    }
  }
}
