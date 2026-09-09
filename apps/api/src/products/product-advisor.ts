import type { ProductAdvisorKind } from "@acropora/types";

/**
 * The replaceable boundary between a product page and Acropora AI.
 *
 * The first implementation deliberately never invents a recommendation: the
 * customer-facing AI service is not connected yet. Returning the missing-data
 * branch makes the page offer the existing human help route instead.
 */
export interface ProductAdvisor {
  advise(input: ProductAdvisorInput): Promise<ProductAdvisorResult>;
}

export interface ProductAdvisorInput {
  kind: ProductAdvisorKind;
  product: { id: string; name: string; description: string | null };
  aquarium: {
    dimensions: string | null;
    existingLighting: string | null;
    flow: string | null;
  };
}

export type ProductAdvisorResult =
  | { kind: "recommendation"; text: string; riskNotice: string | null }
  | { kind: "missingProductFields"; fields: string[] };

/** Temporary safe adapter until Acropora AI is made customer-facing. */
export class MissingDataProductAdvisor implements ProductAdvisor {
  async advise(_input: ProductAdvisorInput): Promise<ProductAdvisorResult> {
    return { kind: "missingProductFields", fields: [] };
  }
}
