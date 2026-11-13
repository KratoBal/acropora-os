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
      PERMISSIONS.OPERATIONS_LOG_TEMPLATES_MANAGE,
    ])
      assert.ok(!ROLE_PERMISSIONS[role].includes(permission), `${role}`);
});
