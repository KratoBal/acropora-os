/**
 * The one service-token record the AI service may use to WRITE a contact request, and nothing else.
 *
 * Its own record and its own variable (plan section 3/b of card f5b8f7ba): the token that reads the chat settings
 * (`ACROPORA_AI_CHAT_SETTINGS_TOKEN_ID`) never writes, and this one never reads them. No other live token opens this door either
 * (product search, customer context, the webshop's mail render). Unset means "accept nothing", never "accept anything".
 */
export const AI_CONTACT_TOKEN_ID_ENV = "ACROPORA_AI_CONTACT_TOKEN_ID";

/** Injection token for the environment the guard reads (see `AI_CHAT_SETTINGS_ENVIRONMENT`). */
export const AI_CONTACT_ENVIRONMENT = Symbol("AI_CONTACT_ENVIRONMENT");

export function aiContactTokenId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment[AI_CONTACT_TOKEN_ID_ENV]?.trim();
  return value ? value : null;
}
