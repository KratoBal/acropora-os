/**
 * AZ ÜZENETEK TÍPUSAI A TELEFONON. Másolatok a
 * `packages/types/src/messages.ts`-ből, mezőről mezőre (az Expo app nem húzza be
 * a workspace csomagokat); az API `mobile-response-mirror.spec.ts`-e veti össze
 * a neveket.
 *
 * Más import nincs, szándékosan: a tiszta szabályok (`sse.ts`, `outbox.ts`)
 * ezeket olvassák, és a `node --test` fordítás nem old fel `@/` utat.
 */

export type ConversationTypeValue = "DIRECT" | "GROUP";
export type ConversationAudienceValue = "INTERNAL" | "PARTNER";
export type MessageTypeValue = "TEXT" | "IMAGE" | "FILE" | "SYSTEM";

export interface ConversationPerson {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
}

/** A négy reakció (acrobot döntése, 26242); a szerver ezen kívül mást nem fogad el. */
export const MESSAGE_REACTIONS = ["👍", "❤️", "✅", "👀"] as const;
export type MessageReactionValue = (typeof MESSAGE_REACTIONS)[number];

/** Egy üzenethez legfeljebb ennyi csatolmány köthető. */
export const MESSAGE_ATTACHMENTS_MAX = 10;

export type MessageAttachmentKindValue = "IMAGE" | "FILE";

export interface MessageAttachmentItem {
  id: string;
  kind: MessageAttachmentKindValue;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  hasThumbnail: boolean;
}

export interface MessageReactionSummary {
  reaction: MessageReactionValue;
  count: number;
  mine: boolean;
}

export interface MessageReplyPreview {
  id: string;
  senderName: string;
  text: string | null;
  deleted: boolean;
  attachmentKind: MessageAttachmentKindValue | null;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  type: MessageTypeValue;
  text: string | null;
  deleted: boolean;
  createdAt: string;
  editedAt: string | null;
  replyToMessageId: string | null;
  replyTo: MessageReplyPreview | null;
  attachments: MessageAttachmentItem[];
  reactions: MessageReactionSummary[];
  clientMessageId: string | null;
  /** 3. fázis: kitűzött-e; a felület a 3c-ben jön. */
  pinned?: boolean;
  /** 3. fázis: továbbításnál az eredeti szerző neve. */
  forwardedFrom?: { senderName: string } | null;
}

export interface ConversationListItem {
  id: string;
  type: ConversationTypeValue;
  audience: ConversationAudienceValue;
  title: string | null;
  members: ConversationPerson[];
  lastMessage: MessageItem | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface ConversationListResponse {
  items: ConversationListItem[];
}

export interface ConversationDetail extends ConversationListItem {
  description: string | null;
  createdByUserId: string;
  lastReadMessageId: string | null;
}

export interface MessagePage {
  items: MessageItem[];
  olderCursor: string | null;
}

export interface MessagesUnreadResponse {
  total: number;
  conversations: number;
}

export interface MessagePeopleResponse {
  items: ConversationPerson[];
}

export type MessageStreamEvent =
  | { type: "message.created"; conversationId: string; messageId: string }
  | { type: "conversation.created"; conversationId: string }
  | { type: "conversation.read"; conversationId: string }
  | { type: "message.updated"; conversationId: string; messageId: string };
