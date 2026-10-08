import { ServiceUnavailableException } from "@nestjs/common";

import {
  AI_CHAT_TIMEOUT_MS,
  aiChatConfig,
} from "../../integrations/ai-chat/ai-chat.config.js";
import type {
  MeasurementRecommendationAiClient,
  MeasurementRecommendationAiRequest,
  MeasurementRecommendationAiResponse,
} from "./measurement-recommendation.contract.js";

/**
 * Az ügynök ajánló végpontjának útja az AI szerveren (a terv 2. lépése, az
 * acropora-ai-agent repóban). Amíg nincs beállítva, a végpont nincs kész, és a
 * kérés ezt mondja ki, nem egy általános hibát.
 */
export const AI_RECOMMENDATION_PATH_ENV = "ACROPORA_AI_RECOMMENDATION_PATH";

/**
 * AZ AI AJÁNLÓ KLIENSE A SZERVERRŐL (kártya 2b3983e1). Ugyanaz az út, mint az
 * „AI teszt” menüé (`integrations/ai-chat`): a tokent csak ez a folyamat
 * tartja, a böngésző az AI-t nem hívja (2026-08-26-i döntés). A tokent és a
 * hívás hibáját soha nem írja ki, mert a hiba magában hordozhatja a kérést.
 */
export class HttpMeasurementRecommendationAiClient implements MeasurementRecommendationAiClient {
  async recommend(
    request: MeasurementRecommendationAiRequest,
  ): Promise<MeasurementRecommendationAiResponse> {
    const config = aiChatConfig();
    const path = process.env[AI_RECOMMENDATION_PATH_ENV]?.trim();
    if (!config || !path)
      throw new ServiceUnavailableException(
        "Az AI ajánló végpontja még nincs kész, ezért most nem kérhető ajánlás.",
      );
    let response: Response;
    try {
      response = await fetch(`${config.baseUrl}/${path.replace(/^\/+/, "")}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(AI_CHAT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        (error as Error)?.name === "TimeoutError"
          ? "Az AI nem válaszolt időben. Próbáld újra."
          : "Az AI nem érhető el. Próbáld újra.",
      );
    }
    const body = (await response.json().catch(() => null)) as {
      text?: unknown;
      model?: unknown;
    } | null;
    if (!response.ok || typeof body?.text !== "string" || !body.text.trim())
      throw new ServiceUnavailableException(
        `Az AI nem adott használható ajánlást (HTTP ${response.status}).`,
      );
    return {
      text: body.text,
      model: typeof body.model === "string" ? body.model : "ismeretlen",
    };
  }
}
