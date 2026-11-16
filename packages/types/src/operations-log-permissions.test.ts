import assert from "node:assert/strict";
import { test } from "node:test";

import { PARTNER_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from "./auth.js";

/*
  AZ ÜZEMELTETÉSI NAPLÓ JOGAI (task os-uzemeltetesi-naplo, S1). MI PIROSIT: ha a sablonok kezelése a szerelő (SERVICE)
  szerepnek is járna (a sablonokat az admin gondozza); ha a szerelő nem látná a sablonokat; ha a partner-szerepek bármelyik
  jogot megkapnák (a partner-nézet az S5, a saját láthatósági szabályával); ha a VIEWER megkapná.
*/
test("az üzemeltetési napló jogai", () => {
  for (const role of ["OWNER", "ADMIN", "MANAGER"] as const) {
    assert.ok(
      ROLE_PERMISSIONS[role].includes(PERMISSIONS.OPERATIONS_LOG_VIEW),
      role,
    );
    assert.ok(
      ROLE_PERMISSIONS[role].includes(
        PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE,
      ),
      role,
    );
  }
  for (const role of ["OWNER", "ADMIN", "MANAGER", "SERVICE"] as const)
    assert.ok(
      ROLE_PERMISSIONS[role].includes(PERMISSIONS.OPERATIONS_LOG_RECORD),
      role,
    );
  assert.ok(ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.OPERATIONS_LOG_VIEW));
  assert.ok(
    !ROLE_PERMISSIONS.SERVICE.includes(
      PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE,
    ),
  );
  for (const role of [
    "VIEWER",
    "SALES",
    "WAREHOUSE",
    ...PARTNER_ROLES,
  ] as const)
    for (const permission of [
      PERMISSIONS.OPERATIONS_LOG_VIEW,
      PERMISSIONS.OPERATIONS_LOG_RECORD,
      PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE,
    ])
      assert.ok(!ROLE_PERMISSIONS[role].includes(permission), `${role}`);
});

/*
  A PARTNER-NÉZET JOGA (S5). MI PIROSIT: ha a vezető, a szerelő vagy a nézegető megkapná (a partner szűkített nézete a partner-fióké; a
  belső szerepek a belső nézetet kapják); ha a partner-fiók a belső nézetet is megkapná (az kollégák nevét és belső megjegyzést mutat).
*/
test("az üzemeltetési napló partner-nézetének joga csak a partner-fióké (és az OWNER, ADMIN mindent kap)", () => {
  assert.ok(
    ROLE_PERMISSIONS.PARTNER_SERVICE.includes(
      PERMISSIONS.OPERATIONS_LOG_PARTNER_VIEW,
    ),
  );
  for (const role of ["OWNER", "ADMIN"] as const)
    assert.ok(
      ROLE_PERMISSIONS[role].includes(PERMISSIONS.OPERATIONS_LOG_PARTNER_VIEW),
      role,
    );
  for (const role of [
    "MANAGER",
    "SERVICE",
    "VIEWER",
    "SALES",
    "WAREHOUSE",
  ] as const)
    assert.ok(
      !ROLE_PERMISSIONS[role].includes(PERMISSIONS.OPERATIONS_LOG_PARTNER_VIEW),
      role,
    );
  for (const permission of [
    PERMISSIONS.OPERATIONS_LOG_VIEW,
    PERMISSIONS.OPERATIONS_LOG_RECORD,
    PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE,
  ])
    assert.ok(
      !ROLE_PERMISSIONS.PARTNER_SERVICE.includes(permission),
      permission,
    );
});
