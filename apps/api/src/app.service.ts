import { checkDatabaseHealth } from "@acropora/database";
import { Injectable } from "@nestjs/common";
import type { HealthResponse } from "@acropora/types";

import { checkRedisHealth } from "./health/redis-health.js";

@Injectable()
export class AppService {
  getWelcome() {
    return {
      name: "Acropora OS API",
      message: "A magyar nyelvű vállalatirányítási rendszer API-ja működik.",
    };
  }

  async getHealth(): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
    ]);

    return {
      application: {
        status: "ok",
        version: "0.1.0",
      },
      database,
      redis,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
