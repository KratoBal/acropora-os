/**
 * Which name a person is shown by, mirrored from
 * `packages/types/src/person-name.ts`.
 *
 * A manual mirror rather than an import: the Expo app's isolated npm
 * dependency boundary deliberately does not pull in the pnpm-managed
 * `@acropora/types` package (see docs/MOBILE-DEVELOPMENT.md). The rule is
 * small and the tests here pin it, so the two copies cannot drift
 * silently.
 */

export interface NamedPerson {
  displayName: string;
  nickname?: string | null;
}

/**
 * The nickname when there is one, the full name otherwise. Whitespace-only
 * counts as none, so a stray space in a form field cannot blank out a
 * person's name on every screen at once.
 *
 * Documents are a different question and do not use this: a worksheet or a
 * signature has to say who somebody officially is.
 */
export function personDisplayName(person: NamedPerson): string {
  const nickname = person.nickname?.trim();
  return nickname ? nickname : person.displayName;
}
