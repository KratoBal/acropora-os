/**
 * A KÜLDÉSI SOR ÉS A CÍMKÉK A TELEFONON: ugyanazok a szabályok, mint a weben
 * (`apps/web/src/components/messages/outbox.ts`). Másolat, mert az Expo app nem
 * húzza be a web kódját; a két oldal speceje ugyanazokat az eseteket méri.
 */
import type { MessageItem, MessageReplyPreview } from "./types";

/**
 * A KÜLDÉS ÁLLAPOTA A KLIENSEN (a prompt 22. pontja). Egy üzenet addig
 * `pending`, amíg a szerver vissza nem igazolta; ha a hívás elbukik, `failed`,
 * és a felhasználó újrapróbálhatja vagy törölheti. SOHA nem állítjuk elküldöttnek,
 * amit a szerver nem erősített meg.
 *
 * Az újrapróbálás UGYANAZZAL a `clientMessageId`-vel megy, és a szerver arra a
 * meglévő üzenetet adja vissza: egy elveszett válasz utáni újrapróbálás sem
 * hoz létre második üzenetet.
 */
export interface OutgoingMessage {
  clientMessageId: string;
  conversationId: string;
  text: string;
  /** A 2. fázis óta: a kész feltöltések és a válasz célja (az újrapróbálás is ezt viszi). */
  attachmentIds?: string[];
  replyToMessageId?: string;
  status: "pending" | "failed";
  createdAt: string;
}

export type OutboxAction =
  | { type: "queued"; message: OutgoingMessage }
  | { type: "failed"; clientMessageId: string }
  | { type: "retried"; clientMessageId: string }
  | { type: "removed"; clientMessageId: string };

export function outboxReducer(
  state: readonly OutgoingMessage[],
  action: OutboxAction,
): OutgoingMessage[] {
  switch (action.type) {
    case "queued":
      return [...state, action.message];
    case "failed":
    case "retried":
      return state.map((m) =>
        m.clientMessageId === action.clientMessageId
          ? { ...m, status: action.type === "failed" ? "failed" : "pending" }
          : m,
      );
    case "removed":
      return state.filter((m) => m.clientMessageId !== action.clientMessageId);
  }
}

/**
 * A MEGJELENÍTETT SOR: a szerver üzenetei, és utánuk a még meg nem erősített
 * sajátok -- de csak azok, amelyeket a szerver még NEM hozott vissza (a
 * `clientMessageId` szerint). Így egy megerősített üzenet nem látszik kétszer.
 */
export function visibleOutgoing(
  outbox: readonly OutgoingMessage[],
  conversationId: string,
  serverItems: readonly MessageItem[],
): OutgoingMessage[] {
  const confirmed = new Set(
    serverItems.flatMap((m) => (m.clientMessageId ? [m.clientMessageId] : [])),
  );
  return outbox.filter(
    (m) =>
      m.conversationId === conversationId && !confirmed.has(m.clientMessageId),
  );
}

/** Egy új kliens-azonosító. A szerver legalább 8, legfeljebb 64 jelet fogad el. */
export function newClientMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * AZ ÚJ ÜZENET A SZERVER LISTÁJÁBA, azonosító szerint egyszer, időrendben. A
 * folyam és a saját küldés válasza ugyanazt az üzenetet hozhatja kétszer.
 */
export function mergeMessages(
  current: readonly MessageItem[],
  incoming: readonly MessageItem[],
): MessageItem[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt.localeCompare(b.createdAt),
  );
}

// a Figma alakja ("pén."): a hu-HU rövid hétnap-neve más ("P")
const WEEKDAYS = ["vas.", "hét.", "kedd", "sze.", "csüt.", "pén.", "szo."];

/** A Figma időcímkéje a listában: ma óra:perc, tegnap "tegnap", a héten a nap rövid neve, egyébként dátum. */
export function conversationTimeLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const day = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days <= 0)
    return date.toLocaleTimeString("hu-HU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  if (days === 1) return "tegnap";
  if (days < 7) return WEEKDAYS[date.getDay()]!;
  return date.toLocaleDateString("hu-HU", { month: "2-digit", day: "2-digit" });
}

/** A napelválasztó a beszélgetésben: "Ma", "Tegnap", vagy a dátum. */
export function dayDividerLabel(iso: string, now: Date): string {
  const label = conversationTimeLabel(iso, now);
  if (/^\d{2}:\d{2}$/.test(label)) return "Ma";
  if (label === "tegnap") return "Tegnap";
  return new Date(iso).toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * A FELTÖLTÉSI SOR A COMPOSERBEN (a 2. fázis, a prompt 12. pontja): fájlonként
 * haladás, siker, hiba, újrapróbálás és megszakítás. A küldés csak a SIKERES
 * feltöltéseket viszi, és amíg bármelyik még tölt, nem indulhat.
 */
export interface PendingUpload {
  localId: string;
  fileName: string;
  sizeBytes: number;
  percent: number;
  status: "uploading" | "done" | "failed";
  attachmentId: string | null;
  error: string | null;
}

export type UploadAction =
  | {
      type: "added";
      upload: Pick<PendingUpload, "localId" | "fileName" | "sizeBytes">;
    }
  | { type: "progress"; localId: string; percent: number }
  | { type: "done"; localId: string; attachmentId: string }
  | { type: "failed"; localId: string; error: string }
  | { type: "retried"; localId: string }
  | { type: "removed"; localId: string }
  | { type: "cleared" };

export function uploadsReducer(
  state: readonly PendingUpload[],
  action: UploadAction,
): PendingUpload[] {
  const patch = (localId: string, change: Partial<PendingUpload>) =>
    state.map((u) => (u.localId === localId ? { ...u, ...change } : u));
  switch (action.type) {
    case "added":
      return [
        ...state,
        {
          ...action.upload,
          percent: 0,
          status: "uploading",
          attachmentId: null,
          error: null,
        },
      ];
    case "progress":
      return patch(action.localId, { percent: action.percent });
    case "done":
      return patch(action.localId, {
        percent: 100,
        status: "done",
        attachmentId: action.attachmentId,
      });
    case "failed":
      return patch(action.localId, { status: "failed", error: action.error });
    case "retried":
      return patch(action.localId, {
        status: "uploading",
        percent: 0,
        error: null,
      });
    case "removed":
      return state.filter((u) => u.localId !== action.localId);
    case "cleared":
      return [];
  }
}

/** Küldhető-e: van szöveg vagy kész csatolmány, és semmi nem tölt még. */
export function canSend(
  text: string,
  uploads: readonly PendingUpload[],
): boolean {
  if (uploads.some((u) => u.status === "uploading")) return false;
  return Boolean(text.trim()) || uploads.some((u) => u.status === "done");
}

/** A küldéssel menő csatolmány-azonosítók: csak a sikeresek. */
export function readyAttachmentIds(
  uploads: readonly PendingUpload[],
): string[] {
  return uploads.flatMap((u) =>
    u.status === "done" && u.attachmentId ? [u.attachmentId] : [],
  );
}

/** Ember-olvasható fájlméret (a Figma „2,4 MB” alakja). */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * AZ ÜZENET RÖVID SZÖVEGE a listában és a válasz-előnézetben. Egy csak képből
 * álló üzenetnek nincs szövege: üres előnézet helyett a csatolmány fajtája áll.
 */
export function previewText(
  message: Pick<MessageItem, "text" | "deleted" | "attachments">,
): string {
  if (message.deleted) return "Az üzenetet törölték.";
  if (message.text) return message.text;
  const first = message.attachments[0];
  if (!first) return "";
  return first.kind === "IMAGE" ? "📷 Kép" : `📎 ${first.fileName}`;
}

/** A megidézett üzenet sora a buborék tetején. */
export function replyPreviewText(reply: MessageReplyPreview): string {
  if (reply.deleted) return "Az üzenetet törölték.";
  if (reply.text) return reply.text;
  if (reply.attachmentKind === "IMAGE") return "📷 Kép";
  if (reply.attachmentKind === "FILE") return "📎 Fájl";
  return "";
}
