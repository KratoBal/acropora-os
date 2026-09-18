import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { serviceJobVisibilityFor } from "./service-job-visibility-scope.js";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A KET LATHATOSAGI UT UGYANAZT ADJA -- AMIG KET UT VAN.
 *
 * === MIERT LETEZIK EZ A FAJL ===
 *
 * A jegy lathatosagi szuroje MA KET helyen all: a `ServiceJobsService` PRIVAT
 * `visibilityFor` metodusaban, es a `serviceJobVisibilityFor` fuggvenyben, amit
 * a csatolmany-vegpontok hasznalnak. A masodik azert kellett, mert az elso
 * privat -- egy masik szolgaltatas nem eri el.
 *
 * KET HELYEN ALLO SZABALY EGYSZER SZETCSUSZIK, es ez a szetcsuszas NEMA: a
 * dokumentum-vegpont TAGABB valtozata nem hibazik, csak elarulja, hogy a jegy
 * LETEZIK. Ez az allitas azert all itt, hogy a szetcsuszas HANGOS legyen.
 *
 * === AMIT EZ NEM POTOL ===
 *
 * Egy KOZOS FORRAS tobbet erne: az nem tud elcsuszni, ez viszont csak akkor
 * szol, ha valaki lefuttatja. A `ServiceJobsService` atvezetese azert nem
 * tortent meg ebben a korben, mert az a fajl 2026-09-14-en nyitott munka alatt
 * all (#639), es egy negy soros atvezetes ott felesleges utkozest szulne.
 * Amint a #639 bent van, a `visibilityFor` torzse erre a fuggvenyre cserelheto,
 * es akkor ez a fajl torolheto.
 *
 * === HOGYAN MERI ===
 *
 * A szolgaltatas oldalarol nem a privat metodust hivja (azt nem is lehetne),
 * hanem azt nezi, MIT KAP A TAROLO: a `list()` a szurot adja tovabb, es a
 * hamis repository elkapja. Ez erosebb, mint a metodus kozvetlen merese, mert
 * a BEKOTEST is meri.
 */

/** `ADMIN`: a lista-szuro 2026-09-18 ota jogot is nez (lasd `hidden-rows.ts`). */
const BELSOS = { id: "user-1", role: "ADMIN" } as AuthenticatedUser;
const PARTNER = {
  id: "user-2",
  supplierId: "sup-1",
  role: "PARTNER_SERVICE",
} as unknown as AuthenticatedUser;

const EGYSEGEK = ["u1", "u2"];

/** A szolgaltatas altal a TAROLONAK atadott szuro. */
async function szolgaltatasSzuroje(
  user: AuthenticatedUser,
): Promise<Prisma.ServiceJobWhereInput | undefined> {
  let kapott: Prisma.ServiceJobWhereInput | undefined;
  const repository: Pick<
    ServiceJobsRepository,
    "list" | "assignedUnitIds" | "countsByStatus"
  > = {
    assignedUnitIds: async () => EGYSEGEK,
    list: async (_scope, visibility) => {
      kapott = visibility;
      return { rows: [], truncated: false };
    },
    countsByStatus: async () => ({
      NEW: 0,
      TRIAGED: 0,
      SCHEDULED: 0,
      IN_PROGRESS: 0,
      WAITING_FOR_PARTS: 0,
      WAITING_FOR_CUSTOMER: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    }),
  };
  await new ServiceJobsService(repository as ServiceJobsRepository).list(
    {},
    user,
  );
  return kapott;
}

/** A csatolmany-vegpontok altal hasznalt szuro, ugyanarra a hivora. */
function csatolmanySzuroje(user: AuthenticatedUser) {
  return serviceJobVisibilityFor(user, async () => EGYSEGEK);
}

/**
 * A LISTA SZUROJE 2026-09-18 OTA KET AGBOL ALL, ES EZ NEM GYENGITI AZ ALLITAST.
 *
 * A jegy-lista `where`-je azota `{ AND: [lathatosag, { hiddenAt: null }] }`
 * alaku: a rejtes a LISTARA szol, a csatolmanyokra NEM. Ez szandekos -- a
 * rejtes nem jogosultsag, es egy rejtett jegy reszletlapja (a csatolmanyaival
 * egyutt) tovabbra is elerheto azonositoval.
 *
 * AMIERT NEM ELEG KICSOMAGOLNI ES AZ ELSO AGAT NEZNI: akkor egy felcserelt
 * sorrend eseten a spec a MASIK agat hasonlitana ossze, es zold maradna. Ezert
 * a TELJES alakra allitunk, a rejtes-aggal egyutt.
 */
const REJTETT_NELKUL = { hiddenAt: null };

describe("a jegy és a csatolmányai ugyanazt a láthatóságot használják", () => {
  it("belsős hívóra azonos a két szűrő", async () => {
    assert.deepEqual(await szolgaltatasSzuroje(BELSOS), {
      AND: [await csatolmanySzuroje(BELSOS), REJTETT_NELKUL],
    });
  });

  /**
   * A LENYEGES ESET. A belsos agon MINDKETTO ures objektumot ad, tehat az az
   * allitas akkor is zold maradna, ha az egyik ut teljesen elromlana. Ez a
   * partner-ag az, ami KULONBOZTET: itt a szuro ket tengelyt visz, es barmelyik
   * elhagyasa elteresre vezet.
   */
  it("partner hívóra azonos a két szűrő, mindkét tengellyel", async () => {
    const csatolmany = await csatolmanySzuroje(PARTNER);
    assert.deepEqual(await szolgaltatasSzuroje(PARTNER), {
      AND: [csatolmany, REJTETT_NELKUL],
    });

    // ES A KET TENGELY TENYLEG OTT VAN: enelkul a fenti sor ket URES
    // objektumot is osszevethetne, es zold maradna.
    assert.deepEqual(csatolmany, {
      OR: [
        { openedById: "user-2" },
        {
          customer: {
            worksheetDepartments: { some: { id: { in: EGYSEGEK } } },
          },
        },
      ],
    });
  });
});
