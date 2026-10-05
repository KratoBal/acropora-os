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
