import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import type { AuthenticatedUser, Session } from "@acropora/types";

import { AuthService } from "./auth.service.js";
import type {
  AuthenticatedRequest,
  DevelopmentLoginDto,
} from "./auth.types.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";
import { Public } from "./decorators/public.decorator.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get("me")
  getCurrentUser(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Public()
  @Post("login")
  login(@Body() body: DevelopmentLoginDto): Session {
    return this.authService.loginWithDevelopmentUser(body.email ?? "");
  }

  @Post("logout")
  logout(@Req() request: AuthenticatedRequest) {
    if (request.authToken) this.authService.logout(request.authToken);
    return { success: true };
  }
}
