import {
  MESSAGE_TEXT_MAX_LENGTH,
  type PartnerConversationMessage,
} from "@acropora/types";

/**
 * A HIBAJEGY BESZÉLGETÉSE A PORTÁLON (kártya 084e2c24) -- a felület tiszta
 * része, renderelés nélkül mérhetően (lásd `tsconfig.test.json`).
 *
 * A szerver csak a partneres beszélgetést adja ki (a belsőt soha), és csak
 * szöveget; ez a fájl a megjelenítést és az újraküldést rendezi.
 */

/** Ennyi időnként néz rá a lap új üzenetre, amíg a fül látható. */
export const CONVERSATION_REFRESH_MS = 30_000;

/**
 * A MEGLÉVŐ ÉS AZ ÚJ LAP EGYESÍTÉSE: azonosító szerint egyszer, időrendben.
 * A frissítés és a régebbi lap ugyanazt az üzenetet is hozhatja, és egy
 * elküldött üzenet a szerver válaszából és a következő frissítésből is
 * megérkezik -- kétszer egyik sem jelenhet meg. Az újabb példány nyer (egy
 * szerkesztett szöveg így frissül).
 */
export function mergeConversation(
  current: readonly PartnerConversationMessage[],
  incoming: readonly PartnerConversationMessage[],
): PartnerConversationMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * A küldhető szöveg: a szóközök nélkül nem üres, és belefér a korlátba. A
 * szerver ugyanezt nézi; itt azért, hogy egy biztos elutasításra ne menjen
 * hálózati kör.
 */
export function sendableText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MESSAGE_TEXT_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * AZ ÚJRAKÜLDÉS AZONOSÍTÓJA. Egy üzenethez EGY marad, amíg el nem ment: ha a
 * válasz elveszett, a második kattintás ugyanazzal megy, és a szerver a már
 * meglévő üzenetet adja vissza, nem hoz létre másodikat.
 */
export function newClientMessageId(): string {
  return `portal-${crypto.randomUUID()}`;
}

/** A szerző sora: a saját üzenet „Ön”, a mienk mellett az Acropora neve is. */
export function authorLine(message: PartnerConversationMessage): string {
  if (message.mine) return "Ön";
  return message.side === "ACROPORA"
    ? `${message.authorName} · Acropora`
    : message.authorName;
}
