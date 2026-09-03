import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
    assert.deepEqual(where, { openedById: "user-1" });
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
        { openedById: "user-1" },
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
   * A `toStatus: "NEW"` MA MAR NEM A SZUROT TARTJA -- A MIGRACIOT ES A JOVOT.
   *
   * Amig a nyito-tengely a naplobol jott, ez az allitas kozvetlenul a szurot
   * vedte. A szuro azota a `ServiceJob.openedById` mezot olvassa, tehat AZ
   * indoklas elavult, es nem hagyom itt: egy megjegyzes, ami egy azota
   * megvaltozott vedelmet ir le, rosszabb a semminel.
   *
   * AMIT MA VED: a migracio visszatoltese (`WHERE e."toStatus" = 'NEW'`) es
   * minden kesobbi ujratoltes. Ha valaki felvesz egy "ujranyitas" atmenetet,
   * a keletkezes tobbe nem azonosithato ezzel a felteteellel, es a visszatoltes
   * ROSSZ aktort irna a mezobe -- ez a sor akkor pirosra valt.
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

describe("a keletkezési út beírja a nyitót", () => {
  /**
   * FORRAST OLVAS, NEM VISELKEDEST, es ez szandekos -- ugyanaz az indok, mint a
   * `partner-scope-and-branch.spec.ts` fajlban: a `create` a Prismat hivja, tehat
   * adatbazis nelkul a viselkedese nem merheto, a hiba viszont NEMA lenne. Ha az
   * `openedById` kiesik a `create` adat-blokkjabol, az uj jegyek nyitoja `null`
   * marad, es a nyito-tengely rajtuk CSENDBEN nem fog mukodni: a lekerdezes
   * lefut, kevesebb sort ad, es helyes valasznak latszik.
   */
  it("a create adat-blokkja beírja az openedById mezőt", () => {
    const forras = readFileSync(
      "src/service-jobs/service-jobs.repository.ts",
      "utf8",
    );
    /**
     * A KOMMENTEKET KI KELL VAGNI, ES EZT A KALIBRACIO TANITOTTA MEG.
     *
     * Elso alakjaban ez az allitas a nyers forrasra illesztett, es a rontas --
     * `// openedById: input.actorUserId` -- ATMENT rajta: a komment-jel nem
     * akadalyozza a mintat. Vagyis pontosan a legvaloszinubb hibara volt vak,
     * es ZOLDET adott ra. Ugyanaz a szabaly, mint a hatokor-orzoben: egy
     * kommentben allo sor nem hasznalat.
     */
    const kommentNelkul = forras
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const create = kommentNelkul.slice(
      kommentNelkul.indexOf("serviceJob.create("),
      kommentNelkul.indexOf("select: { id: true, jobNumber: true }"),
    );
    assert.ok(
      create.length > 0,
      "nem találtam a serviceJob.create hívást -- a minta romlott el, nem a kód",
    );
    assert.match(
      create,
      /openedById:\s*input\.actorUserId/,
      "a create nem írja be az openedById mezőt: az új jegyek nyitója null maradna",
    );
  });
});
