import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
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
  async getHealth(): Promise<HealthResponse> {
    const health = await this.appService.getHealth();

    if (health.database.status !== "ok" || health.redis.status !== "ok") {
      throw new ServiceUnavailableException(health);
    }

    return health;
  }
}
