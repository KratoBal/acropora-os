import { Module } from "@nestjs/common";

import { TicketMailRepository } from "../../notifications/mail/ticket-mail.repository.js";
import { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { WebshopMailController } from "./webshop-mail.controller.js";
import { WebshopMailGuard } from "./webshop-mail.guard.js";

/**
 * Both repositories are stateless Prisma wrappers, provided here as
 * `AiProductSearchModule` does, so this module shares nothing with the
 * notifications module but the template table.
 */
@Module({
  controllers: [WebshopMailController],
  providers: [WebshopMailGuard, ServiceTokenRepository, TicketMailRepository],
})
export class WebshopMailModule {}
