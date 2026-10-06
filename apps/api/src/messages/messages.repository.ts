import { Injectable } from "@nestjs/common";
import { Prisma, Repository, prisma } from "@acropora/database";
import type { UserRole } from "@acropora/types";

import { sumDocumentBytesInUse } from "../documents/document-bytes-in-use.js";

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
  // a 2. fázis: csatolmányok, reakciók és a válasz előnézete, egy lekérdezésben
  attachments: {
    select: {
      id: true,
      kind: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      thumbnailKey: true,
    },
    orderBy: { createdAt: "asc" },
  },
  reactions: { select: { reaction: true, userId: true } },
  // a 3. fázis: a kitűzés (legfeljebb egy sor, az egyediség miatt) és a továbbítás eredeti szerzője
  pins: { select: { id: true } },
  forwardedFromMessageId: true,
  forwardedFromUserId: true,
  forwardedFromUser: { select: { displayName: true, nickname: true } },
  // 4. pont B: Sutyerák üzenetén a válasz forrása (átjáró vagy acrobot)
  assistantSource: true,
  replyTo: {
    select: {
      id: true,
      text: true,
      deletedAt: true,
      sender: { select: { displayName: true, nickname: true } },
      attachments: { select: { kind: true }, take: 1 },
    },
  },
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
  contextType: true,
  contextId: true,
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

/** A küldés olyan csatolmányra mutatott, ami nem köthető (másé, másik beszélgetésé vagy már elküldött). */
export class AttachmentBindingError extends Error {}

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
    /** 4. fázis: a kapcsolt munkalap vagy hibajegy. */
    context?: { type: string; id: string } | null;
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
          contextType: input.context?.type ?? null,
          contextId: input.context?.id ?? null,
          members: {
            create: input.memberIds.map((userId) => ({ userId })),
          },
        },
        select: { id: true },
      });
      return { id: row.id, created: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = input.directKey
          ? await this.directConversationId(input.directKey)
          : input.context
            ? await this.conversationByContext(
                input.context.type,
                input.context.id,
              )
            : null;
        if (existing) return { id: existing, created: false };
      }
      throw error;
    }
  }

  /** A munkalap vagy a hibajegy ÉLŐ beszélgetése (4. fázis), vagy `null`. */
  async conversationByContext(
    type: string,
    id: string,
  ): Promise<string | null> {
    const row = await this.database.conversation.findFirst({
      where: { contextType: type, contextId: id, archivedAt: null },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * A kötés írása vagy törlése (`null`). Ha az objektumnak már van élő
   * beszélgetése, a részleges egyedi index elutasítja: `false`.
   */
  async setContext(
    conversationId: string,
    context: { type: string; id: string } | null,
  ): Promise<boolean> {
    try {
      await this.database.conversation.update({
        where: { id: conversationId },
        data: {
          contextType: context?.type ?? null,
          contextId: context?.id ?? null,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return false;
      throw error;
    }
  }

  /**
   * TAGOK FELVÉTELE (4. fázis). Egy korábban kilépett tag visszatér: a
   * `leftAt` törlődik, a `joinedAt` most lesz, az olvasási mutatója üres, így
   * a távolléte alatti üzenetek nem számítanak olvasatlannak.
   */
  async addMembers(conversationId: string, userIds: readonly string[]) {
    const now = new Date();
    await this.database.$transaction(
      userIds.map((userId) =>
        this.database.conversationMember.upsert({
          where: { conversationId_userId: { conversationId, userId } },
          create: { conversationId, userId, joinedAt: now },
          update: {
            leftAt: null,
            joinedAt: now,
            lastReadAt: null,
            lastReadMessageId: null,
          },
        }),
      ),
    );
  }

  /**
   * KILÉPÉS (4. fázis). A tagság sora marad (`leftAt`), és ha senki nem maradt,
   * a beszélgetés archív lesz, nem törlődik. A maradó aktív tagok számát adja.
   */
  async leave(conversationId: string, userId: string): Promise<number> {
    return this.database.$transaction(async (tx) => {
      await tx.conversationMember.updateMany({
        where: { conversationId, userId, leftAt: null },
        data: { leftAt: new Date() },
      });
      const remaining = await tx.conversationMember.count({
        where: { conversationId, leftAt: null },
      });
      if (remaining === 0)
        await tx.conversation.update({
          where: { id: conversationId },
          data: { archivedAt: new Date() },
        });
      return remaining;
    });
  }

  /**
   * RENDSZERÜZENET (4. fázis, Figma 450:710): a cselekvő nevében, `SYSTEM`
   * típussal. A beszélgetés előnézetébe kerül, és a cselekvőnek nem olvasatlan.
   */
  createSystemMessage(input: {
    conversationId: string;
    actorUserId: string;
    text: string;
  }): Promise<MessageRow> {
    return this.database.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderUserId: input.actorUserId,
          type: "SYSTEM",
          text: input.text,
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
          userId: input.actorUserId,
        },
        data: { lastReadAt: message.createdAt, lastReadMessageId: message.id },
      });
      return message;
    });
  }

  /** A munkalap a kártyához és az automatikus tagsághoz (4. fázis). */
  worksheetForContext(id: string) {
    return this.database.worksheet.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        createdAt: true,
        hiddenAt: true,
        customer: { select: { displayName: true } },
        assignees: { select: { userId: true } },
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { status: true, _count: { select: { lines: true } } },
        },
      },
    });
  }

  /** A hibajegy a kártyához és az automatikus tagsághoz (4. fázis). */
  serviceJobForContext(id: string) {
    return this.database.serviceJob.findUnique({
      where: { id },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        createdAt: true,
        assignedUserId: true,
        customer: { select: { displayName: true } },
      },
    });
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
      select: {
        joinedAt: true,
        lastReadAt: true,
        lastReadMessageId: true,
        notify: true,
        mutedUntil: true,
      },
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

  /**
   * AZ ÚJABB OLDAL (3. fázis, „Ugrás”): a kurzornál újabb üzenetek, időrendben.
   * A `messagesPage` tükre: ugyanaz a (createdAt, id) rendezés, másik irány.
   */
  async messagesAfter(input: {
    conversationId: string;
    after: { createdAt: Date; id: string };
    limit: number;
  }): Promise<{ rows: MessageRow[]; hasNewer: boolean }> {
    const rows = await this.database.message.findMany({
      where: {
        conversationId: input.conversationId,
        OR: [
          { createdAt: { gt: input.after.createdAt } },
          { createdAt: input.after.createdAt, id: { gt: input.after.id } },
        ],
      },
      select: MESSAGE_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
    });
    return {
      rows: rows.slice(0, input.limit),
      hasNewer: rows.length > input.limit,
    };
  }

  /**
   * KERESÉS EGY BESZÉLGETÉSBEN (3. fázis, prompt 13. pont). Ékezet- és
   * kisbetű-független, ugyanúgy, mint az ügyfélkereső (`unaccent` mindkét
   * oldalon, a `messageSearchPattern` escape-elt mintájával). Törölt üzenet nem
   * jön. A számolás `cap`-nél megáll: egy beszélgetésen belül ez a teljes
   * találatszám, csak egy elszabadult beszélgetésen nem számolunk a végtelenig.
   */
  async searchMessages(input: {
    conversationId: string;
    pattern: string;
    limit: number;
    cap: number;
  }): Promise<{ ids: string[]; total: number }> {
    const [hits, counted] = await Promise.all([
      this.database.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Message"
        WHERE "conversationId" = ${input.conversationId}
          AND "deletedAt" IS NULL
          AND unaccent(COALESCE("text", '')) ILIKE unaccent(${input.pattern}::text)
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT ${input.limit}
      `,
      this.database.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS "total" FROM (
          SELECT 1 FROM "Message"
          WHERE "conversationId" = ${input.conversationId}
            AND "deletedAt" IS NULL
            AND unaccent(COALESCE("text", '')) ILIKE unaccent(${input.pattern}::text)
          LIMIT ${input.cap}
        ) AS capped
      `,
    ]);
    return {
      ids: hits.map((hit) => hit.id),
      total: Number(counted[0]?.total ?? 0),
    };
  }

  /**
   * A MEGOSZTOTT TARTALOM (3. fázis, prompt 15. pont): az ELKÜLDÖTT, nem törölt
   * üzenetek csatolmányai, a legújabb elöl. A gazdátlan feltöltés (még nincs
   * üzenete) nem megosztás. A `[conversationId, createdAt]` indexen fut.
   */
  async sharedAttachments(input: {
    conversationId: string;
    kind: "IMAGE" | "FILE";
    before: { createdAt: Date; id: string } | null;
    limit: number;
  }) {
    const rows = await this.database.messageAttachment.findMany({
      where: {
        conversationId: input.conversationId,
        kind: input.kind,
        // kifejezetten: a gazdátlan sor (messageId NULL) ne jöjjön, és a törölt üzeneté se
        messageId: { not: null },
        message: { is: { deletedAt: null } },
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
      select: {
        id: true,
        kind: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        thumbnailKey: true,
        createdAt: true,
        message: {
          select: {
            id: true,
            createdAt: true,
            sender: { select: { displayName: true, nickname: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    return {
      rows: rows.slice(0, input.limit),
      hasOlder: rows.length > input.limit,
    };
  }

  /**
   * KITŰZÉS (3. fázis, prompt 14. pont). Idempotens: egy már kitűzött üzenet
   * újabb kitűzése nem hiba, és nem hoz létre második sort (az egyediség az
   * adatbázisban áll). `true`, ha most jött létre.
   */
  async pin(input: {
    conversationId: string;
    messageId: string;
    userId: string;
  }): Promise<boolean> {
    try {
      await this.database.pinnedMessage.create({
        data: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          pinnedByUserId: input.userId,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        return false;
      throw error;
    }
  }

  /** A kitűzés levétele. `true`, ha volt mit levenni. */
  async unpin(conversationId: string, messageId: string): Promise<boolean> {
    const result = await this.database.pinnedMessage.deleteMany({
      where: { conversationId, messageId },
    });
    return result.count > 0;
  }

  /** A beszélgetés kitűzött üzenetei, a legutóbbi kitűzés elöl; a törölt üzeneté nem jön. */
  pins(conversationId: string) {
    return this.database.pinnedMessage.findMany({
      where: { conversationId, message: { deletedAt: null } },
      select: {
        createdAt: true,
        pinnedBy: { select: { displayName: true, nickname: true } },
        message: {
          select: {
            id: true,
            text: true,
            createdAt: true,
            sender: { select: { displayName: true, nickname: true } },
            attachments: {
              select: { fileName: true },
              orderBy: { createdAt: "asc" },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  /**
   * AZ OLVASATLAN ÖSSZESEN, CÍMZETTENKÉNT, egy lekérdezéssel: a push törzsébe
   * az app ikonjának száma (iOS `badge`). Ugyanaz a szabály, mint az
   * `unreadCounts`: más élő üzenete, az olvasási jel vagy a belépés után, élő
   * tagság, nem archivált beszélgetés.
   */
  async unreadTotals(
    userIds: readonly string[],
  ): Promise<Record<string, number>> {
    if (userIds.length === 0) return {};
    const rows = await this.database.$queryRaw<
      { userId: string; unread: number }[]
    >`
      SELECT cm."userId", COUNT(*)::int AS unread
      FROM "Message" m
      JOIN "ConversationMember" cm
        ON cm."conversationId" = m."conversationId"
       AND cm."leftAt" IS NULL
      JOIN "Conversation" c
        ON c."id" = m."conversationId"
       AND c."archivedAt" IS NULL
      WHERE cm."userId" IN (${Prisma.join([...userIds])})
        AND m."senderUserId" <> cm."userId"
        AND m."deletedAt" IS NULL
        AND m."createdAt" > COALESCE(cm."lastReadAt", cm."joinedAt")
      GROUP BY cm."userId"
    `;
    return Object.fromEntries([
      ...userIds.map((id) => [id, 0] as const),
      ...rows.map((row) => [row.userId, row.unread] as const),
    ]);
  }

  /** A tag értesítési beállítása ebben a beszélgetésben (3. fázis, prompt 17. pont). */
  async setNotification(
    conversationId: string,
    userId: string,
    data: { notify?: "ALL"; mutedUntil: Date | null },
  ) {
    return this.database.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data,
      select: { notify: true, mutedUntil: true },
    });
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
    text: string | null;
    clientMessageId: string;
    type?: "TEXT" | "IMAGE" | "FILE";
    replyToMessageId?: string | null;
    attachmentIds?: readonly string[];
    /** Továbbításnál az eredeti üzenet és a szerzője (3. fázis). */
    forwardedFrom?: { messageId: string; userId: string } | null;
    /** Sutyerák üzeneténél a válasz forrása (4. pont B). */
    assistantSource?: "GATEWAY" | "ACROBOT" | null;
  }): Promise<MessageRow> {
    return this.database.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          senderUserId: input.senderUserId,
          type: input.type ?? "TEXT",
          text: input.text,
          clientMessageId: input.clientMessageId,
          replyToMessageId: input.replyToMessageId ?? null,
          forwardedFromMessageId: input.forwardedFrom?.messageId ?? null,
          forwardedFromUserId: input.forwardedFrom?.userId ?? null,
          assistantSource: input.assistantSource ?? null,
        },
        select: { id: true },
      });
      /*
        A CSATOLMÁNY KÖTÉSE A TRANZAKCIÓN BELÜL: csak a küldő SAJÁT, ugyanebben a
        beszélgetésben feltöltött, még gazdátlan csatolmánya köthető. Ha a
        szám nem egyezik, az egész küldés visszagördül.
      */
      if (input.attachmentIds?.length) {
        const bound = await tx.messageAttachment.updateMany({
          where: {
            id: { in: [...input.attachmentIds] },
            conversationId: input.conversationId,
            uploadedByUserId: input.senderUserId,
            messageId: null,
          },
          data: { messageId: created.id },
        });
        if (bound.count !== input.attachmentIds.length)
          throw new AttachmentBindingError();
      }
      const message = await tx.message.findUniqueOrThrow({
        where: { id: created.id },
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

  message(id: string): Promise<MessageRow | null> {
    return this.database.message.findUnique({
      where: { id },
      select: MESSAGE_SELECT,
    });
  }

  /** A szerkesztés: csak a szöveg és az időpont változik. */
  async editMessage(id: string, text: string): Promise<void> {
    await this.database.message.update({
      where: { id },
      data: { text, editedAt: new Date() },
    });
  }

  /** SOFT DELETE: a szöveg és a csatolmány-sor marad, csak senkinek nem megy ki. */
  async deleteMessage(id: string, userId: string): Promise<void> {
    await this.database.message.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByUserId: userId },
    });
  }

  /** Reakció: az egyedi index miatt a második ugyanilyen nem jön létre. */
  async addReaction(messageId: string, userId: string, reaction: string) {
    await this.database.messageReaction.createMany({
      data: [{ messageId, userId, reaction }],
      skipDuplicates: true,
    });
  }

  async removeReaction(messageId: string, userId: string, reaction: string) {
    await this.database.messageReaction.deleteMany({
      where: { messageId, userId, reaction },
    });
  }

  createAttachment(input: {
    id: string;
    conversationId: string;
    uploadedByUserId: string;
    kind: "IMAGE" | "FILE";
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    storageKey: string;
    thumbnailKey: string | null;
  }) {
    return this.database.messageAttachment.create({
      data: input,
      select: {
        id: true,
        kind: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        thumbnailKey: true,
      },
    });
  }

  /** A küldés előtti ellenőrzéshez: kié, melyik beszélgetésé, kötött-e már. */
  attachmentsForSend(ids: readonly string[]) {
    return this.database.messageAttachment.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        kind: true,
        conversationId: true,
        uploadedByUserId: true,
        messageId: true,
      },
    });
  }

  attachment(id: string) {
    return this.database.messageAttachment.findUnique({
      where: { id },
      select: {
        id: true,
        conversationId: true,
        uploadedByUserId: true,
        messageId: true,
        fileName: true,
        contentType: true,
        storageKey: true,
        thumbnailKey: true,
        message: { select: { deletedAt: true } },
      },
    });
  }

  /** A gazdátlan feltöltések, amik a határnál régebbiek (a takarításhoz). */
  orphanAttachments(olderThan: Date) {
    return this.database.messageAttachment.findMany({
      where: { messageId: null, createdAt: { lt: olderThan } },
      select: { id: true, conversationId: true, thumbnailKey: true },
      take: 500,
    });
  }

  /** CSAK gazdátlant töröl: egy közben elküldött csatolmányt nem. */
  async deleteOrphanAttachment(id: string): Promise<boolean> {
    const result = await this.database.messageAttachment.deleteMany({
      where: { id, messageId: null },
    });
    return result.count > 0;
  }

  documentBytesInUse(): Promise<number> {
    return sumDocumentBytesInUse();
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

  /** Sutyerák szála ebben a beszélgetésben ennek a kérdezőnek (4. pont B). */
  async assistantThread(
    conversationId: string,
    userId: string,
  ): Promise<string | null> {
    const row = await this.database.assistantConversationThread.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { threadId: true },
    });
    return row?.threadId ?? null;
  }

  async saveAssistantThread(
    conversationId: string,
    userId: string,
    threadId: string,
  ): Promise<void> {
    await this.database.assistantConversationThread.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, threadId },
      update: { threadId },
    });
  }

  async dropAssistantThread(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    await this.database.assistantConversationThread.deleteMany({
      where: { conversationId, userId },
    });
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
