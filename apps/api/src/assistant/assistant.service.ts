import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthenticatedUser, Session } from "@acropora/types";
import { AuthService } from "../auth/auth.service.js";
import { partnerScopeOf } from "../auth/partner-scope.util.js";
import {
  SessionRepository,
  type SessionKind,
} from "../auth/session.repository.js";
import { AssistantBudgetRepository } from "./assistant-budget.repository.js";
import type { AssistantAskDto } from "./assistant.dto.js";

export const ASSISTANT_GATEWAY_TIMEOUT_MS = 120_000;
export const ASSISTANT_ERROR =
  "Sutyerák most nem tud válaszolni. Próbáld meg később.";
@Injectable()
export class AssistantService {
  private readonly tokens = new Map<string, Session>();
  private readonly issuance = new Map<string, Promise<Session>>();
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionRepository,
    private readonly budget: AssistantBudgetRepository,
  ) {}
  available(user: AuthenticatedUser, kind: SessionKind | undefined): boolean {
    return kind === "USER" && this.availableTo(user);
  }
  /**
   * A DOLGOZÓ HASZNÁLHATJA-E SUTYERÁKOT, a munkamenet fajtájától függetlenül:
   * belső dolgozó, bekapcsolt kapcsoló, a próba-listán. Az Üzenetek ezt nézik
   * (4. pont B): ott az üzenetet a dolgozó saját munkamenete már elküldte.
   */
  availableTo(user: AuthenticatedUser): boolean {
    return (
      partnerScopeOf(user).kind === "internal" &&
      ["true", "1"].includes(process.env.SUTYERAK_ENABLED ?? "") &&
      (process.env.SUTYERAK_PILOT_USER_IDS ?? "")
        .split(",")
        .map((id) => id.trim())
        .includes(user.id)
    );
  }
  async ask(
    user: AuthenticatedUser,
    kind: SessionKind | undefined,
    input: AssistantAskDto,
    signal: AbortSignal,
  ): Promise<Response> {
    if (!this.available(user, kind))
      throw new ForbiddenException("Sutyerák számodra jelenleg nem elérhető.");
    return this.forward(user, input, signal);
  }
  /**
   * AZ ÜZENETEKBŐL (4. pont B): ugyanaz a továbbítás, a KÉRDEZŐ nevében és
   * belépőjével, ugyanazzal a költségkerettel, mint a `/assistant/ask`.
   */
  async askOnBehalf(
    user: AuthenticatedUser,
    input: {
      question: string;
      threadId?: string;
      context: Record<string, string>;
    },
    signal: AbortSignal,
  ): Promise<Response> {
    if (!this.availableTo(user))
      throw new ForbiddenException("Sutyerák számodra jelenleg nem elérhető.");
    return this.forward(user, input, signal);
  }
  private async forward(
    user: AuthenticatedUser,
    input: {
      question: string;
      threadId?: string;
      context: Record<string, string | undefined> | AssistantAskDto["context"];
    },
    signal: AbortSignal,
  ): Promise<Response> {
    await this.budget.consume(user.id);
    const session = await this.tokenFor(user);
    const url = process.env.SUTYERAK_GATEWAY_URL?.trim();
    const secret = process.env.SUTYERAK_GATEWAY_SECRET?.trim();
    if (!url || !secret) throw new Error("Sutyerák gateway is not configured");
    return fetch(`${url.replace(/\/$/, "")}/ask`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify({
        token: session.token,
        user: { id: user.id, name: user.displayName },
        question: input.question,
        ...(input.threadId ? { threadId: input.threadId } : {}),
        context: input.context,
      }),
    });
  }
  private async tokenFor(user: AuthenticatedUser): Promise<Session> {
    // Bound retention to live entries; raw tokens never leave this API process except to the gateway.
    for (const [id, token] of this.tokens)
      if (Date.parse(token.expiresAt) <= Date.now()) this.tokens.delete(id);
    const cached = this.tokens.get(user.id);
    if (
      cached &&
      Date.parse(cached.expiresAt) - Date.now() > 60_000 &&
      cached.token
    ) {
      const stored = await this.sessions.findAssistant(cached.token);
      if (stored && stored.expiresAt.getTime() - Date.now() > 60_000)
        return cached;
    }
    const existing = this.issuance.get(user.id);
    if (existing) return existing;
    const promise = this.auth
      .issueAssistantSession(user, "USER")
      .then((session) => {
        this.tokens.set(user.id, session);
        return session;
      })
      .finally(() => this.issuance.delete(user.id));
    this.issuance.set(user.id, promise);
    return promise;
  }
}
