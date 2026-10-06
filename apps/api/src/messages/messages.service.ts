import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  CONVERSATION_MAX_MEMBERS,
  MESSAGE_ATTACHMENTS_MAX,
  MESSAGE_PAGE_DEFAULT,
  MESSAGE_REACTIONS,
  MESSAGE_PAGE_MAX,
  MESSAGE_SEARCH_COUNT_CAP,
  MESSAGE_SEARCH_LIMIT,
  MESSAGE_SEARCH_MIN_LENGTH,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SUTYERAK_USER_ID,
  USER_ROLES,
  personDisplayName,
  type AssistantHandoffReply,
  type AuthenticatedUser,
  worksheetDisplayStatus,
  type ConversationContextCard,
  type ConversationContextType,
  type ConversationDetail,
  type ConversationListItem,
  type ConversationNotificationState,
  type ConversationNotifyMode,
  type ConversationPerson,
  type MessageAttachmentItem,
  type MessageItem,
  type MessagePage,
  type MessageSearchResponse,
  type PinnedItemsResponse,
  type SharedAttachmentPage,
  type MessagesUnreadResponse,
} from "@acropora/types";

import {
  DocumentOverQuota,
  DocumentRejected,
  discardStoredDocument,
  prepareDocument,
} from "../documents/document-intake.js";
import { AssistantService } from "../assistant/assistant.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { AssistantThinkingState } from "./assistant-thinking.state.js";
import { SutyerakInbox } from "./sutyerak-inbox.js";
import { storageKeyFor } from "../service-assets/document-store/document-storage-key.js";
import type { DocumentStore } from "../service-assets/document-store/document-store.js";
import {
  DOCUMENT_STORE,
  documentStoreEnabled,
} from "../service-assets/document-store/document-store.provider.js";
import {
  MESSAGE_EVENT_BUS,
  type MessageEventBus,
} from "./message-event-bus.js";
import {
  AttachmentBindingError,
  MessagesRepository,
  type ConversationRow,
  type MessageRow,
  type MessagingUserRow,
} from "./messages.repository.js";
import {
  attachmentPreview,
  cleanMessageText,
  decodeCursor,
  directKeyOf,
  encodeCursor,
  mayJoinInternal,
  contextRef,
  messagePushText,
  messageSearchPattern,
  systemText,
  messageTypeFor,
  notificationUpdate,
  pushRecipients,
  searchSnippet,
  thumbnailDocumentId,
} from "./messages.rules.js";

/**
 * AZ ÜZENETEK MODUL, 1. FÁZIS (kártya 51d7aba0; terv:
 * agents/nautilus/megosztas/uzenetek-modul-felmeres.md; acrobot 26174).
 *
 * A JOG KÉT RÉTEG: a `messages.use` engedi a modult, a beszélgetésen belül pedig
 * KIZÁRÓLAG a tagság számít. Nem tagnak minden beszélgetés-útvonal 404-et ad,
 * nem 403-at: a válasz azt sem árulja el, hogy a beszélgetés létezik.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly repository: MessagesRepository,
    @Inject(MESSAGE_EVENT_BUS) private readonly bus: MessageEventBus,
    private readonly notifications: NotificationsService,
    @Optional()
    @Inject(DOCUMENT_STORE)
    private readonly store?: DocumentStore,
    /** Sutyerák (4. pont B): ki látja és ki indíthat vele beszélgetést. */
    @Optional() private readonly assistant?: AssistantService,
    @Optional() private readonly thinking?: AssistantThinkingState,
    /** A senki által nem olvasott postafiók-fiókok (4. pont B, 6. tétel). */
    @Optional() private readonly inbox?: SutyerakInbox,
  ) {}

  /** Sutyerák elérhető-e ennek a dolgozónak (ugyanaz a szabály, mint a widgeté). */
  private assistantFor(user: AuthenticatedUser): boolean {
    return this.assistant?.availableTo(user) ?? false;
  }

  /** Sutyerák nem választható, akinek nem elérhető (ugyanaz, mint a listán). */
  private refuseUnavailableAssistant(
    user: AuthenticatedUser,
    memberIds: readonly string[],
  ): void {
    if (memberIds.includes(SUTYERAK_USER_ID) && !this.assistantFor(user))
      throw new BadRequestException("Sutyerák számodra jelenleg nem elérhető.");
    // a postafiók-fiók senkit nem olvas: új beszélgetésbe nem vehető fel
    if (memberIds.some((id) => this.inbox?.has(id)))
      throw new BadRequestException(
        "Ez a fiók nem olvassa az üzeneteket. Kérdezd Sutyerákot.",
      );
  }

  private readonly logger = new Logger(MessagesService.name);

  /** A szerepkörök, amelyek a `messages.use` jogot megkapják. */
  private static readonly MESSAGING_ROLES = USER_ROLES.filter((role) =>
    ROLE_PERMISSIONS[role].includes(PERMISSIONS.MESSAGES_USE),
  );

  async people(user: AuthenticatedUser, query: string) {
    this.assertInternal(user);
    const rows = await this.repository.people({
      roles: MessagesService.MESSAGING_ROLES,
      query,
      excludeUserId: user.id,
      limit: 50,
    });
    // Sutyerák csak annak látszik, akinek elérhető, és a lista elején áll
    const assistant = this.assistantFor(user);
    const items = rows
      .filter(mayJoinInternal)
      .filter((row) => row.role !== "ASSISTANT" || assistant)
      // a postafiók-fiók nem választható (senki nem olvassa)
      .filter((row) => !this.inbox?.has(row.id))
      .map(toPerson);
    return {
      items: [
        ...items.filter((p) => p.kind === "assistant"),
        ...items.filter((p) => p.kind !== "assistant"),
      ],
    };
  }

  async createConversation(
    user: AuthenticatedUser,
    input: { memberIds: string[]; title?: string; description?: string },
  ): Promise<ConversationDetail> {
    this.assertInternal(user);
    const others = [...new Set(input.memberIds)].filter((id) => id !== user.id);
    if (others.length === 0)
      throw new BadRequestException("Legalább egy másik kollégát válassz ki.");
    this.refuseUnavailableAssistant(user, others);
    if (others.length + 1 > CONVERSATION_MAX_MEMBERS)
      throw new BadRequestException(
        `Egy beszélgetésnek legfeljebb ${CONVERSATION_MAX_MEMBERS} tagja lehet.`,
      );

    const found = await this.repository.users(others);
    const byId = new Map(found.map((row) => [row.id, row]));
    const refused = others.filter((id) => {
      const row = byId.get(id);
      return !row || !mayJoinInternal(row);
    });
    if (refused.length > 0)
      throw new BadRequestException(
        "A kiválasztottak között van, akivel nem indítható beszélgetés (inaktív, partnerfiók vagy nem létező felhasználó).",
      );

    const direct = others.length === 1;
    const { id, created } = await this.repository.createConversation({
      type: direct ? "DIRECT" : "GROUP",
      title: direct ? null : input.title?.trim() || null,
      description: direct ? null : input.description?.trim() || null,
      createdByUserId: user.id,
      directKey: direct ? directKeyOf(user.id, others[0]!) : null,
      memberIds: [user.id, ...others],
    });
    if (created) {
      // a tagság-változás auditálható (prompt 26. pont), a szöveg nélkül
      await this.repository.audit({
        userId: user.id,
        action: "conversation.created",
        conversationId: id,
        metadata: {
          type: direct ? "DIRECT" : "GROUP",
          memberIds: [user.id, ...others],
        },
      });
      this.bus.publish([user.id, ...others], {
        type: "conversation.created",
        conversationId: id,
      });
    }
    return this.detail(user, id);
  }

  async list(
    user: AuthenticatedUser,
  ): Promise<{ items: ConversationListItem[] }> {
    const [rows, unread] = await Promise.all([
      this.repository.conversationsOf(user.id),
      this.repository.unreadCounts(user.id),
    ]);
    const last = new Map(
      (
        await this.repository.messagesByIds(
          rows.flatMap((row) => (row.lastMessageId ? [row.lastMessageId] : [])),
        )
      ).map((row) => [row.id, row]),
    );
    return {
      items: rows.map((row) =>
        toListItem(row, user.id, unread.get(row.id) ?? 0, last),
      ),
    };
  }

  async detail(
    user: AuthenticatedUser,
    id: string,
  ): Promise<ConversationDetail> {
    const membership = await this.membershipOr404(id, user.id);
    const [row, unread] = await Promise.all([
      this.repository.conversation(id),
      this.repository.unreadCounts(user.id),
    ]);
    if (!row) throw notFound();
    const last = new Map(
      (
        await this.repository.messagesByIds(
          row.lastMessageId ? [row.lastMessageId] : [],
        )
      ).map((m) => [m.id, m]),
    );
    return {
      ...toListItem(row, user.id, unread.get(row.id) ?? 0, last),
      description: row.description,
      createdByUserId: row.createdByUserId,
      lastReadMessageId: membership.lastReadMessageId,
      notification: notificationState(membership),
      context: await this.contextCard(user, row),
      assistantThinking: this.thinking?.has(id) ?? false,
    };
  }

  /**
   * ACROBOT VISSZAÍRT VÁLASZA (4. pont B, 5. tétel). Beszélgetésből jött
   * kérdésnél oda, ahol Sutyerák tag (különben 403: más beszélgetésbe a token
   * sem írhat); a widgetből jöttnél a dolgozó és Sutyerák kettes
   * beszélgetésébe, ami ha nincs, most jön létre, hogy push és jelvény is
   * menjen. Csak belső, aktív dolgozónak.
   */
  async handoffReply(input: {
    conversationId?: string;
    userId?: string;
    /** A widget beszélgetése (5830ee10): a widget ezzel kéri le a választ. */
    threadId?: string;
    text: string;
  }): Promise<{ conversationId: string; messageId: string }> {
    if (!input.conversationId === !input.userId)
      throw new BadRequestException(
        "Pontosan az egyik kell: a beszélgetés (conversationId) vagy a dolgozó (userId).",
      );
    let conversationId: string;
    if (input.conversationId) {
      const row = await this.repository.conversation(input.conversationId);
      if (!row) throw notFound();
      if (!row.members.some((m) => m.userId === SUTYERAK_USER_ID))
        throw new ForbiddenException(
          "Ebben a beszélgetésben Sutyerák nem tag, ide nem írhat.",
        );
      conversationId = row.id;
    } else {
      const [person] = await this.repository.users([input.userId!]);
      if (!person) throw notFound();
      if (!mayJoinInternal(person))
        throw new ForbiddenException(
          "Sutyerák csak belső, aktív dolgozónak írhat.",
        );
      const { id, created } = await this.repository.createConversation({
        type: "DIRECT",
        title: null,
        description: null,
        createdByUserId: person.id,
        directKey: directKeyOf(person.id, SUTYERAK_USER_ID),
        memberIds: [person.id, SUTYERAK_USER_ID],
      });
      if (created) {
        await this.repository.audit({
          userId: person.id,
          action: "conversation.created",
          conversationId: id,
          metadata: {
            type: "DIRECT",
            memberIds: [person.id, SUTYERAK_USER_ID],
            by: "sutyerak-handoff",
          },
        });
        this.bus.publish([person.id, SUTYERAK_USER_ID], {
          type: "conversation.created",
          conversationId: id,
        });
      }
      conversationId = id;
    }
    const message = await this.postAsAssistant(
      conversationId,
      input.text,
      "ACROBOT",
      input.threadId ?? null,
    );
    return { conversationId, messageId: message.id };
  }

  /**
   * ACROBOT VÁLASZAI A WIDGETBEN (5830ee10, Balázs 2026-10-06 12:14 UTC: „a
   * válasz az üzenetben jött, nem Sutyerákhoz a chat ablakba”). A widget a
   * saját beszélgetésének azonosítójával kéri, és CSAK a saját kettes
   * beszélgetéséből kap: egy másik dolgozó azonosítójával sem lát mást.
   */
  async widgetReplies(
    user: AuthenticatedUser,
    threadId: string,
  ): Promise<{ items: AssistantHandoffReply[] }> {
    const rows = await this.repository.acrobotReplies(
      directKeyOf(user.id, SUTYERAK_USER_ID),
      threadId,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        text: row.text ?? "",
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * SUTYERÁK ÜZENETE (4. pont B): a válasz, a hiba-mondat vagy acrobot
   * visszaírt válasza, Sutyerák nevében. Ugyanaz a közzététel, mint egy
   * dolgozó üzeneténél (folyam, push, jelvény).
   */
  async postAsAssistant(
    conversationId: string,
    text: string,
    source: "GATEWAY" | "ACROBOT",
    threadId: string | null = null,
  ): Promise<MessageItem> {
    return this.postAs(
      SUTYERAK_USER_ID,
      conversationId,
      text,
      source,
      threadId,
    );
  }

  /**
   * EGY RENDSZER-ÜZENET EGY TAG NEVÉBEN (Sutyerák válasza, vagy egy postafiók-
   * fiók átirányító mondata), ugyanazzal a közzététellel, mint egy dolgozóé.
   */
  async postAs(
    senderUserId: string,
    conversationId: string,
    text: string,
    assistantSource: "GATEWAY" | "ACROBOT" | null = null,
    assistantThreadId: string | null = null,
  ): Promise<MessageItem> {
    const [sender] = await this.repository.users([senderUserId]);
    if (!sender) throw new Error(`A küldő (${senderUserId}) nem létezik`);
    const row = await this.repository.createMessage({
      conversationId,
      senderUserId,
      text: text.trim(),
      clientMessageId: randomUUID(),
      assistantSource,
      assistantThreadId,
    });
    await this.announce(row, {
      id: sender.id,
      email: "",
      displayName: sender.displayName,
      nickname: sender.nickname ?? null,
      role: sender.role,
      avatarUrl: sender.avatarUrl,
      customerId: sender.customerId,
      supplierId: sender.supplierId,
    });
    return toMessage(row, senderUserId);
  }

  async messages(
    user: AuthenticatedUser,
    id: string,
    query: { before?: string; after?: string; around?: string; limit?: number },
  ): Promise<MessagePage> {
    await this.membershipOr404(id, user.id);
    if ([query.before, query.after, query.around].filter(Boolean).length > 1)
      throw new BadRequestException(
        "Egyszerre csak egy lapozási irány adható meg.",
      );
    if (query.around)
      return this.pageAround(user, id, query.around, query.limit);
    if (query.after) return this.pageAfter(user, id, query.after, query.limit);
    const before = query.before ? decodeCursor(query.before) : null;
    if (query.before && !before)
      throw new BadRequestException("Érvénytelen lapozási kurzor.");
    const limit = Math.min(
      query.limit ?? MESSAGE_PAGE_DEFAULT,
      MESSAGE_PAGE_MAX,
    );
    const { rows, hasOlder } = await this.repository.messagesPage({
      conversationId: id,
      before,
      limit,
    });
    const oldest = rows.at(-1);
    return {
      items: rows.reverse().map((row) => toMessage(row, user.id)),
      olderCursor: hasOlder && oldest ? encodeCursor(oldest) : null,
    };
  }

  /**
   * KÜLDÉS. A `clientMessageId` miatt egy újraküldés (hálózati hiba, újra
   * gomb) a MÁR MEGLÉVŐ üzenetet adja vissza, nem hoz létre másodikat. A
   * kliens csak a szerver válasza után jelöli elküldöttnek (prompt 22. pont).
   *
   * A 2. FÁZIS ÓTA: csatolmánnyal szöveg nélkül is mehet (prompt 7. pont), és
   * válaszolhat egy ugyanebben a beszélgetésben álló üzenetre.
   */
  async send(
    user: AuthenticatedUser,
    id: string,
    input: {
      text?: string;
      clientMessageId: string;
      attachmentIds?: string[];
      replyToMessageId?: string;
    },
  ): Promise<MessageItem> {
    return this.deliver(user, id, input, null);
  }

  /**
   * A KÜLDÉS MAGJA, a sima küldésé és a továbbításé is: ugyanaz a tagság-,
   * csatolmány- és újraküldés-szabály, a továbbítás csak az eredetet teszi hozzá.
   */
  private async deliver(
    user: AuthenticatedUser,
    id: string,
    input: {
      text?: string;
      clientMessageId: string;
      attachmentIds?: string[];
      replyToMessageId?: string;
    },
    forwardedFrom: { messageId: string; userId: string } | null,
  ): Promise<MessageItem> {
    await this.membershipOr404(id, user.id);
    const text = cleanMessageText(input.text ?? "");
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    if (!text && attachmentIds.length === 0)
      throw new BadRequestException("Üres üzenet nem küldhető.");
    if (attachmentIds.length > MESSAGE_ATTACHMENTS_MAX)
      throw new BadRequestException(
        `Egy üzenettel legfeljebb ${MESSAGE_ATTACHMENTS_MAX} csatolmány mehet.`,
      );

    const existing = await this.repository.messageByClientId(
      user.id,
      input.clientMessageId,
    );
    if (existing) return this.sameConversationOr409(existing, id, user.id);

    if (
      input.replyToMessageId &&
      !(await this.repository.messageInConversation(id, input.replyToMessageId))
    )
      throw new BadRequestException(
        "Csak ugyanebben a beszélgetésben álló üzenetre lehet válaszolni.",
      );

    // A csatolmány a küldő SAJÁT, ide feltöltött, még el nem küldött fájlja.
    const attachments = attachmentIds.length
      ? await this.repository.attachmentsForSend(attachmentIds)
      : [];
    if (
      attachments.length !== attachmentIds.length ||
      attachments.some(
        (a) =>
          a.conversationId !== id ||
          a.uploadedByUserId !== user.id ||
          a.messageId !== null,
      )
    )
      throw new BadRequestException(
        "A csatolmány nem küldhető ezzel az üzenettel.",
      );

    let row: MessageRow;
    try {
      row = await this.repository.createMessage({
        conversationId: id,
        senderUserId: user.id,
        text,
        clientMessageId: input.clientMessageId,
        type: messageTypeFor(attachments.map((a) => a.kind)),
        replyToMessageId: input.replyToMessageId ?? null,
        attachmentIds,
        forwardedFrom,
      });
    } catch (error) {
      if (error instanceof AttachmentBindingError)
        throw new BadRequestException(
          "A csatolmány nem küldhető ezzel az üzenettel.",
        );
      // két egyszerre érkező újraküldés: a második az elsőt kapja vissza
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const raced = await this.repository.messageByClientId(
          user.id,
          input.clientMessageId,
        );
        if (raced) return this.sameConversationOr409(raced, id, user.id);
      }
      throw error;
    }

    await this.announce(row, user);
    return toMessage(row, user.id);
  }

  /**
   * CSATOLMÁNY FELTÖLTÉSE, üzenet nélkül (a terv 2.2 pontja). Fájlonként egy
   * kérés, hogy a kliens fájlonként mutathassa a haladást, és újrapróbálhassa.
   * A bájtok CSAK a tárolóba mehetnek: kikapcsolt vagy nem használható
   * tárolónál a feltöltés elutasítva, nem esik vissza az adatbázisba.
   */
  async uploadAttachment(
    user: AuthenticatedUser,
    conversationId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ): Promise<MessageAttachmentItem> {
    await this.membershipOr404(conversationId, user.id);
    const store = this.store;
    if (!store || !documentStoreEnabled())
      throw new ServiceUnavailableException(
        "A csatolmány most nem tölthető fel: a dokumentum-tároló nincs beállítva.",
      );
    const documentId = randomUUID();
    const owner = "message" as const;
    let prepared;
    try {
      prepared = await prepareDocument(
        { owner, ownerId: conversationId, documentId, file },
        {
          store,
          usedBytes: () => this.repository.documentBytesInUse(),
          logger: this.logger,
        },
      );
    } catch (error) {
      if (error instanceof DocumentRejected)
        throw new BadRequestException(error.message);
      if (error instanceof DocumentOverQuota)
        throw new ConflictException(error.message);
      throw error;
    }
    if (prepared.placement !== "store")
      throw new ServiceUnavailableException(
        "A csatolmány most nem tölthető fel: a dokumentum-tároló nem használható.",
      );

    const thumbnailKey = prepared.common.thumbnail
      ? {
          owner,
          ownerId: conversationId,
          documentId: thumbnailDocumentId(documentId),
        }
      : null;
    try {
      if (thumbnailKey)
        await store.put(thumbnailKey, prepared.common.thumbnail!);
      const row = await this.repository.createAttachment({
        id: documentId,
        conversationId,
        uploadedByUserId: user.id,
        kind: prepared.common.contentType.startsWith("image/")
          ? "IMAGE"
          : "FILE",
        fileName: prepared.common.fileName,
        contentType: prepared.common.contentType,
        sizeBytes: prepared.common.sizeBytes,
        sha256: prepared.common.sha256,
        storageKey: prepared.storageKey,
        thumbnailKey: thumbnailKey ? storageKeyFor(thumbnailKey) : null,
      });
      return toAttachment(row);
    } catch (error) {
      // A SOR NEM JÖTT LÉTRE, TEHÁT A FÁJL SEM MARADHAT.
      await discardStoredDocument(
        { owner, ownerId: conversationId, documentId },
        { store },
      );
      if (thumbnailKey) await discardStoredDocument(thumbnailKey, { store });
      throw error;
    }
  }

  /**
   * A CSATOLMÁNY BÁJTJAI. Tagság a csatolmány beszélgetésében; egy még el nem
   * küldött feltöltést csak a feltöltője láthat; egy törölt üzenet csatolmányát
   * senki. Minden más esetben 404, nem 403.
   */
  async attachmentBytes(
    user: AuthenticatedUser,
    attachmentId: string,
    variant?: string,
  ): Promise<{ bytes: Uint8Array; contentType: string; fileName: string }> {
    const row = await this.repository.attachment(attachmentId);
    if (!row) throw attachmentNotFound();
    if (!(await this.repository.activeMembership(row.conversationId, user.id)))
      throw attachmentNotFound();
    if (row.messageId === null && row.uploadedByUserId !== user.id)
      throw attachmentNotFound();
    if (row.message?.deletedAt) throw attachmentNotFound();
    if (!this.store) throw attachmentNotFound();
    const thumbnail = variant === "thumbnail" && row.thumbnailKey !== null;
    const bytes = await this.store.get({
      owner: "message",
      ownerId: row.conversationId,
      documentId: thumbnail ? thumbnailDocumentId(row.id) : row.id,
    });
    if (!bytes) throw attachmentNotFound();
    return {
      bytes,
      contentType: thumbnail ? "image/jpeg" : row.contentType,
      fileName: row.fileName,
    };
  }

  /** Egy üzenet a tagnak (a `message.updated` után ezt olvassa újra a kliens). */
  async message(
    user: AuthenticatedUser,
    messageId: string,
  ): Promise<MessageItem> {
    return toMessage(await this.messageOr404(messageId, user.id), user.id);
  }

  /** SZERKESZTÉS: csak a saját, nem törölt üzenet; admin sem (acrobot 26174). */
  async edit(
    user: AuthenticatedUser,
    messageId: string,
    rawText: string,
  ): Promise<MessageItem> {
    const row = await this.messageOr404(messageId, user.id);
    if (row.senderUserId !== user.id)
      throw new ForbiddenException("Csak a saját üzeneted szerkesztheted.");
    if (row.deletedAt)
      throw new ConflictException("A törölt üzenet nem szerkeszthető.");
    const text = cleanMessageText(rawText);
    if (!text && row.attachments.length === 0)
      throw new BadRequestException("Üres üzenet nem menthető.");
    await this.repository.editMessage(messageId, text ?? "");
    await this.updated(row);
    return toMessage((await this.repository.message(messageId))!, user.id);
  }

  /**
   * TÖRLÉS: csak a saját üzenet. SOFT DELETE: a szöveg és a csatolmány az
   * adatbázisban és a tárolóban marad, de senkinek nem megy ki; automatikus
   * végleges törlés nincs (acrobot 26174). A törlés auditálva, szöveg nélkül.
   */
  async remove(
    user: AuthenticatedUser,
    messageId: string,
  ): Promise<{ deleted: true }> {
    const row = await this.messageOr404(messageId, user.id);
    if (row.senderUserId !== user.id)
      throw new ForbiddenException("Csak a saját üzeneted törölheted.");
    if (!row.deletedAt) {
      await this.repository.deleteMessage(messageId, user.id);
      await this.repository.audit({
        userId: user.id,
        action: "message.deleted",
        conversationId: row.conversationId,
        metadata: { messageId },
      });
      await this.updated(row);
    }
    return { deleted: true };
  }

  async react(
    user: AuthenticatedUser,
    messageId: string,
    reaction: string,
    on: boolean,
  ): Promise<MessageItem> {
    if (!(MESSAGE_REACTIONS as readonly string[]).includes(reaction))
      throw new BadRequestException("Ez a reakció nem támogatott.");
    const row = await this.messageOr404(messageId, user.id);
    if (row.deletedAt)
      throw new ConflictException("Törölt üzenetre nem lehet reagálni.");
    if (on) await this.repository.addReaction(messageId, user.id, reaction);
    else await this.repository.removeReaction(messageId, user.id, reaction);
    await this.updated(row);
    return toMessage((await this.repository.message(messageId))!, user.id);
  }

  async markRead(
    user: AuthenticatedUser,
    id: string,
    messageId: string,
  ): Promise<{ moved: boolean }> {
    await this.membershipOr404(id, user.id);
    const message = await this.repository.messageInConversation(id, messageId);
    if (!message) throw notFound();
    const moved = await this.repository.markRead({
      conversationId: id,
      userId: user.id,
      message,
    });
    // a többi saját eszköz is frissítse a jelvényt
    if (moved)
      this.bus.publish([user.id], {
        type: "conversation.read",
        conversationId: id,
      });
    return { moved };
  }

  async unread(user: AuthenticatedUser): Promise<MessagesUnreadResponse> {
    const counts = [...(await this.repository.unreadCounts(user.id)).values()];
    return {
      total: counts.reduce((sum, n) => sum + n, 0),
      conversations: counts.filter((n) => n > 0).length,
    };
  }

  /** A folyam csak a kérdező saját eseményeit adja. */
  stream(user: AuthenticatedUser) {
    return this.bus.subscribe(user.id);
  }

  /**
   * AZ ÚJ ÜZENET A BESZÉLGETÉS MINDEN AKTÍV TAGJÁNAK a folyamon (a küldőnek is:
   * a többi eszköze is lássa), és PUSH a többieknek, akik nincsenek elnémítva
   * (acrobot 26174: a push már az 1. fázisban megy).
   */
  private async announce(row: MessageRow, sender: AuthenticatedUser) {
    const members = await this.repository.members(row.conversationId);
    this.bus.publish(
      members.filter((m) => m.leftAt === null).map((m) => m.userId),
      {
        type: "message.created",
        conversationId: row.conversationId,
        messageId: row.id,
      },
    );
    const userIds = pushRecipients({
      senderUserId: sender.id,
      now: new Date(),
      members,
    });
    const pushText =
      row.text ||
      (row.attachments[0] ? attachmentPreview(row.attachments[0].kind) : "");
    if (userIds.length === 0 || !pushText) return;
    const conversation = await this.repository.conversation(row.conversationId);
    const { title, body } = messagePushText({
      conversationTitle:
        conversation?.type === "GROUP"
          ? (conversation.title ?? "Csoport")
          : null,
      senderName: personDisplayName(sender),
      text: pushText,
    });
    // az app ikonjának száma címzettenként (iOS `badge`); ha nem jön, a push megy nélküle
    let badges: Record<string, number> | undefined;
    try {
      badges = await this.repository.unreadTotals(userIds);
    } catch {
      badges = undefined;
    }
    this.notifications.notifyNewMessage({
      messageId: row.id,
      conversationId: row.conversationId,
      userIds,
      title,
      body,
      ...(badges ? { badges } : {}),
    });
  }

  private sameConversationOr409(
    row: MessageRow,
    conversationId: string,
    viewerId: string,
  ): MessageItem {
    if (row.conversationId !== conversationId)
      throw new ConflictException(
        "Ez az ügyfél-azonosító már egy másik beszélgetés üzenetéé.",
      );
    return toMessage(row, viewerId);
  }

  /**
   * „UGRÁS” EGY RÉGEBBI ÜZENETHEZ (3. fázis, prompt 13. pont): az oldal a cél
   * körül nyílik, előtte és utána nagyjából fele-fele, és mindkét irányba
   * lapozható tovább. A cél ugyanebben a beszélgetésben álljon, különben 404.
   */
  private async pageAround(
    user: AuthenticatedUser,
    conversationId: string,
    messageId: string,
    requested?: number,
  ): Promise<MessagePage> {
    const target = await this.repository.messageInConversation(
      conversationId,
      messageId,
    );
    if (!target) throw new NotFoundException("Az üzenet nem található.");
    const limit = Math.min(requested ?? MESSAGE_PAGE_DEFAULT, MESSAGE_PAGE_MAX);
    const olderLimit = Math.max(0, Math.floor((limit - 1) / 2));
    const newerLimit = Math.max(0, limit - 1 - olderLimit);
    const [older, newer, [targetRow]] = await Promise.all([
      this.repository.messagesPage({
        conversationId,
        before: target,
        limit: Math.max(olderLimit, 1),
      }),
      this.repository.messagesAfter({
        conversationId,
        after: target,
        limit: Math.max(newerLimit, 1),
      }),
      this.repository.messagesByIds([target.id]),
    ]);
    const olderRows = older.rows.slice(0, olderLimit);
    const newerRows = newer.rows.slice(0, newerLimit);
    const oldest = olderRows.at(-1) ?? target;
    const newest = newerRows.at(-1) ?? target;
    return {
      items: [...olderRows.reverse(), targetRow!, ...newerRows].map((row) =>
        toMessage(row, user.id),
      ),
      olderCursor:
        older.rows.length > olderRows.length || older.hasOlder
          ? encodeCursor(oldest)
          : null,
      newerCursor:
        newer.rows.length > newerRows.length || newer.hasNewer
          ? encodeCursor(newest)
          : null,
    };
  }

  /** Az ugrás utáni ÚJABB oldal, időrendben. */
  private async pageAfter(
    user: AuthenticatedUser,
    conversationId: string,
    cursor: string,
    requested?: number,
  ): Promise<MessagePage> {
    const after = decodeCursor(cursor);
    if (!after) throw new BadRequestException("Érvénytelen lapozási kurzor.");
    const limit = Math.min(requested ?? MESSAGE_PAGE_DEFAULT, MESSAGE_PAGE_MAX);
    const { rows, hasNewer } = await this.repository.messagesAfter({
      conversationId,
      after,
      limit,
    });
    const newest = rows.at(-1);
    return {
      items: rows.map((row) => toMessage(row, user.id)),
      olderCursor: null,
      newerCursor: hasNewer && newest ? encodeCursor(newest) : null,
    };
  }

  /**
   * KERESÉS A MEGNYITOTT BESZÉLGETÉSBEN (3. fázis, prompt 13. pont; Balázs,
   * 2026-10-05: csak a megnyitottban). Ékezet- és kisbetű-független, törölt
   * üzenet nem jön, a legújabb találat elöl.
   */
  async search(
    user: AuthenticatedUser,
    conversationId: string,
    q: string,
  ): Promise<MessageSearchResponse> {
    await this.membershipOr404(conversationId, user.id);
    const query = q.trim();
    if ([...query].length < MESSAGE_SEARCH_MIN_LENGTH)
      throw new BadRequestException(
        `Legalább ${MESSAGE_SEARCH_MIN_LENGTH} karaktert írj a kereséshez.`,
      );
    const { ids, total } = await this.repository.searchMessages({
      conversationId,
      pattern: messageSearchPattern(query),
      limit: MESSAGE_SEARCH_LIMIT,
      cap: MESSAGE_SEARCH_COUNT_CAP,
    });
    const rows = new Map(
      (await this.repository.messagesByIds(ids)).map((row) => [row.id, row]),
    );
    return {
      total,
      totalCapped: total >= MESSAGE_SEARCH_COUNT_CAP,
      items: ids.flatMap((id) => {
        const row = rows.get(id);
        return row
          ? [
              {
                messageId: row.id,
                senderName: personDisplayName(row.sender),
                createdAt: row.createdAt.toISOString(),
                snippet: searchSnippet(row.text ?? "", query),
              },
            ]
          : [];
      }),
    };
  }

  /** A MEGOSZTOTT MÉDIA ÉS FÁJLOK (3. fázis, prompt 15. pont), a legújabb elöl. */
  async sharedAttachments(
    user: AuthenticatedUser,
    conversationId: string,
    query: { kind: "IMAGE" | "FILE"; before?: string; limit?: number },
  ): Promise<SharedAttachmentPage> {
    await this.membershipOr404(conversationId, user.id);
    const before = query.before ? decodeCursor(query.before) : null;
    if (query.before && !before)
      throw new BadRequestException("Érvénytelen lapozási kurzor.");
    const { rows, hasOlder } = await this.repository.sharedAttachments({
      conversationId,
      kind: query.kind,
      before,
      limit: Math.min(query.limit ?? MESSAGE_PAGE_DEFAULT, MESSAGE_PAGE_MAX),
    });
    const oldest = rows.at(-1);
    return {
      items: rows.map((row) => ({
        ...toAttachment(row),
        messageId: row.message!.id,
        senderName: personDisplayName(row.message!.sender),
        createdAt: row.message!.createdAt.toISOString(),
      })),
      olderCursor: hasOlder && oldest ? encodeCursor(oldest) : null,
    };
  }

  /**
   * AZ ÉRTESÍTÉSI BEÁLLÍTÁS (3. fázis, prompt 17. pont), a tagé, ebben a
   * beszélgetésben. A némítás vége a szerver órájából jön.
   */
  async setNotification(
    user: AuthenticatedUser,
    conversationId: string,
    mode: ConversationNotifyMode,
  ): Promise<ConversationNotificationState> {
    await this.membershipOr404(conversationId, user.id);
    const saved = await this.repository.setNotification(
      conversationId,
      user.id,
      notificationUpdate(mode, new Date()),
    );
    return notificationState(saved);
  }

  /**
   * KITŰZÉS ÉS LEVÉTEL (3. fázis, prompt 14. pont). Bármelyik tag kitűzhet és
   * levehet (Balázs, 2026-10-05), és mindkettő auditálva, szöveg nélkül. A
   * kétszeri kitűzés nem hiba, és nem naplóz kétszer.
   */
  async pin(
    user: AuthenticatedUser,
    messageId: string,
    on: boolean,
  ): Promise<MessageItem> {
    const row = await this.messageOr404(messageId, user.id);
    if (on && row.deletedAt)
      throw new BadRequestException("Törölt üzenet nem tűzhető ki.");
    const changed = on
      ? await this.repository.pin({
          conversationId: row.conversationId,
          messageId,
          userId: user.id,
        })
      : await this.repository.unpin(row.conversationId, messageId);
    if (changed) {
      await this.repository.audit({
        userId: user.id,
        action: on ? "message.pinned" : "message.unpinned",
        conversationId: row.conversationId,
        metadata: { messageId },
      });
      await this.updated(row);
    }
    return this.message(user, messageId);
  }

  /** A beszélgetés kitűzött elemei, a legutóbbi kitűzés elöl (Figma 454:596). */
  async pins(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<PinnedItemsResponse> {
    await this.membershipOr404(conversationId, user.id);
    const rows = await this.repository.pins(conversationId);
    return {
      items: rows.map((row) => ({
        messageId: row.message.id,
        title: pinnedTitle(
          row.message.text,
          row.message.attachments[0]?.fileName,
        ),
        senderName: personDisplayName(row.message.sender),
        messageCreatedAt: row.message.createdAt.toISOString(),
        pinnedByName: personDisplayName(row.pinnedBy),
        pinnedAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * TOVÁBBÍTÁS (3. fázis; prompt 9. pont; Balázs, 2026-10-05: az eredeti szerző
   * látszik). A továbbító tagja a forrás- és a célbeszélgetésnek is. Egy új
   * üzenet a célban, a továbbító nevében; a `clientMessageId` miatt egy
   * újraküldés nem duplikál.
   *
   * A CSATOLMÁNY BÁJTRA MÁSOLÓDIK, és ez mérés, nem kényelem: a tároló a fájlt a
   * beszélgetés és a csatolmány azonosítójából címzi (`storageKeyFor`), és a
   * tároló-egyeztetés soronként egy fájlt vár. Egy közös kulcsra mutató második
   * sor mindkettőt megsértené. A másolat ugyanazon a feltöltési úton megy, mint
   * egy új fájl (típus, keret, bélyegkép).
   *
   * Egy már továbbított üzenet továbbításánál az EREDETI szerző marad.
   */
  async forward(
    user: AuthenticatedUser,
    messageId: string,
    input: { conversationId: string; clientMessageId: string },
  ): Promise<MessageItem> {
    const source = await this.messageOr404(messageId, user.id);
    if (source.deletedAt)
      throw new BadRequestException("Törölt üzenet nem továbbítható.");
    if (source.type === "SYSTEM")
      throw new BadRequestException("Rendszerüzenet nem továbbítható.");
    await this.membershipOr404(input.conversationId, user.id);

    const existing = await this.repository.messageByClientId(
      user.id,
      input.clientMessageId,
    );
    if (existing)
      return this.sameConversationOr409(
        existing,
        input.conversationId,
        user.id,
      );

    const attachmentIds: string[] = [];
    for (const attachment of source.attachments) {
      const bytes = this.store
        ? await this.store.get({
            owner: "message",
            ownerId: source.conversationId,
            documentId: attachment.id,
          })
        : null;
      if (!bytes)
        throw new NotFoundException(
          "A továbbítandó csatolmány most nem érhető el.",
        );
      const copy = await this.uploadAttachment(user, input.conversationId, {
        originalname: attachment.fileName,
        mimetype: attachment.contentType,
        buffer: Buffer.from(bytes),
      });
      attachmentIds.push(copy.id);
    }

    return this.deliver(
      user,
      input.conversationId,
      {
        text: source.text ?? undefined,
        clientMessageId: input.clientMessageId,
        attachmentIds,
      },
      {
        messageId: source.id,
        userId: source.forwardedFromUserId ?? source.senderUserId,
      },
    );
  }

  // --- 4. fázis: munkalaphoz és hibajegyhez kötött beszélgetés, tagság

  /**
   * „BESZÉLGETÉS” A MUNKALAPRÓL VAGY A HIBAJEGYRŐL (4. fázis, prompt 23. pont;
   * Balázs, 2026-10-05). Objektumonként EGY élő beszélgetés: ha van, azt adja
   * (és a kérdezőt felveszi, ha még nem tag); ha nincs, létrehozza az indítóval
   * és a munkalap szerelőivel (hibajegynél a felelőssel). Szervizjog kell hozzá.
   */
  async openContextConversation(
    user: AuthenticatedUser,
    type: ConversationContextType,
    id: string,
  ): Promise<ConversationDetail> {
    this.assertInternal(user);
    this.assertSeesService(user);
    const subject = await this.contextSubject(type, id);
    if (!subject)
      throw new NotFoundException(
        `A ${type === "WORKSHEET" ? "munkalap" : "hibajegy"} nem található.`,
      );

    const existing = await this.repository.conversationByContext(type, id);
    if (existing) return this.joinContextConversation(user, existing);

    const people = (await this.repository.users(subject.memberIds)).filter(
      (row) => row.id !== user.id && mayJoinInternal(row),
    );
    const memberIds = [user.id, ...people.map((row) => row.id)].slice(
      0,
      CONVERSATION_MAX_MEMBERS,
    );
    const { id: conversationId, created } =
      await this.repository.createConversation({
        type: "GROUP",
        title: subject.title,
        description: null,
        createdByUserId: user.id,
        directKey: null,
        memberIds,
        context: { type, id },
      });
    if (!created) return this.joinContextConversation(user, conversationId);

    await this.repository.audit({
      userId: user.id,
      action: "conversation.created",
      conversationId,
      metadata: { type: "GROUP", memberIds, context: { type, id } },
    });
    this.bus.publish(memberIds, {
      type: "conversation.created",
      conversationId,
    });
    await this.systemEvent(
      conversationId,
      user,
      systemText.started(
        personDisplayName(user),
        type,
        contextRef(subject.number),
      ),
    );
    return this.detail(user, conversationId);
  }

  /** Egy MEGLÉVŐ csoport kötése munkalaphoz vagy hibajegyhez (Balázs: utólag is). */
  async linkContext(
    user: AuthenticatedUser,
    conversationId: string,
    input: { type: ConversationContextType; id: string },
  ): Promise<ConversationDetail> {
    this.assertSeesService(user);
    await this.membershipOr404(conversationId, user.id);
    const row = await this.repository.conversation(conversationId);
    if (!row) throw notFound();
    if (row.type !== "GROUP")
      throw new BadRequestException(
        "Csak csoportos beszélgetés köthető munkalaphoz vagy hibajegyhez.",
      );
    if (row.contextId) {
      if (row.contextType === input.type && row.contextId === input.id)
        return this.detail(user, conversationId);
      throw new ConflictException(
        "Ez a beszélgetés már egy másikhoz kapcsolódik. Előbb válaszd le.",
      );
    }
    const subject = await this.contextSubject(input.type, input.id);
    if (!subject)
      throw new NotFoundException("A munkalap vagy a hibajegy nem található.");
    if (!(await this.repository.setContext(conversationId, input)))
      throw new ConflictException(
        `Ehhez a ${input.type === "WORKSHEET" ? "munkalaphoz" : "hibajegyhez"} már tartozik beszélgetés.`,
      );
    await this.repository.audit({
      userId: user.id,
      action: "conversation.linked",
      conversationId,
      metadata: { context: input },
    });
    await this.systemEvent(
      conversationId,
      user,
      systemText.linked(
        personDisplayName(user),
        input.type,
        contextRef(subject.number),
      ),
    );
    return this.detail(user, conversationId);
  }

  /** A kötés leválasztása; a beszélgetés megmarad. Kötés nélkül nem hiba. */
  async unlinkContext(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<ConversationDetail> {
    this.assertSeesService(user);
    await this.membershipOr404(conversationId, user.id);
    const row = await this.repository.conversation(conversationId);
    if (!row) throw notFound();
    if (!isContextType(row.contextType) || !row.contextId)
      return this.detail(user, conversationId);
    const type = row.contextType;
    const subject = await this.contextSubject(type, row.contextId);
    await this.repository.setContext(conversationId, null);
    await this.repository.audit({
      userId: user.id,
      action: "conversation.unlinked",
      conversationId,
      metadata: { context: { type, id: row.contextId } },
    });
    await this.systemEvent(
      conversationId,
      user,
      systemText.unlinked(
        personDisplayName(user),
        type,
        contextRef(subject?.number),
      ),
    );
    return this.detail(user, conversationId);
  }

  /**
   * TAG HOZZÁADÁSA (4. fázis; Balázs, 2026-10-05: bármelyik tag, és látszik).
   * Csak csoportba, csak aktív belső kolléga, a felső határig. Aki már tag, az
   * kimarad, nem hiba.
   */
  async addMembers(
    user: AuthenticatedUser,
    conversationId: string,
    userIds: readonly string[],
  ): Promise<ConversationDetail> {
    this.assertInternal(user);
    await this.membershipOr404(conversationId, user.id);
    const row = await this.repository.conversation(conversationId);
    if (!row) throw notFound();
    if (row.type !== "GROUP")
      throw new BadRequestException(
        "Közvetlen beszélgetéshez nem adható tag; indíts csoportot.",
      );
    const current = new Set(row.members.map((member) => member.userId));
    const wanted = [...new Set(userIds)].filter((id) => !current.has(id));
    if (wanted.length === 0) return this.detail(user, conversationId);
    this.refuseUnavailableAssistant(user, wanted);
    if (current.size + wanted.length > CONVERSATION_MAX_MEMBERS)
      throw new BadRequestException(
        `Egy beszélgetésnek legfeljebb ${CONVERSATION_MAX_MEMBERS} tagja lehet.`,
      );
    const found = new Map(
      (await this.repository.users(wanted)).map((u) => [u.id, u]),
    );
    const refused = wanted.filter((id) => {
      const person = found.get(id);
      return !person || !mayJoinInternal(person);
    });
    if (refused.length > 0)
      throw new BadRequestException(
        "A kiválasztottak között van, aki nem vehető fel (inaktív, partnerfiók vagy nem létező felhasználó).",
      );
    await this.repository.addMembers(conversationId, wanted);
    await this.repository.audit({
      userId: user.id,
      action: "conversation.members_added",
      conversationId,
      metadata: { userIds: wanted },
    });
    this.bus.publish(wanted, { type: "conversation.created", conversationId });
    await this.systemEvent(
      conversationId,
      user,
      systemText.added(
        personDisplayName(user),
        wanted.map((id) => personDisplayName(found.get(id)!)),
      ),
    );
    return this.detail(user, conversationId);
  }

  /**
   * KILÉPÉS (4. fázis). Csak csoportból. A rendszerüzenet még tagként megy ki,
   * utána a tagság zárul; az utolsó kilépő után a beszélgetés archív.
   */
  async leave(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<{ left: true; archived: boolean }> {
    await this.membershipOr404(conversationId, user.id);
    const row = await this.repository.conversation(conversationId);
    if (!row) throw notFound();
    if (row.type !== "GROUP")
      throw new BadRequestException(
        "Közvetlen beszélgetésből nem lehet kilépni.",
      );
    await this.systemEvent(
      conversationId,
      user,
      systemText.left(personDisplayName(user)),
    );
    const remaining = await this.repository.leave(conversationId, user.id);
    await this.repository.audit({
      userId: user.id,
      action: "conversation.member_left",
      conversationId,
      metadata: { remaining },
    });
    return { left: true, archived: remaining === 0 };
  }

  /** A meglévő kötött beszélgetés: a kérdező, ha még nem tag, belép (szervizjoggal látja a tárgyat). */
  private async joinContextConversation(
    user: AuthenticatedUser,
    conversationId: string,
  ): Promise<ConversationDetail> {
    if (!(await this.repository.activeMembership(conversationId, user.id))) {
      await this.repository.addMembers(conversationId, [user.id]);
      await this.repository.audit({
        userId: user.id,
        action: "conversation.members_added",
        conversationId,
        metadata: { userIds: [user.id], joinedFromContext: true },
      });
      this.bus.publish([user.id], {
        type: "conversation.created",
        conversationId,
      });
      await this.systemEvent(
        conversationId,
        user,
        systemText.joined(personDisplayName(user)),
      );
    }
    return this.detail(user, conversationId);
  }

  /**
   * A kötés tárgya: a beszélgetés neve, a szám, és akik automatikusan bekerülnek
   * (munkalapnál a szerelői, hibajegynél a felelőse). A rejtett munkalap nincs.
   */
  private async contextSubject(type: ConversationContextType, id: string) {
    if (type === "WORKSHEET") {
      const sheet = await this.repository.worksheetForContext(id);
      if (!sheet || sheet.hiddenAt) return null;
      return {
        number: sheet.number,
        title: [sheet.number ?? "Munkalap", sheet.customer.displayName].join(
          " · ",
        ),
        memberIds: sheet.assignees.map((a) => a.userId),
      };
    }
    const job = await this.repository.serviceJobForContext(id);
    if (!job) return null;
    return {
      number: job.jobNumber,
      title: [job.jobNumber, job.customer?.displayName]
        .filter(Boolean)
        .join(" · "),
      memberIds: job.assignedUserId ? [job.assignedUserId] : [],
    };
  }

  /**
   * A KAPCSOLT OBJEKTUM KÁRTYÁJA. Aki a szervizt nem látja, annak csak a típus
   * és a szám megy ki (`restricted`): a beszélgetés nem kiskapu a szerviz-adatokhoz.
   */
  private async contextCard(
    user: AuthenticatedUser,
    row: { contextType: string | null; contextId: string | null },
  ): Promise<ConversationContextCard | null> {
    if (!isContextType(row.contextType) || !row.contextId) return null;
    const type = row.contextType;
    const id = row.contextId;
    const sees = ROLE_PERMISSIONS[user.role].includes(PERMISSIONS.SERVICE_VIEW);
    if (type === "WORKSHEET") {
      const sheet = await this.repository.worksheetForContext(id);
      const version = sheet?.versions[0];
      return {
        type,
        id,
        number: sheet?.number ?? null,
        restricted: !sees,
        partnerName: sees ? (sheet?.customer.displayName ?? null) : null,
        status:
          sees && version
            ? worksheetDisplayStatus(version.status, version._count.lines)
            : null,
        createdAt: sees && sheet ? sheet.createdAt.toISOString() : null,
      };
    }
    const job = await this.repository.serviceJobForContext(id);
    return {
      type,
      id,
      number: job?.jobNumber ?? null,
      restricted: !sees,
      partnerName: sees ? (job?.customer?.displayName ?? null) : null,
      status: sees ? (job?.status ?? null) : null,
      createdAt: sees && job ? job.createdAt.toISOString() : null,
    };
  }

  /** Rendszerüzenet a folyamba; PUSH NEM megy, mert esemény, nem üzenet. */
  private async systemEvent(
    conversationId: string,
    actor: AuthenticatedUser,
    text: string,
  ): Promise<void> {
    const row = await this.repository.createSystemMessage({
      conversationId,
      actorUserId: actor.id,
      text,
    });
    const members = await this.repository.members(conversationId);
    this.bus.publish(
      members.filter((m) => m.leftAt === null).map((m) => m.userId),
      { type: "message.created", conversationId, messageId: row.id },
    );
  }

  private assertSeesService(user: AuthenticatedUser) {
    if (!ROLE_PERMISSIONS[user.role].includes(PERMISSIONS.SERVICE_VIEW))
      throw new ForbiddenException(
        "A szervizt nem látod, ezért ezt nem teheted meg.",
      );
  }

  /** Az üzenet, ha a kérdező tagja a beszélgetésének; különben 404. */
  private async messageOr404(messageId: string, userId: string) {
    const row = await this.repository.message(messageId);
    if (
      !row ||
      !(await this.repository.activeMembership(row.conversationId, userId))
    )
      throw new NotFoundException("Az üzenet nem található.");
    return row;
  }

  /** A változásról a beszélgetés minden aktív tagja tudjon. */
  private async updated(row: { id: string; conversationId: string }) {
    const members = await this.repository.members(row.conversationId);
    this.bus.publish(
      members.filter((m) => m.leftAt === null).map((m) => m.userId),
      {
        type: "message.updated",
        conversationId: row.conversationId,
        messageId: row.id,
      },
    );
  }

  private async membershipOr404(conversationId: string, userId: string) {
    const membership = await this.repository.activeMembership(
      conversationId,
      userId,
    );
    if (!membership) throw notFound();
    return membership;
  }

  /**
   * A KÉRDEZŐ IS BELSŐ KOLLÉGA LEGYEN. A jogosultság-őr a szerepkört nézi; egy
   * partnerhez kötött fiók viszont belső szerepkörrel is járhat, és ő nem
   * indíthat belső beszélgetést.
   */
  private assertInternal(user: AuthenticatedUser) {
    if (user.customerId !== null || user.supplierId !== null)
      throw new ForbiddenException(
        "Partnerfiókkal az Üzenetek nem érhetők el.",
      );
  }
}

const notFound = () => new NotFoundException("A beszélgetés nem található.");

function toPerson(row: MessagingUserRow): ConversationPerson {
  return {
    userId: row.id,
    name: personDisplayName(row),
    avatarUrl: row.avatarUrl,
    role: row.role,
    isActive: row.isActive,
    ...(row.role === "ASSISTANT" ? { kind: "assistant" as const } : {}),
  };
}

function toMessage(row: MessageRow, viewerId: string): MessageItem {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderUserId: row.senderUserId,
    senderName: personDisplayName(row.sender),
    type: row.type,
    // a törölt üzenet szövege az adatbázisban marad, de senkinek nem megy ki
    text: deleted ? null : row.text,
    deleted,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    replyToMessageId: row.replyToMessageId,
    replyTo: row.replyTo
      ? {
          id: row.replyTo.id,
          senderName: personDisplayName(row.replyTo.sender),
          // az eredeti törlése után sem szakad el, de a szövege nem megy ki
          text: row.replyTo.deletedAt ? null : row.replyTo.text,
          deleted: row.replyTo.deletedAt !== null,
          attachmentKind: row.replyTo.attachments[0]?.kind ?? null,
        }
      : null,
    // a törölt üzenet csatolmánya és reakciói sem mennek ki
    attachments: deleted ? [] : row.attachments.map(toAttachment),
    reactions: deleted ? [] : reactionSummary(row.reactions, viewerId),
    clientMessageId: row.senderUserId === viewerId ? row.clientMessageId : null,
    pinned: !deleted && row.pins.length > 0,
    forwardedFrom: row.forwardedFromUser
      ? { senderName: personDisplayName(row.forwardedFromUser) }
      : null,
    // 4. pont B: Sutyerák üzenetén, honnan jött a válasz
    ...(row.senderUserId === SUTYERAK_USER_ID
      ? { assistant: { viaAcrobot: row.assistantSource === "ACROBOT" } }
      : {}),
  };
}

/** A tag értesítési beállítása a kliensnek: a lejárt némítás nem némítás. */
function notificationState(row: {
  notify: "ALL" | "MENTIONS" | "NONE";
  mutedUntil: Date | null;
}): ConversationNotificationState {
  return {
    notify: row.notify,
    mutedUntil:
      row.mutedUntil && row.mutedUntil.getTime() > Date.now()
        ? row.mutedUntil.toISOString()
        : null,
  };
}

const PINNED_TITLE_MAX = 120;

/** A kitűzött elem címe: a szöveg első sora, vagy szöveg nélkül a csatolmány neve. */
export function pinnedTitle(
  text: string | null,
  fileName: string | undefined,
): string {
  const line = (text ?? "")
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return fileName ?? "Üzenet";
  const chars = [...line];
  return chars.length > PINNED_TITLE_MAX
    ? `${chars.slice(0, PINNED_TITLE_MAX - 1).join("")}…`
    : line;
}

function toAttachment(row: {
  id: string;
  kind: "IMAGE" | "FILE";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  thumbnailKey: string | null;
}): MessageAttachmentItem {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    hasThumbnail: row.thumbnailKey !== null,
  };
}

/** A reakciók összesítve, a négy támogatott jel sorrendjében. */
function reactionSummary(
  rows: readonly { reaction: string; userId: string }[],
  viewerId: string,
): MessageItem["reactions"] {
  return MESSAGE_REACTIONS.flatMap((reaction) => {
    const mine = rows.filter((r) => r.reaction === reaction);
    return mine.length
      ? [
          {
            reaction,
            count: mine.length,
            mine: mine.some((r) => r.userId === viewerId),
          },
        ]
      : [];
  });
}

const attachmentNotFound = () =>
  new NotFoundException("A csatolmány nem található.");

function toListItem(
  row: ConversationRow,
  viewerId: string,
  unreadCount: number,
  lastMessages: ReadonlyMap<string, MessageRow>,
): ConversationListItem {
  const last = row.lastMessageId
    ? lastMessages.get(row.lastMessageId)
    : undefined;
  return {
    id: row.id,
    type: row.type,
    audience: row.audience,
    title: row.title,
    members: row.members
      .filter((member) => member.userId !== viewerId)
      .map((member) => toPerson(member.user)),
    lastMessage: last ? toMessage(last, viewerId) : null,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    unreadCount,
    contextType: isContextType(row.contextType) ? row.contextType : null,
  };
}

const isContextType = (
  value: string | null,
): value is ConversationContextType =>
  value === "WORKSHEET" || value === "SERVICE_JOB";
