import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@acropora/types";

import { AppService } from "./app.service.js";
import { Public } from "./auth/decorators/public.decorator.js";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getWelcome() {
    return this.appService.getWelcome();
  }

  @Get("health")
  @Public()
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
