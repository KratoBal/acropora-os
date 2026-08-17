import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import { Public } from "../auth/decorators/public.decorator.js";
import { IngestTaskDto } from "./dto/task-ingest.dto.js";
import {
  ServiceTokenGuard,
  type ServiceTokenRequest,
} from "./service-token.guard.js";
import { TaskIngestService } from "./task-ingest.service.js";

/**
 * The entire machine-facing surface of the application: one controller, one
 * verb, one route.
 *
 * `@Public()` only tells the global `AuthGuard` to stand aside - the route
 * is not public, it is guarded by `ServiceTokenGuard` instead, which
 * accepts a credential that no other endpoint recognises. Keep it that way:
 * a second route here is a second thing every existing service token can
 * suddenly do.
 */
@Controller("tasks")
@Public()
@UseGuards(ServiceTokenGuard)
export class TaskIngestController {
  constructor(private readonly service: TaskIngestService) {}

  @Post("ingest")
  ingest(@Body() input: IngestTaskDto, @Req() request: ServiceTokenRequest) {
    const token = request.serviceToken;
    // Unreachable while the guard is in place; kept so that removing the
    // guard fails loudly instead of silently accepting anonymous writes.
    if (!token) throw new BadRequestException("Hiányzó szolgáltatás-token.");
    return this.service.ingest(input, token);
  }
}
