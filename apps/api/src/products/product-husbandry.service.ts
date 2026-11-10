import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@acropora/database";
import type {
  ProductHusbandry,
  ProductHusbandryFacts,
  ProductHusbandryInput,
} from "@acropora/types";

import type { UpdateProductHusbandryDto } from "./dto/update-product-husbandry.dto.js";
import {
  husbandryVersionOf,
  husbandryWriteErrors,
  normalizedHusbandryTexts,
} from "./product-husbandry.js";
import {
  ProductHusbandryRepository,
  type HusbandryDecision,
} from "./product-husbandry.repository.js";

/** The list keys: `null` clears a list to empty (a list column has no null). */
const LIST_KEYS = ["aggression", "feedingType"] as const;

/**
 * THE DECISION OF A HUSBANDRY WRITE, pure (the repository runs it inside its transaction): from the stored facts, the input
 * and the actor, either the refusal's messages or the columns to write.
 *
 * VERIFICATION. `ellenorizve: true` stamps the actor and the server's clock (nobody sends a name or a time); `false`
 * withdraws it; a write that touches a fact and does not say `true` withdraws it too: the new content was verified by
 * nobody, and a "verified" mark that survives an edit would say more than was checked.
 */
export function husbandryDecision(
  current: ProductHusbandryFacts,
  input: UpdateProductHusbandryDto,
  actorUserId: string,
  now: Date,
): HusbandryDecision {
  const { ellenorizve, seenVersion, ...rest } = input;
  const patch = normalizedHusbandryTexts(rest as ProductHusbandryInput);
  const keys = Object.keys(patch).filter(
    (key) => (patch as Record<string, unknown>)[key] !== undefined,
  );
  if (keys.length === 0 && ellenorizve === undefined)
    return { refused: ["Legalább egy tartási adatot add meg."] };

  /*
    A VERIFICATION STATES THAT SOMEONE LOOKED AT THESE FACTS (barracuda on #2375): it must name the version it saw, and the
    stored row, read inside this serializable transaction, must still be that version. A plain save needs no version (it
    withdraws a verification, it never states one).
  */
  if (ellenorizve === true) {
    if (typeof seenVersion !== "string" || seenVersion === "")
      return {
        refused: [
          "Az ellenőrzéshez a látott állapot kell (seenVersion): töltsd újra a blokkot.",
        ],
      };
    if (seenVersion !== husbandryVersionOf(current))
      return {
        conflict:
          "Közben módosult a tartási blokk. Töltsd újra, nézd át, és utána ellenőrizd.",
      };
  }
  const errors = husbandryWriteErrors({ patch, current }, ellenorizve === true);
  if (errors.length > 0) return { refused: errors };

  const data: Record<string, unknown> = {};
  for (const key of keys) {
    const value = (patch as Record<string, unknown>)[key];
    data[key] =
      value === null && (LIST_KEYS as readonly string[]).includes(key)
        ? []
        : value;
  }
  const verifies = ellenorizve === true;
  data.ellenorizteUserId = verifies ? actorUserId : null;
  data.ellenorizveAt = verifies ? now : null;
  return {
    data: data as Prisma.ProductDatasheetUncheckedUpdateInput,
    changed: keys,
  };
}

@Injectable()
export class ProductHusbandryService {
  constructor(private readonly husbandry: ProductHusbandryRepository) {}

  async get(productId: string): Promise<ProductHusbandry> {
    const found = await this.husbandry.read(productId);
    if (!found) throw new NotFoundException("A termék nem található.");
    return found;
  }

  async update(
    productId: string,
    input: UpdateProductHusbandryDto,
    actorUserId: string,
    now: Date = new Date(),
  ): Promise<ProductHusbandry> {
    const result = await this.husbandry.write(
      productId,
      actorUserId,
      (current) => husbandryDecision(current, input, actorUserId, now),
    );
    if (result.kind === "not-found")
      throw new NotFoundException("A termék nem található.");
    if (result.kind === "conflict")
      throw new ConflictException({
        code: "HUSBANDRY_CHANGED",
        message: result.message,
      });
    if (result.kind === "refused")
      throw new BadRequestException({
        code: "HUSBANDRY_REFUSED",
        message: result.errors.join(" "),
        errors: result.errors,
      });
    return result.husbandry;
  }
}
