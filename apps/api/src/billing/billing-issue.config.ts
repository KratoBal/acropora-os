/**
 * THE SWITCH IN FRONT OF A REAL BILLING DOCUMENT (Számlázás v0.1), the same
 * shape as the maintenance invoice's (maintenance-invoice-issue.config.ts):
 * only "true" (any case, surrounding space ignored) turns it on; missing,
 * "false", "1" or anything else leaves it off, and the issue request is
 * refused BEFORE any Számlázz.hu call. Off by default everywhere; turning it on
 * is acrobot's step at release, on Balázs's yes.
 */
export function billingIssueEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.BILLING_ISSUE_ENABLED?.trim().toLowerCase() === "true";
}
