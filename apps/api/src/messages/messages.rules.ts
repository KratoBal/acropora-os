import {
  MESSAGE_TEXT_MAX_LENGTH,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type UserRole,
} from "@acropora/types";

/**
 * AZ ÜZENETEK MODUL TISZTA SZABÁLYAI (kártya 51d7aba0). Adatbázis nélkül
 * mérhetők, és a szolgáltatás ezekből dönt.
 */

/**
 * KÉT EMBER KÖZÖTT EGY DIRECT BESZÉLGETÉS. A kulcs a két azonosító rendezve, így
 * a sorrend nem számít; az egyediség az adatbázisban áll (`Conversation.directKey`).
 */
export function directKeyOf(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export interface MessagingCandidate {
  role: UserRole;
  isActive: boolean;
  customerId: string | null;
  supplierId: string | null;
}

/**
 * LEHET-E TAGJA EGY BELSŐ (`INTERNAL`) BESZÉLGETÉSNEK.
 *
 * Három feltétel, és mind a három kell:
 *   - aktív fiók (deaktivált kollégával új beszélgetés nem indul, és nem vehető fel);
 *   - a szerepköre megkapja a `messages.use` jogot (gépi ágens és partnerfiók nem);
 *   - nincs partnerhez kötve (`customerId`, `supplierId`).
 *
 * A harmadik NEM ismétli a másodikat: egy belső szerepkörű fiók is kaphat
 * partner-kötést, és akkor a partner nevében lép be. Egy belső beszélgetés
 * szövege neki sem látszhat (acrobot 26171, 38/9).
 */
export function mayJoinInternal(user: MessagingCandidate): boolean {
  return (
    user.isActive &&
    user.customerId === null &&
    user.supplierId === null &&
    ROLE_PERMISSIONS[user.role].includes(PERMISSIONS.MESSAGES_USE)
  );
}

/** A küldendő szöveg: levágott szélekkel; üresen `null`. A hossz-korlátot a DTO tartja. */
export function cleanMessageText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export { MESSAGE_TEXT_MAX_LENGTH };

/**
 * A KURZOR: egy üzenet `(createdAt, id)` párja, átlátszatlan szövegként. A
 * rendezés is erre a párra megy, tehát két azonos pillanatban keletkezett üzenet
 * sem ismétlődik és nem marad ki a lapozásnál.
 */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString(
    "base64url",
  );
}

export function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const bar = raw.indexOf("|");
  if (bar <= 0) return null;
  const createdAt = new Date(raw.slice(0, bar));
  const id = raw.slice(bar + 1);
  return Number.isNaN(createdAt.getTime()) || !id ? null : { createdAt, id };
}

const PUSH_BODY_MAX = 140;

/**
 * A PUSH SZÖVEGE. DIRECT-nél a küldő neve a cím és az üzenet a törzs (a prompt
 * 20. pontjának példája); csoportnál a csoport neve a cím, és a törzs elé kerül
 * a küldő neve.
 */
export function messagePushText(input: {
  conversationTitle: string | null;
  senderName: string;
  text: string;
}): { title: string; body: string } {
  const text =
    input.text.length > PUSH_BODY_MAX
      ? `${input.text.slice(0, PUSH_BODY_MAX - 1)}…`
      : input.text;
  return input.conversationTitle
    ? { title: input.conversationTitle, body: `${input.senderName}: ${text}` }
    : { title: input.senderName, body: text };
}

/**
 * KI KAP PUSHT egy új üzenetről: a beszélgetés aktív tagjai, a küldőn kívül,
 * és aki nincs elnémítva. A beállítás felülete a 3. fázisban jön, az oszlop és a
 * szabály már most él.
 */
export function pushRecipients(input: {
  senderUserId: string;
  now: Date;
  members: readonly {
    userId: string;
    leftAt: Date | null;
    notify: "ALL" | "MENTIONS" | "NONE";
    mutedUntil: Date | null;
  }[];
}): string[] {
  return input.members
    .filter(
      (m) =>
        m.userId !== input.senderUserId &&
        m.leftAt === null &&
        m.notify === "ALL" &&
        !(m.mutedUntil && m.mutedUntil > input.now),
    )
    .map((m) => m.userId);
}

/** A szöveg nélküli csatolmány előnézete (a prompt 20. pontja): a listában és a pushban. */
export function attachmentPreview(kind: "IMAGE" | "FILE"): string {
  return kind === "IMAGE" ? "📷 Képet küldött" : "📎 Fájlt küldött";
}

/** Az üzenet típusa a csatolmányokból: kép, ha mind kép; fájl, ha bármelyik nem az. */
export function messageTypeFor(
  kinds: readonly ("IMAGE" | "FILE")[],
): "TEXT" | "IMAGE" | "FILE" {
  if (kinds.length === 0) return "TEXT";
  return kinds.every((kind) => kind === "IMAGE") ? "IMAGE" : "FILE";
}

/** A gazdátlan feltöltés ennyi idő után törölhető (acrobot 26242, emlék 2076). */
export const ORPHAN_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

/** A bélyegkép dokumentum-azonosítója a tárolóban, az eredeti mellett. */
export const thumbnailDocumentId = (attachmentId: string) =>
  `${attachmentId}-thumb`;
