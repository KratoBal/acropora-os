/**
 * Where the internal AI test surface sends its questions.
 *
 * This service is the server-side layer the architecture requires between the
 * browser and the Acropora AI API. The browser talks to the Acropora OS with
 * its own session; only this process holds the AI access token, and it never
 * leaves here - not in a response, not in a log.
 *
 * The target is deliberately the STAGE AI deployment. The internal surface is
 * for measuring answer quality, and no customer meets it; pointing it at a
 * separate production AI would mean running one we do not have.
 */
export const AI_CHAT_BASE_URL_ENV = "ACROPORA_AI_BASE_URL";
export const AI_CHAT_TOKEN_ENV = "ACROPORA_AI_ACCESS_TOKEN";

export interface AiChatConfig {
  baseUrl: string;
  token: string;
}

/**
 * Returns the configuration, or `null` when either half is missing.
 *
 * Both are required together: a base url without a token produces a call the
 * AI refuses with 401, and a token without a url has nowhere to go. `null`
 * means "we cannot ask", which the caller turns into a stated failure rather
 * than an empty chat.
 */
export function aiChatConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AiChatConfig | null {
  const baseUrl = environment[AI_CHAT_BASE_URL_ENV]?.trim();
  const token = environment[AI_CHAT_TOKEN_ENV]?.trim();

  if (!baseUrl || !token) return null;

  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

/**
 * How long this layer waits for the AI service.
 *
 * The agreed ladder loosens outwards: the model call gives up at 40 s inside
 * the AI service, its socket net sits at 45 s, and the Next.js rewrite proxy
 * in front of this API at 50 s. This wait belongs between the AI service and
 * that proxy, so the failure that reaches a person is the AI's own named one -
 * `ai_provider_timeout` with the milliseconds it waited - rather than a silent
 * cut from here.
 */
export const AI_CHAT_TIMEOUT_MS = 47_000;

/**
 * How long this layer waits for a rating to be stored.
 *
 * Deliberately far shorter than the chat wait, because it is a different kind
 * of call: no model is involved, only a row. Inheriting the 47 second wait
 * would mean a person who pressed a button watching a spinner for the better
 * part of a minute before being told the AI is unreachable - a wait sized for
 * something that is not happening here.
 */
export const AI_CHAT_RATING_TIMEOUT_MS = 8_000;

/**
 * Injection tokens for the two things a test needs to vary.
 *
 * Nest resolves constructor parameters by their emitted type, and both
 * `NodeJS.ProcessEnv` and a function type erase to something the container
 * cannot provide. A default parameter value does not save it: the container
 * fails to resolve before it ever reaches the default, and the whole API
 * refuses to boot. This is the same shape that stopped `AiUserContextGuard`
 * booting when it was first written, and `app.bootstrap.spec.ts` caught it
 * both times.
 */
export const AI_CHAT_ENVIRONMENT = Symbol("AI_CHAT_ENVIRONMENT");
export const AI_CHAT_FETCH = Symbol("AI_CHAT_FETCH");
