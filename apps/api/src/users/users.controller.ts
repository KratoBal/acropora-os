import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { UsersService } from "./users.service.js";
import {
  CreateUserDto,
  SetUserPasswordDto,
  UpdateUserDto,
  UserListQueryDto,
} from "./dto/user.dto.js";

@Controller("users")
@RequirePermissions(PERMISSIONS.USERS_MANAGE)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  list(@Query() query: UserListQueryDto) {
    return this.service.list(query);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  create(
    @Body() input: CreateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() input: UpdateUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }

  @Post(":id/password")
  setPassword(
    @Param("id") id: string,
    @Body() input: SetUserPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setPassword(id, input, user.id);
  }

  @Post(":id/activate")
  activate(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.activate(id, user.id);
  }

  @Post(":id/deactivate")
  deactivate(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deactivate(id, user.id);
  }
}
