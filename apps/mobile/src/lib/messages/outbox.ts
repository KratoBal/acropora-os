/**
 * A KÜLDÉSI SOR ÉS A CÍMKÉK A TELEFONON: ugyanazok a szabályok, mint a weben
 * (`apps/web/src/components/messages/outbox.ts`). Másolat, mert az Expo app nem
 * húzza be a web kódját; a két oldal speceje ugyanazokat az eseteket méri.
 */
import type { MessageItem } from "./types";

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
