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
