import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTERNAL_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
} from "@acropora/types";

import { usersWithPermissionWhere } from "./permission-holders.js";

/**
 * A „KI HORDOZZA” SZŰRŐ ALAKJA. Hogy a Postgres valóban ezt érti-e rajta, azt
 * a `permission-holders.integration.spec.ts` méri; itt a szerkezet áll.
 *
 * MI PIROSÍT: ha a sablon-ág nem a jogot hordozó szerepekre szűr; ha az
 * elvétel nem zárja ki a sablon-ágat; ha a megadás-ág hiányzik; ha a szűrő
 * felső szintű `OR`-t adna (a hívók saját `OR`-ját felülírná).
 */
describe("usersWithPermissionWhere", () => {
  it("AND-ba csomagolva: a hívó saját OR-ja nem ütközik vele", () => {
    const where = usersWithPermissionWhere(PERMISSIONS.SERVICE_MANAGE);
    assert.deepEqual(Object.keys(where), ["AND"]);
  });

  it("a szerepek köre, a sablon-ág elvétel nélkül, és a megadás-ág", () => {
    for (const permission of Object.values(PERMISSIONS))
      assert.deepEqual(usersWithPermissionWhere(permission), {
        AND: [
          { role: { in: [...USER_ROLES] } },
          {
            OR: [
              {
                role: {
                  in: USER_ROLES.filter((role) =>
                    ROLE_PERMISSIONS[role].includes(permission),
                  ),
                },
                permissionOverrides: {
                  none: { permission, effect: "REVOKE" },
                },
              },
              {
                permissionOverrides: {
                  some: { permission, effect: "GRANT" },
                },
              },
            ],
          },
        ],
      });
  });

  it("a hívó szűkítheti a szerepek körét, a megadás-ágra is", () => {
    const where = usersWithPermissionWhere(
      PERMISSIONS.SERVICE_MANAGE,
      INTERNAL_ROLES,
    );
    const [scope, branches] = where.AND as [
      { role: { in: string[] } },
      { OR: [{ role: { in: string[] } }, unknown] },
    ];
    assert.ok(!scope.role.in.includes("PARTNER_SERVICE"));
    assert.ok(branches.OR[0].role.in.includes("SERVICE"));
    assert.ok(!branches.OR[0].role.in.includes("VIEWER"));
  });
});
