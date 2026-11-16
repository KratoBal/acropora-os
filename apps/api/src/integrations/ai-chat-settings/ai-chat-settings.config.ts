/**
 * The one service-token record the AI service may use to READ the chat settings.
 *
 * A separate mechanism, as `AiUserContextGuard` asks of every new caller (and plan section 3/b of card f5b8f7ba): the token that
 * reads the settings opens no other door, and no other token (product search, customer context, the webshop's mail render) opens
 * this one. The WRITE side of the contact requests (slice 4c) gets its OWN record and its own variable, so a token that reads
 * never writes. Unset means "accept nothing", never "accept anything".
 */
export const AI_CHAT_SETTINGS_TOKEN_ID_ENV =
  "ACROPORA_AI_CHAT_SETTINGS_TOKEN_ID";

/** Injection token for the environment the guard reads (see `WEBSHOP_MAIL_ENVIRONMENT`). */
export const AI_CHAT_SETTINGS_ENVIRONMENT = Symbol(
  "AI_CHAT_SETTINGS_ENVIRONMENT",
);

export function aiChatSettingsTokenId(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = environment[AI_CHAT_SETTINGS_TOKEN_ID_ENV]?.trim();
  return value ? value : null;
}
