/**
 * AZ ÜZENETEK MODUL VÁLASZ-ALAKJAI (1. fázis, kártya 51d7aba0). Az API, a web és
 * a mobil ugyanezeket olvassa.
 */

import type { UserRole } from "./auth.js";

export type ConversationTypeValue = "DIRECT" | "GROUP";
export type ConversationAudienceValue = "INTERNAL" | "PARTNER";
export type MessageTypeValue = "TEXT" | "IMAGE" | "FILE" | "SYSTEM";

/** Egy üzenet leghosszabb szövege, karakterben. */
export const MESSAGE_TEXT_MAX_LENGTH = 4000;
/** Egy csoport legfeljebb ennyi tagot kaphat egyszerre (a létrehozóval együtt). */
export const CONVERSATION_MAX_MEMBERS = 50;
/** Egy üzenet-oldal alapértelmezett és legnagyobb mérete. */
export const MESSAGE_PAGE_DEFAULT = 50;
export const MESSAGE_PAGE_MAX = 100;

export interface ConversationPerson {
  userId: string;
  /** A becenév, ha van, különben a teljes név (`personDisplayName`). */
  name: string;
  avatarUrl: string | null;
  /** A szerepköre: a felület címkét ír belőle (a Figma kollégaválasztója). */
  role: UserRole;
  /** Deaktivált kolléga: a régi beszélgetésben marad, újat nem lehet vele indítani. */
  isActive: boolean;
}

/** A négy reakció, amit az első kör támogat (a prompt 11. pontja). */
export const MESSAGE_REACTIONS = ["👍", "❤️", "✅", "👀"] as const;
export type MessageReactionValue = (typeof MESSAGE_REACTIONS)[number];

/** Legfeljebb ennyi csatolmány mehet egy üzenettel (a feltöltés közös keretével azonos). */
export const MESSAGE_ATTACHMENTS_MAX = 10;

export type MessageAttachmentKindValue = "IMAGE" | "FILE";

/** Egy csatolmány: a bájtok a `GET /messages/attachments/:id` mögött, tagság-ellenőrzéssel. */
export interface MessageAttachmentItem {
  id: string;
  kind: MessageAttachmentKindValue;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** Képnél van bélyegkép (`?variant=thumbnail`). */
  hasThumbnail: boolean;
}

/** Egy reakció összesítve: hányan adták, és a kérdező köztük van-e. */
export interface MessageReactionSummary {
  reaction: MessageReactionValue;
  count: number;
  mine: boolean;
}

/** A válasz előnézete: kinek válaszol és mire. Törölt eredetinél a szöveg `null`. */
export interface MessageReplyPreview {
  id: string;
  senderName: string;
  text: string | null;
  deleted: boolean;
  /** Ha az eredeti szöveg nélküli csatolmány volt. */
  attachmentKind: MessageAttachmentKindValue | null;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  type: MessageTypeValue;
  /** Törölt üzenetnél `null`: a szöveg az adatbázisban marad, de senki nem látja. */
  text: string | null;
  deleted: boolean;
  createdAt: string;
  editedAt: string | null;
  replyToMessageId: string | null;
  /** A 2. fázis óta: az eredeti üzenet előnézete, ha ez válasz. */
  replyTo: MessageReplyPreview | null;
  /** Törölt üzenetnél üres: a bájtokat sem szolgáljuk ki. */
  attachments: MessageAttachmentItem[];
  reactions: MessageReactionSummary[];
  /** Csak a saját üzenetnél: ezzel ismeri fel a kliens a függő példányát. */
  clientMessageId: string | null;
}

export interface ConversationListItem {
  id: string;
  type: ConversationTypeValue;
  audience: ConversationAudienceValue;
  /** Csoportnál a megadott név; DIRECT-nél `null` (a kliens a másik tag nevét írja ki). */
  title: string | null;
  /** A többi tag, a kérdező nélkül. */
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
  /** Időrendben, a legrégebbitől a legújabbig. */
  items: MessageItem[];
  /** A régebbi oldal kurzora, vagy `null`, ha nincs korábbi üzenet. */
  olderCursor: string | null;
}

export interface MessagesUnreadResponse {
  /** Az olvasatlan üzenetek száma összesen. */
  total: number;
  /** Hány beszélgetésben van olvasatlan. */
  conversations: number;
}

export interface MessagePeopleResponse {
  items: ConversationPerson[];
}

/** Az SSE-folyam eseményei. Csak azonosítót visznek, a tartalmat a kliens REST-en olvassa. */
export type MessageStreamEvent =
  | { type: "message.created"; conversationId: string; messageId: string }
  | { type: "conversation.created"; conversationId: string }
  | { type: "conversation.read"; conversationId: string }
  /** Szerkesztés, törlés vagy reakció: a kliens azt az egy üzenetet olvassa újra. */
  | { type: "message.updated"; conversationId: string; messageId: string };
