import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Sse,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  type MessageEvent,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { Observable, interval, map, merge } from "rxjs";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { DOCUMENT_UPLOAD_LIMITS } from "../documents/document-upload-limits.js";
import {
  AttachmentQueryDto,
  CreateConversationDto,
  EditMessageDto,
  ForwardMessageDto,
  NotificationSettingDto,
  ReactionDto,
  MarkReadDto,
  MessagePageQueryDto,
  MessagePeopleQueryDto,
  MessageSearchQueryDto,
  SendMessageDto,
  SharedAttachmentQueryDto,
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

  /** Keresés a megnyitott beszélgetésben (3. fázis). */
  @Get("conversations/:id/search")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  search(
    @Param("id") id: string,
    @Query() query: MessageSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.search(user, id, query.q);
  }

  /** A megosztott média vagy fájlok (3. fázis). */
  @Get("conversations/:id/attachments")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  shared(
    @Param("id") id: string,
    @Query() query: SharedAttachmentQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.sharedAttachments(user, id, query);
  }

  /** A kitűzött elemek (3. fázis). */
  @Get("conversations/:id/pins")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  pins(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messages.pins(user, id);
  }

  /** A saját értesítési beállítás ebben a beszélgetésben (3. fázis). */
  @Put("conversations/:id/notifications")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  notifications(
    @Param("id") id: string,
    @Body() body: NotificationSettingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.setNotification(user, id, body.mode);
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

  /**
   * CSATOLMÁNY FELTÖLTÉSE, üzenet nélkül; a küldés köti az üzenethez. Egy fájl
   * kérésenként, a közös 10 MB-os kerettel (`DOCUMENT_UPLOAD_LIMITS`).
   */
  @Post("conversations/:id/attachments")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_UPLOAD_LIMITS.fileSizeBytes },
    }),
  )
  upload(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("A feltöltendő fájl kötelező.");
    return this.messages.uploadAttachment(user, id, file);
  }

  /** A csatolmány bájtjai; a `no-store` ugyanaz a döntés, mint a szerviz-képeknél. */
  @Get("attachments/:id")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  @Header("Cache-Control", "private, no-store")
  async attachment(
    @Param("id") id: string,
    @Query() query: AttachmentQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const file = await this.messages.attachmentBytes(user, id, query.variant);
    return new StreamableFile(file.bytes, {
      type: file.contentType,
      length: file.bytes.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  /*
    AZ `:id` ÚTVONALAK A VÉGÉN ÁLLNAK: a Nest a deklarálás sorrendjében illeszt,
    és egy korábbi `:id` elnyelné a `people`, az `unread` és a `stream` kérést.
  */
  @Get(":id")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  message(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messages.message(user, id);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  edit(
    @Param("id") id: string,
    @Body() body: EditMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.edit(user, id, body.text);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  remove(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messages.remove(user, id);
  }

  @Post(":id/reactions")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  react(
    @Param("id") id: string,
    @Body() body: ReactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.react(user, id, body.reaction, true);
  }

  @Post(":id/pin")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  pin(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messages.pin(user, id, true);
  }

  @Delete(":id/pin")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  unpin(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.messages.pin(user, id, false);
  }

  @Post(":id/forward")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  forward(
    @Param("id") id: string,
    @Body() body: ForwardMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.forward(user, id, body);
  }

  @Delete(":id/reactions/:reaction")
  @RequirePermissions(PERMISSIONS.MESSAGES_USE)
  unreact(
    @Param("id") id: string,
    @Param("reaction") reaction: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.react(user, id, reaction, false);
  }
}
