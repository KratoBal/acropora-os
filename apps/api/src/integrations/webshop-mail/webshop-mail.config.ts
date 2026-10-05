/**
 * The one service-token record the webshop's render calls may use.
 *
 * A separate mechanism, as `AiUserContextGuard` asks of every new caller: a
 * token that renders the shop's mails opens no other door, and no other
 * token opens this one. Unset means "accept nothing", never "accept
 * anything".
 */
export const WEBSHOP_MAIL_TOKEN_ID_ENV = "ACROPORA_WEBSHOP_MAIL_TOKEN_ID";

/**
 * Injection token for the environment the guard reads. `NodeJS.ProcessEnv`
 * erases to `Object`, which Nest cannot resolve (see
 * `AI_PRODUCT_SEARCH_ENVIRONMENT`).
 */
export const WEBSHOP_MAIL_ENVIRONMENT = Symbol("WEBSHOP_MAIL_ENVIRONMENT");

/** The version of the facts contract this endpoint reads (commerce `facts.ts`). */
export const WEBSHOP_MAIL_FACTS_VERSION = 1;

export function webshopMailTokenId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment[WEBSHOP_MAIL_TOKEN_ID_ENV]?.trim();
  return value ? value : null;
}
