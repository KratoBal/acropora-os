import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { Observable, interval, map, merge } from "rxjs";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateConversationDto,
  MarkReadDto,
  MessagePageQueryDto,
  MessagePeopleQueryDto,
  SendMessageDto,
} from "./dto/messages.dto.js";
import { MessagesService } from "./messages.service.js";

/**
 * ÉLETJEL A FOLYAMON. A web a Next rewrite-proxyján át éri el az API-t, aminek
 * 50 másodperces időkorlátja van (`apps/web/src/lib/proxy-timeout.ts`): egy
 * csendes kapcsolatot az elvágna. 25 másodperc kényelmesen alatta marad.
 */
export const MESSAGE_STREAM_HEARTBEAT_MS = 25_000;

@Controller("messages")
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get("people")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  people(
    @Query() query: MessagePeopleQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.people(user, query.q ?? "");
  }

  @Get("unread")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.messages.unread(user);
  }

  /**
   * SZERVER -> KLIENS ÉRTESÍTÉS (SSE). Az esemény csak azonosítót visz; a
   * tartalmat a kliens a REST-útvonalakon olvassa, a tagság-ellenőrzés mögött.
   */
  @Sse("stream")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  stream(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    return merge(
      this.messages
        .stream(user)
        .pipe(
          map((event): MessageEvent => ({ type: event.type, data: event })),
        ),
      interval(MESSAGE_STREAM_HEARTBEAT_MS).pipe(
        map((): MessageEvent => ({ type: "ping", data: {} })),
      ),
    );
  }

  @Get("conversations")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.messages.list(user);
  }

  @Post("conversations")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  create(
    @Body() body: CreateConversationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.createConversation(user, body);
  }

  @Get("conversations/:id")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  detail(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messages.detail(user, id);
  }

  @Get("conversations/:id/messages")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  page(
    @Param("id") id: string,
    @Query() query: MessagePageQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.messages(user, id, query);
  }

  @Post("conversations/:id/messages")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  send(
    @Param("id") id: string,
    @Body() body: SendMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.send(user, id, body);
  }

  @Post("conversations/:id/read")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  read(
    @Param("id") id: string,
    @Body() body: MarkReadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.markRead(user, id, body.messageId);
  }
}
