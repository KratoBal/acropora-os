import assert from "node:assert/strict";
import { test } from "node:test";
import { PERMISSIONS, ROLE_PERMISSIONS, PARTNER_ROLES } from "./auth.js";
test("#1582 quote permissions never leak through the VIEWER view template", () => {
  const all = Object.values(PERMISSIONS).filter((p) => p.startsWith("quotes."));
  assert.equal(all.length, 9);
  assert.ok(ROLE_PERMISSIONS.VIEWER.every((p) => !p.startsWith("quotes.")));
  for (const role of ["OWNER", "ADMIN", "MANAGER"] as const)
    for (const permission of all)
      assert.ok(
        ROLE_PERMISSIONS[role].includes(permission),
        `${role}: ${permission}`,
      );
  assert.ok(ROLE_PERMISSIONS.SALES.includes(PERMISSIONS.QUOTES_VIEW));
  assert.ok(ROLE_PERMISSIONS.SALES.includes(PERMISSIONS.QUOTES_MANAGE));
  assert.ok(!ROLE_PERMISSIONS.SALES.includes(PERMISSIONS.QUOTES_COSTS_VIEW));
  for (const role of [
    "SALES",
    "WAREHOUSE",
    "SERVICE",
    "VIEWER",
    "CONTENT_AGENT",
    ...PARTNER_ROLES,
  ] as const)
    assert.ok(!ROLE_PERMISSIONS[role].includes(PERMISSIONS.QUOTES_COSTS_VIEW));
});
