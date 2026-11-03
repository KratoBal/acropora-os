import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { prisma } from "@acropora/database";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { AttributeSetAdminService } from "./attribute-set-admin.service.js";
import { orokoltAttributumok } from "./attribute-sets.policy.js";
import { CreateAttributeSetDto } from "./dto/attribute-set.dto.js";

/**
 * AZ ATTRIBUTUM-MODELL API-JA (SEO P0 PR 2). Olvas, es (S1) egy szuk iro muvelete van, kulon
 * jogosultsaggal (`attribute-set-admin.service.ts`): uj keszlet. A termek keszlethez kotese a
 * `ProductAttributeSetController`-e (`PUT /products/:id/attribute-set`).
 * Kulon ut (`attributes`), mert a `products/:id` minden mas `products/...` alutat elnyelne.
 */
@Controller("attributes")
export class AttributeController {
  constructor(private readonly admin: AttributeSetAdminService) {}

  /** UJ keszlet a hozza tartozo attributumokkal; meglevot nem modosit (additiv), letezo kulcs 409. */
  @Post("sets")
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.PRODUCTS_ATTRIBUTE_SET_MANAGE)
  createSet(@Body() input: CreateAttributeSetDto) {
    return this.admin.createSet(input);
  }

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
