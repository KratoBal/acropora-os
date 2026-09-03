import assert from "node:assert/strict";
import type { ServiceJobStatus } from "@acropora/database";
import { describe, it } from "node:test";

import { serviceJobVisibilityWhere } from "./service-job-visibility.js";
import { allowedServiceJobSteps } from "./service-job-transitions.js";

const partner = { kind: "supplier", supplierId: "sup-1" } as const;

describe("a hibajegy-láthatóság két tengelye", () => {
  /**
   * A LEGFONTOSABB ALLITAS: URES EGYSEG-HALMAZ MELLETT NEM MINDENT ENGED.
   *
   * Ez az az ag, ami egy elfelejtett feltetelnel NEMAN romlana el: egy `{}`
   * visszateres a TELJES jegylistat engedne at a partner-oldali felhasznalonak,
   * es a valasz szabalyos maradna -- csak tobb sort tartalmazna, mint amirol
   * barki tud.
   */
  it("üres egység-halmaz mellett CSAK a nyitó-tengely marad", () => {
    const where = serviceJobVisibilityWhere({
      scope: partner,
      userId: "user-1",
      unitIds: [],
    });
    assert.deepEqual(where, {
      events: { some: { toStatus: "NEW", actorUserId: "user-1" } },
    });
    // ES KIMONDVA, hogy nem ures objektum: az engedne mindent.
    assert.notDeepEqual(where, {});
  });

  it("egységekkel a két tengely OR-ban áll, és a nyitó az első", () => {
    const where = serviceJobVisibilityWhere({
      scope: partner,
      userId: "user-1",
      unitIds: ["u1", "u2"],
    });
    assert.deepEqual(where, {
      OR: [
        { events: { some: { toStatus: "NEW", actorUserId: "user-1" } } },
        {
          customer: {
            worksheetDepartments: { some: { id: { in: ["u1", "u2"] } } },
          },
        },
      ],
    });
  });

  /**
   * A BELSOS AG. Ez a ketto kozul a "mindent enged" eset, es SZANDEKOSAN az:
   * a belsos valasztok teljes halmazt kell lassanak. Kulon allitas all ra, hogy
   * a fenti ures-halmaz allitassal ne lehessen osszekeverni.
   */
  it("belsősnek nincs szűrés", () => {
    assert.deepEqual(
      serviceJobVisibilityWhere({
        scope: { kind: "internal" },
        userId: "user-1",
        unitIds: [],
      }),
      {},
    );
  });

  /**
   * A NYITO AZONOSITASA NEM HEURISZTIKA, ES EZ AZ ALLITAS TARTJA MEG.
   *
   * A `toStatus: "NEW"` csak azert azonositja a keletkezest, mert a `NEW`
   * allapotba EGYETLEN atmenet sem vezet. Ha valaki egyszer felvesz egy
   * ilyet (peldaul "ujranyitas"), ez a sor pirosra valt -- es akkor a szuro
   * nyito-tengelye tobb sort engedne at, mint amennyit szabad.
   */
  it("a NEW állapotba egyetlen átmenet sem vezet, ezért azonosítja a keletkezést", () => {
    /**
     * A LISTA A TIPUSBOL JON, NEM KEZZEL. Egy kezzel irt allapot-lista pont
     * azt az uj allapotot hagyna ki, amiert ez az allitas letezik -- a
     * `Record` viszont forditasi hibat ad, ha egy uj erteket nem sorolunk fel.
     */
    const MINDEN: Record<ServiceJobStatus, true> = {
      NEW: true,
      TRIAGED: true,
      SCHEDULED: true,
      IN_PROGRESS: true,
      WAITING_FOR_PARTS: true,
      WAITING_FOR_CUSTOMER: true,
      COMPLETED: true,
      CANCELLED: true,
    };
    const beVezeto = (Object.keys(MINDEN) as ServiceJobStatus[]).filter(
      (honnan) => allowedServiceJobSteps(honnan).includes("NEW"),
    );
    assert.deepEqual(
      beVezeto,
      [],
      `ezek az állapotok NEW-ba lépnek: ${beVezeto.join(", ")} -- ` +
        "a nyitó-tengely azonosítása ettől kétértelművé válik",
    );
  });
});
