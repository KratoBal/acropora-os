/**
 * AZ OLVASATLAN ÜZENETEK JELVÉNYE (Balázs, 2026-10-05 17:14 UTC: „lesz badge az
 * üzenetek ikonjával mobilon … ami számmal mutatja az új üzeneteket?”). A szám
 * a szerver `GET /messages/unread` válaszának `total`-ja: a némított
 * beszélgetés olvasatlanja is benne van, ahogy a weben is.
 */

/** A felirat a navigáció ikonján: nulla esetén nincs jelvény, 99 fölött „99+”. */
export function unreadBadgeLabel(
  total: number | null | undefined,
): string | null {
  if (!total || total <= 0 || !Number.isFinite(total)) return null;
  return total > 99 ? "99+" : String(Math.floor(total));
}

/**
 * AZ APP IKONJÁNAK SZÁMA. Kijelentkezve mindig nulla: egy idegen kezében lévő
 * telefon ne mutassa, hány üzenete van annak, aki kilépett.
 */
export function appIconBadgeCount(
  total: number | null | undefined,
  authenticated: boolean,
): number {
  if (!authenticated || !total || !Number.isFinite(total)) return 0;
  return Math.max(0, Math.floor(total));
}

/** Melyik élő esemény után kell újrakérni a számot. */
export function refreshesUnread(signal: { type: string }): boolean {
  return (
    signal.type === "message.created" ||
    signal.type === "conversation.read" ||
    signal.type === "conversation.created" ||
    signal.type === "conversation.deleted" ||
    signal.type === "resync"
  );
}
