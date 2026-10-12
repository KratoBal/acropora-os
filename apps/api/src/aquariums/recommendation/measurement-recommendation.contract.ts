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
 * - a jelöltek forrása: a JEV VERIFIED `waterParameterEffects` értékei
 *   (`JevRecommendationCandidateSource`, 2026-10-12); az üres forrás alább a
 *   tesztekhez és a kikapcsolt állapothoz marad.
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
 * ÜRES JELÖLTFORRÁS: az ajánlás termék nélkül készül. 2026-10-12-ig ez volt
 * a modulban; azóta a `JevRecommendationCandidateSource` adja a jelölteket.
 */
export class EmptyRecommendationCandidateSource implements RecommendationCandidateSource {
  async candidates(): Promise<MeasurementRecommendationCandidate[]> {
    return [];
  }
}
