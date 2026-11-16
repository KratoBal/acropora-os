import type { RentalSettings } from "@acropora/types";

import { apiRequest } from "./client";

/** Settings > Bérleti szerződés (task eszkozberles, S3): the contract text and the two late-return numbers. */
export const rentalSettingsApi = {
  get(token: string, signal?: AbortSignal) {
    return apiRequest<RentalSettings>("/rental-settings", token, { signal });
  },
  /** The full state on every save: a `null` is a decision ("built-in text", "not set yet"), not an omission. */
  save(
    token: string,
    input: {
      contractTemplate: string | null;
      lateFeeMultiplier: number | null;
      replacementAfterDays: number | null;
    },
  ) {
    return apiRequest<RentalSettings>("/rental-settings", token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  },
};
