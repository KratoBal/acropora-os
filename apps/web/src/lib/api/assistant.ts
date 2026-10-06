import type { AssistantHandoffReply } from "@acropora/types";
import { API_PREFIX } from "./api-prefix";
import { apiAuthHeaders, apiRequest, ApiError } from "./client";
export type AssistantEvent =
  | { type: "thread"; threadId: string; new: boolean }
  | { type: "text"; delta: string }
  | { type: "done"; answer: string; durationMs: number; toolCalls: number }
  | { type: "error"; message: string };
export interface AssistantQuestion {
  question: string;
  threadId?: string;
  context: { page: string; entity?: string };
}
export const assistantApi = {
  config(token: string, signal: AbortSignal) {
    return apiRequest<{ enabled: boolean }>("/assistant/config", token, {
      signal,
      cache: "no-store",
    });
  },
  /**
   * ACROBOT VÁLASZAI EGY ÁTADOTT KÉRDÉSRE, ennek a beszélgetésnek az
   * azonosítójával (5830ee10). Csak a hívó saját válaszai jönnek.
   */
  handoffReplies(token: string, threadId: string, signal: AbortSignal) {
    return apiRequest<{ items: AssistantHandoffReply[] }>(
      `/assistant/handoff-replies?threadId=${encodeURIComponent(threadId)}`,
      token,
      { signal, cache: "no-store" },
    );
  },
  async ask(
    token: string,
    input: AssistantQuestion,
    onEvent: (event: AssistantEvent) => void,
    signal: AbortSignal,
  ) {
    const response = await fetch(`${API_PREFIX}/assistant/ask`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...apiAuthHeaders(token, "POST"),
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: "A munkamenet lejárt. Jelentkezz be újra.",
        403: "Sutyerák számodra most nem elérhető.",
        409: "Ebben a beszélgetésben még készül egy válasz.",
        429: "Elérted a kérdések korlátját. Próbáld meg később.",
      };
      throw new ApiError(
        messages[response.status] ?? "Sutyerák most nem tud válaszolni.",
        response.status,
      );
    }
    if (!response.body) throw new Error("Sutyerák válasza nem érkezett meg.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let finished = false;
    const line = (text: string) => {
      if (!text.trim()) return;
      const event = JSON.parse(text) as AssistantEvent;
      if (
        !event ||
        !["thread", "text", "done", "error"].includes(event.type) ||
        (event.type === "thread" && typeof event.threadId !== "string") ||
        (event.type === "text" && typeof event.delta !== "string") ||
        (event.type === "done" && typeof event.answer !== "string") ||
        (event.type === "error" && typeof event.message !== "string")
      )
        throw new Error("Sutyerák válasza nem olvasható.");
      if (event.type === "done" || event.type === "error") finished = true;
      onEvent(event);
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        if (pending.length > 512_000)
          throw new Error("Sutyerák válasza túl hosszú.");
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) {
          line(pending.slice(0, end));
          pending = pending.slice(end + 1);
        }
        if (done) break;
      }
      if (pending.trim()) line(pending);
      if (!finished)
        throw new Error("Sutyerák válasza megszakadt. Próbáld meg újra.");
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  },
};
