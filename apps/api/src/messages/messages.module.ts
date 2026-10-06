import { Module } from "@nestjs/common";

import { AssistantModule } from "../assistant/assistant.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";
import { ServiceTokenRepository } from "../tasks/service-token.repository.js";
import { AssistantHandoffRepliesController } from "./handoff/assistant-handoff-replies.controller.js";
import { SutyerakHandoffController } from "./handoff/sutyerak-handoff.controller.js";
import { SutyerakHandoffGuard } from "./handoff/sutyerak-handoff.guard.js";
import { SutyerakInbox } from "./sutyerak-inbox.js";
import { AssistantThinkingState } from "./assistant-thinking.state.js";
import { MessageAttachmentCleanup } from "./message-attachment-cleanup.js";

import {
  InMemoryMessageEventBus,
  MESSAGE_EVENT_BUS,
} from "./message-event-bus.js";
import { MessagesAssistantService } from "./messages-assistant.service.js";
import { MessagesController } from "./messages.controller.js";
import { MessagesRepository } from "./messages.repository.js";
import { MessagesService } from "./messages.service.js";

/**
 * AZ ÜZENETEK MODUL (1. fázis, kártya 51d7aba0). A busz memóriabeli: ma egy
 * API-konténer fut. Több példánynál ugyanez a jelző kap Redis-megvalósítást.
 */
@Module({
  imports: [NotificationsModule, AssistantModule],
  controllers: [
    MessagesController,
    SutyerakHandoffController,
    AssistantHandoffRepliesController,
  ],
  providers: [
    MessagesRepository,
    MessagesService,
    { provide: MESSAGE_EVENT_BUS, useClass: InMemoryMessageEventBus },
    // a csatolmány a közös dokumentum-tárolóba megy (ugyanaz a jelző, mint a szerviznél)
    documentStoreProvider,
    MessageAttachmentCleanup,
    // 4. pont B: Sutyerák a beszélgetésekben
    AssistantThinkingState,
    MessagesAssistantService,
    // acrobot visszaírása, a saját szolgáltatás-tokenjével
    SutyerakHandoffGuard,
    SutyerakInbox,
    ServiceTokenRepository,
  ],
})
export class MessagesModule {}
