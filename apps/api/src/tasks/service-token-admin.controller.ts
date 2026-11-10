import { Body, Controller, Get, Header, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CreateServiceTokenDto } from "./dto/service-token-admin.dto.js";
import { ServiceTokenAdminService } from "./service-token-admin.service.js";

/**
 * THE AGENTS' KEYS, MADE BY AN ADMIN (card c5a8e6d6; Balázs 2026-11-10 20:59 UTC). Behind `users.manage` on EACH route (the coverage spec reads the route's own decorators), the same
 * permission that makes accounts: whoever can make an account can make its key, and nobody else. API only, no screen.
 * The key leaves in the creation's answer once, and that answer is never cached.
 */
@Controller("service-tokens")
export class ServiceTokenAdminController {
  constructor(private readonly service: ServiceTokenAdminService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @Header("Cache-Control", "private, no-store")
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @Header("Cache-Control", "private, no-store")
  create(
    @Body() input: CreateServiceTokenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Post(":slug/revoke")
  @RequirePermissions(PERMISSIONS.USERS_MANAGE)
  @Header("Cache-Control", "private, no-store")
  revoke(@Param("slug") slug: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.revoke(slug, user.id);
  }
}
