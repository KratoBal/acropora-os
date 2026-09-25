/**
 * Which name a person is shown by.
 *
 * A colleague can have a nickname - what the team actually calls them -
 * and the interfaces show that instead of the full name. The full name
 * does not go away: it stays on documents, where a worksheet or a
 * signature has to say who someone officially is.
 *
 * This lives in one place on purpose. The same fallback repeated at every
 * call site is the kind of thing that gets missed in one of them, and the
 * one that gets missed is an empty name on a screen - visible only once
 * somebody actually fills a nickname in, which is to say in production.
 */

export interface NamedPerson {
  displayName: string;
  nickname?: string | null;
}

/**
 * The name for interfaces: the nickname when there is one, the full name
 * otherwise. Whitespace-only counts as none, because a stray space in a
 * form field must not blank out a person's name.
 */
export function personDisplayName(person: NamedPerson): string {
  const nickname = person.nickname?.trim();
  return nickname ? nickname : person.displayName;
}

/**
 * The name for documents and signatures: always the full one, never the
 * nickname. Separate from `personDisplayName` so that the choice is
 * explicit at the call site rather than accidental.
 */
export function personLegalName(person: NamedPerson): string {
  return person.displayName;
}

/**
 * The given name, for a greeting ("Jó napot, Béla!").
 *
 * NOT `personDisplayName(...).split(" ")[0]` -- that took the WRONG word
 * whenever there is no nickname (2026-09-25 fix, dashboard greeting,
 * `terv-atnezes-web-2026-09-25.md` item 5). `displayName` is built
 * server-side as `${lastName} ${firstName}` (`users.repository.ts`
 * `displayNameOf`), Hungarian order, so the FIRST word is the family name
 * and the SECOND is the given name -- `[0]` greeted people by their
 * surname. A nickname, when set, is already the informal name a person
 * goes by and is used AS-IS, not split: someone whose nickname is a single
 * word must not have it cut to a fragment, and a two-word nickname is the
 * person's own choice of what to be called, not a "LastName FirstName"
 * pair to split.
 */
export function personGivenName(person: NamedPerson): string {
  const nickname = person.nickname?.trim();
  if (nickname) return nickname;
  const parts = person.displayName.trim().split(/\s+/);
  return parts.length > 1 ? parts[1]! : parts[0]!;
}
