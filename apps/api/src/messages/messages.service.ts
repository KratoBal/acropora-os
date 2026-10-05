import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import {
  CONVERSATION_MAX_MEMBERS,
  MESSAGE_PAGE_DEFAULT,
  MESSAGE_PAGE_MAX,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
  personDisplayName,
  type AuthenticatedUser,
  type ConversationDetail,
  type ConversationListItem,
  type ConversationPerson,
  type MessageItem,
  type MessagePage,
  type MessagesUnreadResponse,
} from "@acropora/types";

import { NotificationsService } from "../notifications/notifications.service.js";
import {
  MESSAGE_EVENT_BUS,
  type MessageEventBus,
} from "./message-event-bus.js";
import {
  MessagesRepository,
  type ConversationRow,
  type MessageRow,
  type MessagingUserRow,
} from "./messages.repository.js";
import {
  cleanMessageText,
  decodeCursor,
  directKeyOf,
  encodeCursor,
  mayJoinInternal,
  messagePushText,
  pushRecipients,
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
  ) {}

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
   */
  async send(
    user: AuthenticatedUser,
    id: string,
    input: { text: string; clientMessageId: string },
  ): Promise<MessageItem> {
    await this.membershipOr404(id, user.id);
    const text = cleanMessageText(input.text);
    if (!text) throw new BadRequestException("Üres üzenet nem küldhető.");

    const existing = await this.repository.messageByClientId(
      user.id,
      input.clientMessageId,
    );
    if (existing) return this.sameConversationOr409(existing, id, user.id);

    let row: MessageRow;
    try {
      row = await this.repository.createMessage({
        conversationId: id,
        senderUserId: user.id,
        text,
        clientMessageId: input.clientMessageId,
      });
    } catch (error) {
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
    if (userIds.length === 0 || !row.text) return;
    const conversation = await this.repository.conversation(row.conversationId);
    const { title, body } = messagePushText({
      conversationTitle:
        conversation?.type === "GROUP"
          ? (conversation.title ?? "Csoport")
          : null,
      senderName: personDisplayName(sender),
      text: row.text,
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
    clientMessageId: row.senderUserId === viewerId ? row.clientMessageId : null,
  };
}

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
