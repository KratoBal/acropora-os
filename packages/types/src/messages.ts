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
  /**
   * `"assistant"`: Sutyerák (4. pont B; a kliens a figurát teszi ki és a lista
   * elejére állítja). Hiányzik vagy `"user"`: ember. Opcionális, a régi kliens miatt.
   */
  kind?: "user" | "assistant";
}

/** Sutyerák rendszer-felhasználójának azonosítója (a migráció hozza létre). */
export const SUTYERAK_USER_ID = "system-sutyerak";

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
  /** KITŰZÖTT-E (3. fázis). A régebbi kliensek tesztjei miatt opcionális. */
  pinned?: boolean;
  /**
   * SUTYERÁK ÜZENETÉN (4. pont B): `viaAcrobot` igaz, ha a választ acrobot írta
   * vissza egy átadott kérdésre („Sutyerák, Acrobot válaszával”). Másnál
   * hiányzik vagy `null`. A szöveg Markdown, mint a widgetben.
   */
  assistant?: { viaAcrobot: boolean } | null;
  /**
   * TOVÁBBÍTOTT ÜZENET (3. fázis): az eredeti szerző neve, Balázs döntése
   * szerint látszik („Továbbítva · Kovács Anna”). Nem továbbítottnál `null`.
   */
  forwardedFrom?: { senderName: string } | null;
}

/**
 * MIHEZ KÖTHETŐ EGY BESZÉLGETÉS (4. fázis, prompt 23. pont; Balázs, 2026-10-05:
 * munkalaphoz ÉS hibajegyhez).
 */
export const CONVERSATION_CONTEXT_TYPES = ["WORKSHEET", "SERVICE_JOB"] as const;
export type ConversationContextType =
  (typeof CONVERSATION_CONTEXT_TYPES)[number];

/**
 * A KAPCSOLT OBJEKTUM KÁRTYÁJA (Figma 450:323, 450:697). Aki a beszélgetés
 * tagja, de a szervizt nem látja, annak `restricted`: csak a típus és a szám
 * megy ki, a partner és az állapot nem, és a kliens nem ad „Megnyitás”-t.
 */
export interface ConversationContextCard {
  type: ConversationContextType;
  id: string;
  /** A munkalap száma (`BIO-2026-001`) vagy a hibajegyé; szám nélküli munkalapnál null. */
  number: string | null;
  partnerName: string | null;
  /**
   * Munkalapnál a `WorksheetDisplayStatus` értéke, hibajegynél a
   * `ServiceJobStatusValue`; a feliratot a kliens adja.
   */
  status: string | null;
  createdAt: string | null;
  restricted: boolean;
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
  /** 4. fázis: a kötés típusa a listán („Munkalaphoz kapcsolva”); nincs kötés: null. */
  contextType?: ConversationContextType | null;
}

export interface ConversationListResponse {
  items: ConversationListItem[];
}

export interface ConversationDetail extends ConversationListItem {
  description: string | null;
  createdByUserId: string;
  lastReadMessageId: string | null;
  /**
   * A KÉRDEZŐ SAJÁT értesítési beállítása ebben a beszélgetésben (3. fázis).
   * Opcionális, hogy a régebbi kliensek tesztjei ne törjenek el.
   */
  notification?: ConversationNotificationState;
  /** 4. fázis: a kapcsolt munkalap vagy hibajegy kártyája; nincs kötés: null. */
  context?: ConversationContextCard | null;
  /**
   * SUTYERÁK ÉPP VÁLASZOL ebben a beszélgetésben (4. pont B): újratöltés vagy
   * újracsatlakozás után ebből tudja a kliens, mert az `assistant.thinking`
   * eseményt addig nem látta. Az API memóriájából: újraindítás után `false`.
   */
  assistantThinking?: boolean;
}

export interface MessagePage {
  /** Időrendben, a legrégebbitől a legújabbig. */
  items: MessageItem[];
  /** A régebbi oldal kurzora, vagy `null`, ha nincs korábbi üzenet. */
  olderCursor: string | null;
  /**
   * AZ ÚJABB OLDAL KURZORA (3. fázis, „Ugrás”): egy régebbi üzenet köré nyitott
   * oldal után még újabb üzenetek jönnek. A sima, legújabbtól induló oldalon
   * nincs (`undefined`), mert ott nincs újabb.
   */
  newerCursor?: string | null;
}

/** KERESÉS EGY BESZÉLGETÉSEN BELÜL (prompt 13. pont, Figma 453:491, 454:533). */
export const MESSAGE_SEARCH_MIN_LENGTH = 2;
export const MESSAGE_SEARCH_MAX_LENGTH = 100;
export const MESSAGE_SEARCH_LIMIT = 50;
/** A számolás itt megáll („1000+ találat”): egy pontos szám nem ér meg egy teljes átfésülést. */
export const MESSAGE_SEARCH_COUNT_CAP = 1000;

export interface MessageSearchHit {
  messageId: string;
  senderName: string;
  createdAt: string;
  /** A szöveg a találat körül, „…” jellel, ahol vágtunk. */
  snippet: string;
}

export interface MessageSearchResponse {
  total: number;
  /** Igaz, ha a `total` a MESSAGE_SEARCH_COUNT_CAP-nél megállt. */
  totalCapped: boolean;
  items: MessageSearchHit[];
}

/**
 * KITŰZÖTT ELEM (3. fázis, prompt 14. pont, Figma 453:274, 454:636): „Üzenet ·
 * Balázs · tegnap”. A `title` a szöveg eleje, vagy szöveg nélkül a csatolmány
 * neve. Később fájl és link is lehet kitűzött elem, ezért általános alak.
 */
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

/** A BESZÉLGETÉS MEGOSZTOTT MÉDIÁJA ÉS FÁJLJAI (prompt 15. pont, Figma 450:549). */
export interface SharedAttachmentItem extends MessageAttachmentItem {
  messageId: string;
  senderName: string;
  createdAt: string;
}

export interface SharedAttachmentPage {
  items: SharedAttachmentItem[];
  olderCursor: string | null;
}

/**
 * AZ ÉRTESÍTÉSI BEÁLLÍTÁS MÓDJAI (prompt 17. pont, Figma 450:630). A „Csak
 * említések” addig nem választható, amíg nincs említés (3. fázis terve, 2.6).
 */
export const CONVERSATION_NOTIFY_MODES = [
  "ALL",
  "MUTE_1H",
  "MUTE_UNTIL_MORNING",
  "UNMUTE",
] as const;
export type ConversationNotifyMode = (typeof CONVERSATION_NOTIFY_MODES)[number];

export interface ConversationNotificationState {
  notify: "ALL" | "MENTIONS" | "NONE";
  /** ISO idő; `null` vagy múltbeli: nincs némítva. */
  mutedUntil: string | null;
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
  | { type: "message.updated"; conversationId: string; messageId: string }
  /**
   * SUTYERÁK GONDOLKODIK (4. pont B): `true`, amikor az átjáró-hívás indul;
   * `false`, ha véget ért (válasz, hiba, időtúllépés). A régi kliens az ismeretlen
   * típust figyelmen kívül hagyja (murena mérése, web és mobil).
   */
  | { type: "assistant.thinking"; conversationId: string; active: boolean };

/**
 * ACROBOT VÁLASZA A WIDGETBEN (5830ee10): az átadott kérdésre visszaírt válasz,
 * amit a widget a saját beszélgetésének azonosítójával kér le
 * (`GET /assistant/handoff-replies?threadId=`). Az Üzenetekben is megjelenik.
 */
export interface AssistantHandoffReply {
  id: string;
  text: string;
  createdAt: string;
}
