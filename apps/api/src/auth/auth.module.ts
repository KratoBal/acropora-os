import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AuthUserResolver } from "./auth-user-resolver.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthUserResolver],
  exports: [AuthService],
})
export class AuthModule {}
