import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  UseGuards,
} from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import { AiUserContextGuard } from "./ai-user-context.guard.js";
import {
  AiUserContextService,
  type AiUserContext,
} from "./ai-user-context.service.js";

/**
 * The machine-facing context lookup for the Acropora AI agent.
 *
 * `@Public()` only tells the global `AuthGuard` to stand aside; the route is
 * not public. `AiUserContextGuard` guards it with a credential that no other
 * endpoint accepts, and that only one token record satisfies.
 *
 * The route sits under `integrations/` because that is where this API keeps
 * the surfaces that face another system. There is no `internal/` namespace to
 * join: none of the twenty-five controllers uses one.
 *
 * The subject is a `Customer`, never a `User`. `User` is internal staff -
 * OWNER, ADMIN, MANAGER, SALES, WAREHOUSE, SERVICE, VIEWER - and an AI
 * conversation is with a buyer. The header keeps the name the brief gave it,
 * `X-Acropora-User-Id`, but its value is a customer id, and the response says
 * so in `subjectType` rather than leaving the reader to infer it.
 */
@Controller("integrations/ai")
@Public()
@UseGuards(AiUserContextGuard)
export class AiUserContextController {
  constructor(private readonly service: AiUserContextService) {}

  @Get("user-context")
  userContext(
    @Headers("x-acropora-user-id") customerId?: string,
  ): Promise<AiUserContext> {
    /**
     * Validated by hand on purpose. The global `ValidationPipe` covers the
     * body, the query and route parameters - it does not see headers, so a
     * missing one would arrive here as `undefined` and fail later as a
     * database lookup for nothing.
     */
    const trimmed = customerId?.trim();
    if (!trimmed)
      throw new BadRequestException("Hiányzó X-Acropora-User-Id fejléc.");

    return this.service.forCustomer(trimmed);
  }
}
