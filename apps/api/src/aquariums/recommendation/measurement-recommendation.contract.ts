import type {
  AquariumMeasurementParameterCode,
  MeasurementRecommendationCandidate,
  WaterType,
} from "@acropora/types";

/**
 * A VÍZMÉRÉSI AJÁNLÁS SZERZŐDÉSEI (kártya 2b3983e1, terv:
 * `exchange/vizmeres-ajanlas/vizmeres-ajanlas-os-terv-2026-10-09.md`).
 *
 * Két cserélhető rész áll itt, mert egyik sem az OS-é:
 * - az AI ügynök végpontja (a terv 2. lépése, acropora-ai-agent): a kérés és a
 *   válasz alakja, és egy kliens, amit a teszt mockkal vált ki;
 * - a jelöltek forrása: ma üres (a kategória-szabály nautilus 2. JEV-PR-jában
 *   jön, acrobot 28467), később a JEV VERIFIED értékei (nautilus 28462).
 */

/** Egy eltérő mért érték, ahogy a PDF is jelzi (`measurement-report.ts`). */
export interface RecommendationDeviation {
  parameterCode: AquariumMeasurementParameterCode;
  measured: number;
  unit: string;
  min?: number;
  max?: number;
  status: "WARN" | "ALERT";
  direction: "LOW" | "HIGH";
  trend: "IMPROVING" | "WORSENING" | "STABLE" | null;
}

/** A kérés bemenete, amit az ajánlás eltárol (`input`). Személyes adat nincs benne. */
export interface RecommendationInput {
  waterType: WaterType | null;
  volumeLiters: number | null;
  deviations: RecommendationDeviation[];
}

/** Egy korábbi, jóváhagyott pár: mit írt az AI, és mire javítottuk. */
export interface RecommendationExample {
  deviations: RecommendationDeviation[];
  aiDraft: string;
  approvedText: string;
}

export interface MeasurementRecommendationAiRequest extends RecommendationInput {
  /** Az AI CSAK ezekre hivatkozhat, `{{termek:<productId>}}` alakban. */
  candidates: MeasurementRecommendationCandidate[];
  examples: RecommendationExample[];
}

export interface MeasurementRecommendationAiResponse {
  text: string;
  model: string;
}

export interface MeasurementRecommendationAiClient {
  recommend(
    request: MeasurementRecommendationAiRequest,
  ): Promise<MeasurementRecommendationAiResponse>;
}

export const MEASUREMENT_RECOMMENDATION_AI_CLIENT = Symbol(
  "MEASUREMENT_RECOMMENDATION_AI_CLIENT",
);

export interface RecommendationCandidateSource {
  candidates(input: {
    waterType: WaterType | null;
    deviations: readonly RecommendationDeviation[];
  }): Promise<MeasurementRecommendationCandidate[]>;
}

export const RECOMMENDATION_CANDIDATE_SOURCE = Symbol(
  "RECOMMENDATION_CANDIDATE_SOURCE",
);

/**
 * A JELÖLTEK FORRÁSA, AMÍG A SZABÁLY NINCS BENT: üres lista (acrobot 28467).
 * A kategória-szabály (`WATER_EFFECT_CATEGORY_RULES`) nautilus 2. JEV-PR-jában
 * jön; addig az ajánlás termék nélkül készül, és ez ugyanezen az interfészen
 * cserélődik.
 */
export class EmptyRecommendationCandidateSource implements RecommendationCandidateSource {
  async candidates(): Promise<MeasurementRecommendationCandidate[]> {
    return [];
  }
}
