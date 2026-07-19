import { Injectable } from "@nestjs/common";
import type { HealthResponse } from "@acropora/types";

@Injectable()
export class AppService {
  getWelcome() {
    return {
      name: "Acropora OS API",
      message: "A magyar nyelvű vállalatirányítási rendszer API-ja működik.",
    };
  }

  getHealth(): HealthResponse {
    return {
      service: "acropora-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
