import { ApiError } from "@/lib/api/client";

/**
 * THE IDEMPOTENCY KEY OF "a maintenance job from the contract" (karbantartási
 * felmérés S4/S7). The same key returns the job the server already made, so a
 * double click or a lost answer does not open a second job.
 */
export function newContractJobOperationId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `web-${random}`;
}

/**
 * KEEP THE KEY OR START A NEW ONE AFTER A FAILED ATTEMPT.
 *
 *     no answer (network)   keep: the job may exist, the retry must find it
 *     5xx                   keep: the server may have stopped half-way, and
 *                           the same key continues that job
 *     4xx                   new key: the request was refused (over the
 *                           occasion limit, cancelled job, wrong items), and
 *                           the old key would only repeat the refusal --
 *                           "Ez a karbantartási lap le van mondva" for good
 */
export function keepsContractJobOperationId(cause: unknown): boolean {
  return !(cause instanceof ApiError && cause.status < 500);
}
