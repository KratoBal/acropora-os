import assert from "node:assert/strict";
import type { AuthenticatedUser } from "@acropora/types";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A VARRAT A VALODI SZERZODES TIPUSAT KAPJA (`Pick<...>`): a beallitas harom
 * tarolo-metoduson megy at, es ha barmelyik szignaturaja elmozdul, a fordito
 * szoljon, ne a felulet.
 */
function serviceWith(behaviour: {
  job: { customerId: string | null } | null;
  customerExists?: boolean;
  updated?: boolean;
}) {
  const calls: unknown[] = [];
  const repository: Pick<
    ServiceJobsRepository,
    "jobAttachState" | "customerExists" | "setPartner"
  > = {
    jobAttachState: async () => behaviour.job,
    customerExists: async () => behaviour.customerExists ?? true,
    setPartner: async (input) => {
      calls.push(input);
      return { ok: behaviour.updated ?? true };
    },
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    calls,
  };
}

/**
 * A HIVO HATOKORE MOSTANTOL ARGUMENTUM, ES EZ NEM DISZITES.
 *
 * Az irasi utak 2026-09-14 ota a hivo hatokoret nezik, MIELOTT irnanak.
 * Ezek az allitasok a BELSO agat merik -- a partner-hatokor sajat
 * fajlban all (`service-jobs.write-scope.spec.ts`).
 */
const BELSOS = { id: "user-1" } as AuthenticatedUser;

describe("partner egy még partner nélküli hibajegyre", () => {
  it("a partner nélküli jegyre beállítja, és megnevezi mindkét oldalt", async () => {
    const { service, calls } = serviceWith({ job: { customerId: null } });

    await service.setPartner("job-1", "vevo-1", BELSOS);

    assert.deepEqual(calls, [{ id: "job-1", customerId: "vevo-1" }]);
  });

  /**
   * A TILTOTT ESET, NÉV SZERINT, ÉS EZ A SZELET LÉNYEGE.
   *
   * Egy készlet, ami csak a sikeres beállítást nézi, akkor is zöld maradna, ha
   * a szolgáltatás BÁRMIKOR felülírná a partnert - és az ÁTSOROLÁS lenne, a
   * saját nyitott kérdéseivel. Ráadásul egy már csatolt lappal rendelkező
   * jegyen azonnal ELTÉRÉST csinálna a jegy és a lap partnere között: pont azt
   * a rést nyitná újra, amit a csatolás-ellenőrzés bezárt, csak másik ajtón.
   */
  it("MÁR partneres jegyen nem cseréli le, és nem is ír", async () => {
    const { service, calls } = serviceWith({ job: { customerId: "vevo-1" } });

    await assert.rejects(
      () => service.setPartner("job-1", "MASIK-vevo", BELSOS),
      /átsorolás/,
    );
    assert.equal(calls.length, 0);
  });

  it("nem létező jegyre nem találhatót mond", async () => {
    const { service } = serviceWith({ job: null });

    await assert.rejects(
      () => service.setPartner("nincs-ilyen", "vevo-1", BELSOS),
      /hibajegy nem található/,
    );
  });

  /**
   * A NEM LÉTEZŐ PARTNERT KÜLÖN NEVEZZÜK MEG. Az adatbázis idegen kulcsa is
   * elhasalna rajta, de az a felhasználónak semmit nem mond - és nem is
   * mondaná meg, MELYIK oldal hiányzik.
   */
  it("nem létező partnerre megmondja, hogy a PARTNER nincs meg, és nem ír", async () => {
    const { service, calls } = serviceWith({
      job: { customerId: null },
      customerExists: false,
    });

    await assert.rejects(
      () => service.setPartner("job-1", "nincs-ilyen-vevo", BELSOS),
      /partner nem található/,
    );
    assert.equal(calls.length, 0);
  });

  it("közben partnert kapott jegynél ütközést jelez, nem sikert", async () => {
    const { service } = serviceWith({
      job: { customerId: null },
      updated: false,
    });

    await assert.rejects(
      () => service.setPartner("job-1", "vevo-1", BELSOS),
      /időközben partnert kapott/,
    );
  });
});
