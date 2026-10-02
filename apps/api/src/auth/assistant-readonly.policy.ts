/** Audited at main@1f94b836. Conditional writes still require denial. */
export const ASSISTANT_SIDE_EFFECT_GETS = [
  {
    endpoint: "missing-invoices/months",
    reason: "compute → checkPayees → setPayee",
  },
  {
    endpoint: "missing-invoices/months/:month",
    reason: "compute → checkPayees → setPayee",
  },
  {
    endpoint: "missing-invoices/months/:month/missing.xlsx",
    reason: "compute → checkPayees → setPayee",
  },
  {
    endpoint: "missing-invoices/months/:month/accountant-package.pdf",
    reason: "compute → checkPayees → setPayee",
  },
  {
    endpoint: "missing-invoices/items/:id",
    reason: "compute → checkPayees → setPayee",
  },
  {
    endpoint: "missing-invoices/items/:id/jev-suggestion",
    reason: "compute + JEV DecisionRun writes",
  },
  {
    endpoint: "billing/incoming-documents",
    reason: "documentPairings → compute → setPayee",
  },
  {
    endpoint: "billing/incoming-documents/:id",
    reason: "documentPairings → compute → setPayee",
  },
  {
    endpoint: "integrations/nav/invoices/:id",
    reason: "lazy queryInvoiceData → saveParsedData / markError",
  },
  {
    endpoint: "dashboard/widgets",
    reason:
      "missing-invoices loader → months → compute → setPayee (also on cache miss)",
  },
] as const;

/** All authentication/session/password/issuance routes, including public login. */
export const ASSISTANT_FORBIDDEN_PREFIXES = [
  "auth",
  "sessions",
  "password",
] as const;

export function assistantEndpointDenied(endpoint: string): boolean {
  const normalized = endpoint.replace(/^\/+|\/+$/g, "");
  return (
    ASSISTANT_FORBIDDEN_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    ) ||
    ASSISTANT_SIDE_EFFECT_GETS.some((route) => route.endpoint === normalized)
  );
}
