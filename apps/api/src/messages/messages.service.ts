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
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
  personDisplayName,
  type AuthenticatedUser,
  type ConversationDetail,
  type ConversationListItem,
  type ConversationPerson,
  type MessageAttachmentItem,
  type MessageItem,
  type MessagePage,
  type MessagesUnreadResponse,
} from "@acropora/types";

import {
  DocumentOverQuota,
  DocumentRejected,
  discardStoredDocument,
  prepareDocument,
} from "../documents/document-intake.js";
import { NotificationsService } from "../notifications/notifications.service.js";
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
  messagePushText,
  messageTypeFor,
  pushRecipients,
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
  ) {}

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
    return { items: rows.filter(mayJoinInternal).map(toPerson) };
  }

  async createConversation(
    user: AuthenticatedUser,
    input: { memberIds: string[]; title?: string; description?: string },
  ): Promise<ConversationDetail> {
    this.assertInternal(user);
    const others = [...new Set(input.memberIds)].filter((id) => id !== user.id);
    if (others.length === 0)
      throw new BadRequestException("Legalább egy másik kollégát válassz ki.");
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
    };
  }

  async messages(
    user: AuthenticatedUser,
    id: string,
    query: { before?: string; limit?: number },
  ): Promise<MessagePage> {
    await this.membershipOr404(id, user.id);
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
    this.notifications.notifyNewMessage({
      messageId: row.id,
      conversationId: row.conversationId,
      userIds,
      title,
      body,
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
  };
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
  };
}
