import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { UserRole } from "@acropora/types";

/**
 * AZ ÜZENETEK ADATELÉRÉSE (kártya 51d7aba0). A jogosultságot nem ez dönti el:
 * a szolgáltatás minden hívás előtt megnézi a tagságot.
 */

export interface MessagingUserRow {
  id: string;
  role: UserRole;
  isActive: boolean;
  customerId: string | null;
  supplierId: string | null;
  displayName: string;
  nickname: string | null;
  avatarUrl: string | null;
}

const USER_SELECT = {
  id: true,
  role: true,
  isActive: true,
  customerId: true,
  supplierId: true,
  displayName: true,
  nickname: true,
  avatarUrl: true,
} as const;

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderUserId: true,
  type: true,
  text: true,
  clientMessageId: true,
  replyToMessageId: true,
  createdAt: true,
  editedAt: true,
  deletedAt: true,
  sender: { select: { displayName: true, nickname: true } },
} as const;

export type MessageRow = Prisma.MessageGetPayload<{
  select: typeof MESSAGE_SELECT;
}>;

const CONVERSATION_SELECT = {
  id: true,
  type: true,
  audience: true,
  title: true,
  description: true,
  createdByUserId: true,
  lastMessageId: true,
  lastMessageAt: true,
  members: {
    where: { leftAt: null },
    select: {
      userId: true,
      lastReadMessageId: true,
      user: { select: USER_SELECT },
    },
  },
} as const;

export type ConversationRow = Prisma.ConversationGetPayload<{
  select: typeof CONVERSATION_SELECT;
}>;

export interface MemberRow {
  userId: string;
  leftAt: Date | null;
  notify: "ALL" | "MENTIONS" | "NONE";
  mutedUntil: Date | null;
}

@Injectable()
export class MessagesRepository extends Repository {
  constructor() {
    super(prisma);
  }

  users(ids: readonly string[]): Promise<MessagingUserRow[]> {
    return this.database.user.findMany({
      where: { id: { in: [...ids] } },
      select: USER_SELECT,
    });
  }

  /**
   * AKIVEL BESZÉLGETÉS INDÍTHATÓ: aktív, partnerhez nem kötött fiók a megadott
   * szerepkörökből, név vagy e-mail szerint. A szerepkör-szűrést a szolgáltatás
   * adja át (`messages.use`), hogy a szabály egy helyen álljon.
   */
  people(input: {
    roles: readonly UserRole[];
    query: string;
    excludeUserId: string;
    limit: number;
  }): Promise<MessagingUserRow[]> {
    const q = input.query.trim();
    return this.database.user.findMany({
      where: {
        isActive: true,
        customerId: null,
        supplierId: null,
        role: { in: [...input.roles] },
        id: { not: input.excludeUserId },
        ...(q
          ? {
              OR: [
                { displayName: { contains: q, mode: "insensitive" } },
                { nickname: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: USER_SELECT,
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: input.limit,
    });
  }

  directConversationId(directKey: string): Promise<string | null> {
    return this.database.conversation
      .findUnique({ where: { directKey }, select: { id: true } })
      .then((row) => row?.id ?? null);
  }

  /**
   * LÉTREHOZÁS A TAGOKKAL EGY TRANZAKCIÓBAN. DIRECT-nél a `directKey` egyedisége
   * a végső őr: ha közben a másik fél is elindította, az ütközés után a meglévőt
   * adjuk vissza, nem hibát.
   */
  async createConversation(input: {
    type: "DIRECT" | "GROUP";
    title: string | null;
    description: string | null;
    createdByUserId: string;
    directKey: string | null;
    memberIds: readonly string[];
  }): Promise<{ id: string; created: boolean }> {
    try {
      const row = await this.database.conversation.create({
        data: {
          type: input.type,
          audience: "INTERNAL",
          title: input.title,
          description: input.description,
          createdByUserId: input.createdByUserId,
          directKey: input.directKey,
          members: {
            create: input.memberIds.map((userId) => ({ userId })),
          },
        },
        select: { id: true },
      });
      return { id: row.id, created: true };
    } catch (error) {
      if (
        input.directKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.directConversationId(input.directKey);
        if (existing) return { id: existing, created: false };
      }
      throw error;
    }
  }

  /** A kérdező AKTÍV tagsága, vagy `null`. Minden `:id` útvonal ezzel kezd. */
  activeMembership(conversationId: string, userId: string) {
    return this.database.conversationMember.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
        conversation: { archivedAt: null },
      },
      select: { joinedAt: true, lastReadAt: true, lastReadMessageId: true },
    });
  }

  conversationsOf(userId: string): Promise<ConversationRow[]> {
    return this.database.conversation.findMany({
      where: {
        archivedAt: null,
        members: { some: { userId, leftAt: null } },
      },
      select: CONVERSATION_SELECT,
      orderBy: [
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { id: "asc" },
      ],
      take: 500,
    });
  }

  conversation(id: string): Promise<ConversationRow | null> {
    return this.database.conversation.findUnique({
      where: { id },
      select: CONVERSATION_SELECT,
    });
  }

  messagesByIds(ids: readonly string[]): Promise<MessageRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.database.message.findMany({
      where: { id: { in: [...ids] } },
      select: MESSAGE_SELECT,
    });
  }

  /**
   * AZ OLVASATLAN-SZÁM EGY LEKÉRDEZÉSBEN, beszélgetésenként: más által küldött,
   * nem törölt üzenet, ami a tag olvasási mutatója (ha nincs, a csatlakozása)
   * után keletkezett. Üzenet × tag rekord nincs, és N+1 sincs.
   */
  async unreadCounts(userId: string): Promise<Map<string, number>> {
    const rows = await this.database.$queryRaw<
      { conversationId: string; unread: number }[]
    >`
      SELECT m."conversationId", COUNT(*)::int AS unread
      FROM "Message" m
      JOIN "ConversationMember" cm
        ON cm."conversationId" = m."conversationId"
       AND cm."userId" = ${userId}
       AND cm."leftAt" IS NULL
      JOIN "Conversation" c
        ON c."id" = m."conversationId"
       AND c."archivedAt" IS NULL
      WHERE m."senderUserId" <> ${userId}
        AND m."deletedAt" IS NULL
        AND m."createdAt" > COALESCE(cm."lastReadAt", cm."joinedAt")
      GROUP BY m."conversationId"
    `;
    return new Map(rows.map((row) => [row.conversationId, row.unread]));
  }

  /**
   * EGY OLDAL, A LEGÚJABBTÓL VISSZAFELÉ, a `(createdAt, id)` kurzor ELŐTT. Egy
   * elemmel többet kér, abból tudja, van-e még régebbi.
   */
  async messagesPage(input: {
    conversationId: string;
    before: { createdAt: Date; id: string } | null;
    limit: number;
  }): Promise<{ rows: MessageRow[]; hasOlder: boolean }> {
    const rows = await this.database.message.findMany({
      where: {
        conversationId: input.conversationId,
        ...(input.before
          ? {
              OR: [
                { createdAt: { lt: input.before.createdAt } },
                {
                  createdAt: input.before.createdAt,
                  id: { lt: input.before.id },
                },
              ],
            }
          : {}),
      },
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    return {
      rows: rows.slice(0, input.limit),
      hasOlder: rows.length > input.limit,
    };
  }

  messageByClientId(
    senderUserId: string,
    clientMessageId: string,
  ): Promise<MessageRow | null> {
    return this.database.message.findUnique({
      where: {
        senderUserId_clientMessageId: { senderUserId, clientMessageId },
      },
      select: MESSAGE_SELECT,
    });
  }

  /**
   * AZ ÜZENET, a beszélgetés előnézete és a küldő olvasási mutatója EGY
   * tranzakcióban: a saját üzenet sosem olvasatlan a küldőnek.
   */
  createMessage(input: {
    conversationId: string;
    senderUserId: string;
    text: string;
    clientMessageId: string;
  }): Promise<MessageRow> {
    return this.database.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderUserId: input.senderUserId,
          type: "TEXT",
          text: input.text,
          clientMessageId: input.clientMessageId,
        },
        select: MESSAGE_SELECT,
      });
      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { lastMessageId: message.id, lastMessageAt: message.createdAt },
      });
      await tx.conversationMember.updateMany({
        where: {
          conversationId: input.conversationId,
          userId: input.senderUserId,
        },
        data: { lastReadAt: message.createdAt, lastReadMessageId: message.id },
      });
      return message;
    });
  }

  messageInConversation(conversationId: string, messageId: string) {
    return this.database.message.findFirst({
      where: { id: messageId, conversationId },
      select: { id: true, createdAt: true },
    });
  }

  /** CSAK ELŐRE LÉP: egy régebbi üzenet olvasottnak jelölése nem tol vissza. */
  async markRead(input: {
    conversationId: string;
    userId: string;
    message: { id: string; createdAt: Date };
  }): Promise<boolean> {
    const result = await this.database.conversationMember.updateMany({
      where: {
        conversationId: input.conversationId,
        userId: input.userId,
        leftAt: null,
        OR: [
          { lastReadAt: null },
          { lastReadAt: { lt: input.message.createdAt } },
        ],
      },
      data: {
        lastReadAt: input.message.createdAt,
        lastReadMessageId: input.message.id,
      },
    });
    return result.count > 0;
  }

  members(conversationId: string): Promise<MemberRow[]> {
    return this.database.conversationMember.findMany({
      where: { conversationId },
      select: { userId: true, leftAt: true, notify: true, mutedUntil: true },
    });
  }

  audit(input: {
    userId: string;
    action: string;
    conversationId: string;
    metadata: Prisma.InputJsonValue;
  }) {
    return this.database.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: "Conversation",
        entityId: input.conversationId,
        metadata: input.metadata,
      },
    });
  }
}
