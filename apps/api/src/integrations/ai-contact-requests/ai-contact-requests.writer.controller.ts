import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";

import { Public } from "../../auth/decorators/public.decorator.js";
import { AiContactRequestsGuard } from "./ai-contact-requests.guard.js";
import { AiContactRequestsService } from "./ai-contact-requests.service.js";

/**
 * The AI service's side: it may WRITE a contact request, behind its own service-token record, and nothing else. The body is
 * checked by the shared rule in the service (one Hungarian sentence per refusal), not by a field-by-field DTO.
 */
@Controller("integrations/ai-chat/contact-requests")
@Public()
@UseGuards(AiContactRequestsGuard)
export class AiContactRequestsWriterController {
  constructor(private readonly service: AiContactRequestsService) {}

  @Post()
  @HttpCode(200)
  receive(@Body() body: unknown) {
    return this.service.receive(body);
  }
}
