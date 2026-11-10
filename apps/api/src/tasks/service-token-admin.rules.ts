import type { UserRole } from "@acropora/types";

/**
 * WHICH ACCOUNT A SERVICE TOKEN MAY ACT AS (card c5a8e6d6).
 *
 * Pure function, no database. A token acts with its account's rights, so the account decides how much a leaked token is
 * worth. Two refusals, both named in the answer:
 *
 * - an account nobody can sign in with (`isActive` false) is not a home for a live key;
 * - a HUMAN role is refused, and so is the assistant's system account: the tokens are the agents' keys, and a key bound to
 *   a colleague's account would carry that colleague's rights (a stricter rule than the command line's, which binds to any
 *   email; the stricter one is the web's, because this endpoint is reachable from a browser session).
 */
export const BINDABLE_ROLES = [
  "CONTENT_AGENT",
  "ASSET_IMPORT_AGENT",
] as const satisfies readonly UserRole[];

export interface BindingCandidate {
  isActive: boolean;
  role: UserRole;
}

/** `null` means the account may carry the token; otherwise the reason (Hungarian: it reaches the screen). */
export function bindingRefusal(user: BindingCandidate | null): string | null {
  if (user === null) return "Nincs ilyen e-mail című felhasználó.";
  if (!user.isActive) return "A felhasználó inaktív: nem köthető hozzá token.";
  if (!(BINDABLE_ROLES as readonly UserRole[]).includes(user.role))
    return "Csak gépi szerepű felhasználóhoz (CONTENT_AGENT, ASSET_IMPORT_AGENT) köthető token: emberi fiók jogaival nem jöhet létre kulcs.";
  return null;
}
