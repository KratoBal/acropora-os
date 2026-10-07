import { Controller, Get } from "@nestjs/common";
import { prisma } from "@acropora/database";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { orokoltAttributumok } from "./attribute-sets.policy.js";

/**
 * AZ ATTRIBUTUM-MODELL OLVASO API-JA (SEO P0 PR 2). Csak olvas; az admin-
 * felulet (iras) kesobb jon. Kulon ut (`attributes`), mert a `products/:id`
 * minden mas `products/...` alutat elnyelne.
 */
@Controller("attributes")
export class AttributeController {
  @Get("definitions")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  definitions() {
    return prisma.attributeDefinition.findMany({
      orderBy: { key: "asc" },
      include: { enumValues: { orderBy: { sortOrder: "asc" } } },
    });
  }

  /** A keszletek, mindegyik a sajat ES az orokolt attributumaival. */
  @Get("sets")
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  async sets() {
    const [sets, links] = await Promise.all([
      prisma.attributeSet.findMany({ orderBy: { key: "asc" } }),
      prisma.attributeSetAttribute.findMany(),
    ]);
    return sets.map((set) => ({
      ...set,
      attributes: orokoltAttributumok(set.id, sets, links),
    }));
  }
}
