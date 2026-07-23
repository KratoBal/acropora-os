import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { CustomersService } from "./customers.service.js";
import {
  CreateCustomerDto,
  CustomerListQueryDto,
  UpdateCustomerDto,
} from "./dto/customer.dto.js";

@Controller("customers")
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  list(@Query() query: CustomerListQueryDto) {
    return this.service.list(query);
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  detail(@Param("id") id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  create(
    @Body() input: CreateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user.id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: UpdateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user.id);
  }
}
