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
  /** 4. pont B: `"assistant"` Sutyerák; hiányzik vagy `"user"`: ember. */
  kind?: "user" | "assistant";
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
  /** 4. pont B: Sutyerák üzenetén; `viaAcrobot`: acrobot írta vissza a választ. */
  assistant?: { viaAcrobot: boolean } | null;
}

/** 4. fázis: mihez köthető egy beszélgetés (munkalap és hibajegy). */
export type ConversationContextType = "WORKSHEET" | "SERVICE_JOB";

/**
 * 4. fázis: a kapcsolt objektum kártyája. `restricted`: a néző a szervizt nem
 * látja, csak a típus és a szám jön, „Megnyitás” nélkül.
 */
export interface ConversationContextCard {
  type: ConversationContextType;
  id: string;
  number: string | null;
  partnerName: string | null;
  status: string | null;
  createdAt: string | null;
  restricted: boolean;
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
  /** 4. fázis: a kötés típusa a listán; nincs kötés: null. */
  contextType?: ConversationContextType | null;
}

export interface ConversationListResponse {
  items: ConversationListItem[];
}

export interface ConversationDetail extends ConversationListItem {
  description: string | null;
  createdByUserId: string;
  lastReadMessageId: string | null;
  /** 3. fázis: a saját értesítési beállítás ebben a beszélgetésben. */
  notification?: ConversationNotificationState;
  /** 4. fázis: a kapcsolt munkalap vagy hibajegy kártyája; nincs kötés: null. */
  context?: ConversationContextCard | null;
  /** 4. pont B: Sutyerák épp válaszol ebben a beszélgetésben. */
  assistantThinking?: boolean;
  /** fecbb1fe: a kérdező törölheti-e a beszélgetést (a szerver dönt). */
  canDelete?: boolean;
}

export interface MessagePage {
  items: MessageItem[];
  olderCursor: string | null;
  /** 3. fázis, „Ugrás”: van-e még újabb oldal a köré nyitott oldal után. */
  newerCursor?: string | null;
}

/** 3. fázis: keresés a megnyitott beszélgetésben (a közös csomag tükre). */
export const MESSAGE_SEARCH_MIN_LENGTH = 2;

export interface MessageSearchHit {
  messageId: string;
  senderName: string;
  createdAt: string;
  snippet: string;
}

export interface MessageSearchResponse {
  total: number;
  totalCapped: boolean;
  items: MessageSearchHit[];
}

/** 3. fázis: egy kitűzött elem. */
export interface PinnedItem {
  messageId: string;
  title: string;
  senderName: string;
  messageCreatedAt: string;
  pinnedByName: string;
  pinnedAt: string;
}

export interface PinnedItemsResponse {
  items: PinnedItem[];
}

/** 3. fázis: a megosztott média és fájlok. */
export interface SharedAttachmentItem extends MessageAttachmentItem {
  messageId: string;
  senderName: string;
  createdAt: string;
}

export interface SharedAttachmentPage {
  items: SharedAttachmentItem[];
  olderCursor: string | null;
}

/** 3. fázis: az értesítési beállítás módjai és állapota. */
export type ConversationNotifyMode =
  "ALL" | "MUTE_1H" | "MUTE_UNTIL_MORNING" | "UNMUTE";

export interface ConversationNotificationState {
  notify: "ALL" | "MENTIONS" | "NONE";
  mutedUntil: string | null;
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
  | { type: "conversation.deleted"; conversationId: string }
  | { type: "conversation.read"; conversationId: string }
  | { type: "message.updated"; conversationId: string; messageId: string }
  /** 4. pont B: a `KNOWN` halmaz még nem engedi át; a mobil felület veszi fel. */
  | { type: "assistant.thinking"; conversationId: string; active: boolean };
