import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module.js";

import {
  InMemoryMessageEventBus,
  MESSAGE_EVENT_BUS,
} from "./message-event-bus.js";
import { MessagesController } from "./messages.controller.js";
import { MessagesRepository } from "./messages.repository.js";
import { MessagesService } from "./messages.service.js";

/**
 * AZ ÜZENETEK MODUL (1. fázis, kártya 51d7aba0). A busz memóriabeli: ma egy
 * API-konténer fut. Több példánynál ugyanez a jelző kap Redis-megvalósítást.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MessagesController],
  providers: [
    MessagesRepository,
    MessagesService,
    { provide: MESSAGE_EVENT_BUS, useClass: InMemoryMessageEventBus },
  ],
})
export class MessagesModule {}
