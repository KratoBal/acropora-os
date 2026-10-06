import { Injectable } from "@nestjs/common";

/**
 * MELYIK BESZÉLGETÉSBEN VÁLASZOL ÉPP SUTYERÁK (4. pont B). A kliens az
 * `assistant.thinking` eseményből tudja; újratöltés után a beszélgetés
 * részletéből (`assistantThinking`). Memóriában, mert ma egy API-konténer fut:
 * újraindítás után üres, és a félbemaradt válasz `message.created`-je úgysem jön.
 */
@Injectable()
export class AssistantThinkingState {
  private readonly active = new Map<string, number>();

  start(conversationId: string): void {
    this.active.set(conversationId, (this.active.get(conversationId) ?? 0) + 1);
  }

  stop(conversationId: string): void {
    const left = (this.active.get(conversationId) ?? 1) - 1;
    if (left > 0) this.active.set(conversationId, left);
    else this.active.delete(conversationId);
  }

  has(conversationId: string): boolean {
    return this.active.has(conversationId);
  }
}
