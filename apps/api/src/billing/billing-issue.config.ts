import { szamlazzAgentStubMode } from "../integrations/szamlazz/szamlazz-agent-stub.client.js";

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

/**
 * A KIÁLLÍTÁS MÓDJA: valódi (`BILLING_ISSUE_ENABLED=true`), álszámlázó
 * (`SZAMLAZZ_AGENT_MODE=stub`, a teszt-szerverhez), vagy ki. A kettő együtt
 * ellentmondás: ilyenkor `conflict`, és a kiállítás nem indul, mert nem
 * tudható, melyiket szánták.
 */
export function billingIssueMode(
  environment: NodeJS.ProcessEnv = process.env,
): "live" | "stub" | "off" | "conflict" {
  const live = billingIssueEnabled(environment);
  const stub = szamlazzAgentStubMode(environment);
  if (live && stub) return "conflict";
  return live ? "live" : stub ? "stub" : "off";
}
