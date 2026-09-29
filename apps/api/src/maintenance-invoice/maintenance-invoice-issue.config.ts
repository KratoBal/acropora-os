/**
 * THE SWITCH IN FRONT OF A REAL INVOICE (146ccc61, Balázs's yes 2026-09-29
 * 21:38 UTC, on the condition that it stays OFF until acrobot tells him).
 *
 * Only "true" (any case, surrounding space ignored) turns it on; a missing
 * value, "false", "1" or anything else leaves it off. Off, the issue request
 * is refused BEFORE any Számlázz.hu call, and the panel shows the button
 * disabled.
 */
export function maintenanceInvoiceIssueEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment.MAINTENANCE_INVOICE_ISSUE_ENABLED?.trim().toLowerCase() ===
    "true"
  );
}
