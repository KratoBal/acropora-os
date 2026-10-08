import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTNER_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from "./auth.js";

/**
 * Balázs, 2026-10-08 09:43 UTC: "Az értékesítő szerepkör kapjon
 * számlakiállítási jogot." The SALES role creates and issues invoices, and
 * sends the e-invoice, which is issued and sent in one step. It does NOT get
 * finance.manage (all of Finance), so the incoming-invoice review, which asks
 * for that right, stays out of reach.
 */
test("SALES may create, issue and send an invoice without managing finance", () => {
  const sales = ROLE_PERMISSIONS.SALES;
  for (const permission of [
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_CREATE,
    PERMISSIONS.BILLING_ISSUE,
    PERMISSIONS.BILLING_RESEND,
  ])
    assert.ok(sales.includes(permission), permission);
  assert.ok(!sales.includes(PERMISSIONS.FINANCE_MANAGE));
  // the customer search on the invoice
  assert.ok(sales.includes(PERMISSIONS.CUSTOMERS_VIEW));
  assert.equal(new Set(sales).size, sales.length);
});

/**
 * EVERY role, not a hand-written list (acrobot 28185): a role added later must
 * be seen too. The only ones skipped are SALES (the named grant) and the roles
 * that manage finance (they derive the write rights from it).
 */
test("no other role without finance.manage gains a billing write right", () => {
  const checked: string[] = [];
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    if (role === "SALES" || permissions.includes(PERMISSIONS.FINANCE_MANAGE))
      continue;
    checked.push(role);
    for (const permission of [
      PERMISSIONS.BILLING_CREATE,
      PERMISSIONS.BILLING_ISSUE,
      PERMISSIONS.BILLING_RESEND,
    ])
      assert.ok(!permissions.includes(permission), `${role}: ${permission}`);
  }
  // known positive control: the loop really reached the roles that used to be
  // listed by hand, so an empty or filtered-out set cannot pass silently
  for (const role of [
    "WAREHOUSE",
    "SERVICE",
    "VIEWER",
    "CONTENT_AGENT",
    ...PARTNER_ROLES,
  ])
    assert.ok(checked.includes(role), `not checked: ${role}`);
});
