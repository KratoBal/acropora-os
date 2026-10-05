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
  clientMessageId: string | null;
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
  | { type: "conversation.read"; conversationId: string };
