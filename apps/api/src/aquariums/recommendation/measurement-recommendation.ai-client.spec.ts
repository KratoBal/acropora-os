import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  AI_CHAT_BASE_URL_ENV,
  AI_CHAT_TOKEN_ENV,
} from "../../integrations/ai-chat/ai-chat.config.js";
import {
  AI_RECOMMENDATION_PATH_ENV,
  HttpMeasurementRecommendationAiClient,
} from "./measurement-recommendation.ai-client.js";
import type { MeasurementRecommendationAiRequest } from "./measurement-recommendation.contract.js";

/**
 * A NEM MEGERŐSÍTETT JELÖLT JELZÉSE A KIMENŐ TÖRZSBEN (t5-5, acropora-ai-agent
 * #35). Az AI szerver ebből a mezőből tudja, melyik jelöltről fogalmazzon
 * óvatosan; ha a kliens valaha mezőnként másolná a jelöltet, a jelzés csendben
 * elveszne, és a modell újra magabiztosan írna. MI PIROSÍTJA: a jelzés hiányzik
 * a kimenő JSON-ból, vagy a megerősített jelölt is kap ilyet.
 */
const kulcsok = [
  AI_CHAT_BASE_URL_ENV,
  AI_CHAT_TOKEN_ENV,
  AI_RECOMMENDATION_PATH_ENV,
] as const;
const eredeti = Object.fromEntries(kulcsok.map((k) => [k, process.env[k]]));
const eredetiFetch = globalThis.fetch;

afterEach(() => {
  for (const k of kulcsok)
    if (eredeti[k] === undefined) delete process.env[k];
    else process.env[k] = eredeti[k];
  globalThis.fetch = eredetiFetch;
});

describe("az AI ajánló kliense", () => {
  it("RECO-WIRE-UNVERIFIED: a nem megerősített jelölt jelzéssel megy ki, a megerősített anélkül", async () => {
    process.env[AI_CHAT_BASE_URL_ENV] = "http://ai.example.invalid";
    process.env[AI_CHAT_TOKEN_ENV] = "kitalalt-token";
    process.env[AI_RECOMMENDATION_PATH_ENV] = "/v1/measurement-recommendations";
    const torzsek: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      torzsek.push(String(init?.body));
      return new Response(JSON.stringify({ text: "Vázlat.", model: "m" }), {
        status: 200,
      });
    }) as typeof fetch;

    const keres: MeasurementRecommendationAiRequest = {
      waterType: null,
      volumeLiters: null,
      deviations: [],
      examples: [],
      candidates: [
        {
          productId: "p-sajat",
          name: "Saját adatos",
          category: "Termékek",
          effects: [{ parameterCode: "KH", direction: "EMEL" }],
          basis: "JEV",
          unverified: true,
        },
        {
          productId: "p-gyartoi",
          name: "Gyártói",
          category: "Termékek",
          effects: [{ parameterCode: "KH", direction: "EMEL" }],
          basis: "JEV",
          evidenceRef: "https://gyarto.example.invalid/kh",
        },
      ],
    };
    await new HttpMeasurementRecommendationAiClient().recommend(keres);

    const kiment = JSON.parse(torzsek[0]!) as {
      candidates: Record<string, unknown>[];
    };
    assert.deepEqual(
      kiment.candidates.map((c) => [c.productId, c.unverified]),
      [
        ["p-sajat", true],
        ["p-gyartoi", undefined],
      ],
    );
  });
});
