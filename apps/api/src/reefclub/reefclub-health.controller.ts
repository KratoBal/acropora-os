import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";

import { ReefClubDatabase } from "./reefclub-database.js";
import { ReefClubPublic } from "./reefclub.guard.js";

/**
 * GET /rc/v1/health: the process is up and its own database connection works.
 * The answer names no table and no version, because it is public.
 */
@Controller("rc/v1/health")
export class ReefClubHealthController {
  constructor(
    @Inject(ReefClubDatabase) private readonly database: ReefClubDatabase,
  ) {}

  @ReefClubPublic()
  @Get()
  async health(): Promise<{ status: "ok" }> {
    try {
      await this.database.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: "ok" };
  }
}
