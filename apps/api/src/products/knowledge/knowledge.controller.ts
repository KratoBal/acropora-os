import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ProductKnowledgeService } from "./knowledge.service.js";

/**
 * PRODUCT KNOWLEDGE (KZ Amino slice, #1431).
 *
 * Reading follows `products.view`, like the JEV review it sits on. Every
 * write follows `products.knowledge.approve` (OWNER and ADMIN only): what is
 * accepted and approved here is projected onto the shop's product page.
 * The bodies are checked in the service's policy, in words.
 */
@Controller("products/:id/knowledge")
export class ProductKnowledgeController {
  constructor(private readonly knowledge: ProductKnowledgeService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  read(@Param("id") id: string) {
    return this.knowledge.knowledge(id);
  }

  @Post("evidence")
  @RequirePermissions(PERMISSIONS.PRODUCTS_KNOWLEDGE_APPROVE)
  addEvidence(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.knowledge.addEvidence(id, body, user);
  }

  @Post("accept")
  @RequirePermissions(PERMISSIONS.PRODUCTS_KNOWLEDGE_APPROVE)
  accept(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.knowledge.accept(id, body?.fieldResultId, user);
  }

  @Post("resolve")
  @RequirePermissions(PERMISSIONS.PRODUCTS_KNOWLEDGE_APPROVE)
  resolve(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.knowledge.resolve(id, body?.fieldResultId, body?.value, user);
  }

  @Put("copy/:block")
  @RequirePermissions(PERMISSIONS.PRODUCTS_KNOWLEDGE_APPROVE)
  saveCopy(
    @Param("id") id: string,
    @Param("block") block: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.knowledge.saveCopy(id, block, body?.body, user);
  }

  @Post("copy/:block/approve")
  @RequirePermissions(PERMISSIONS.PRODUCTS_KNOWLEDGE_APPROVE)
  approveCopy(
    @Param("id") id: string,
    @Param("block") block: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.knowledge.approveCopy(id, block, user);
  }
}
