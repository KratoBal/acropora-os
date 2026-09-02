import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A VARRAT A VALODI SZERZODES TIPUSAT KAPJA, nem `unknown`-t: a csatolas harom
 * tarolo-metoduson megy at, es ha barmelyik szignaturaja elmozdul, a fordito
 * szoljon, ne a felulet.
 */
function serviceWith(behaviour: {
  jobStatus: "NEW" | null;
  sheet: { serviceJobId: string | null } | null;
  attached?: boolean;
}) {
  const calls: unknown[] = [];
  const repository: Pick<
    ServiceJobsRepository,
    "statusOf" | "worksheetAttachState" | "attachWorksheet" | "detachWorksheet"
  > = {
    statusOf: async () => behaviour.jobStatus,
    worksheetAttachState: async () => behaviour.sheet,
    attachWorksheet: async (input) => {
      calls.push(input);
      return { ok: behaviour.attached ?? true };
    },
    detachWorksheet: async (input) => {
      calls.push(input);
      return { ok: behaviour.attached ?? true };
    },
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    calls,
  };
}

describe("egy meglévő munkalap a hibajegy alá", () => {
  it("a szabad lapot csatolja, és megnevezi mindkét oldalt", async () => {
    const { service, calls } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: null },
    });

    await service.attachWorksheet("job-1", "worksheet-1");

    assert.deepEqual(calls, [
      { serviceJobId: "job-1", worksheetId: "worksheet-1" },
    ]);
  });

  /**
   * A LEZÁRT LAP IS CSATOLHATÓ, és ezt külön mérjük, mert a kézenfekvő bővítés
   * elrontaná: a lezárás a DOKUMENTUMRÓL szól, a csatolás a BESOROLÁSRÓL.
   * A szolgáltatás semmilyen állapotot nem néz - ha valaha nézne, ez pirosodik.
   */
  it("a lap állapotát nem vizsgálja, csak azt, hogy szabad-e", async () => {
    const { service, calls } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: null },
    });

    await service.attachWorksheet("job-1", "egy-regen-lezart-lap");

    assert.equal(calls.length, 1);
  });

  /**
   * A TILTOTT ESETEK, NÉV SZERINT.
   *
   * Egy készlet, ami csak a sikeres csatolást nézi, akkor is zöld maradna, ha a
   * szolgáltatás MINDENT engedne - beleértve azt, hogy egy másik jegy alól
   * elvegye a lapot. Az elvétel NÉMA hiba: a régi jegyről csendben eltűnne egy
   * munka, és senki nem keresné.
   */
  it("már csatolt lapot NEM vesz el egy másik jegytől, és nem is ír", async () => {
    const { service, calls } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: "masik-jegy" },
    });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "worksheet-1"),
      /másik hibajegyhez/,
    );
    assert.equal(calls.length, 0);
  });

  it("ugyanahhoz a jegyhez másodszor csatolva külön mondatot ad", async () => {
    const { service } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: "job-1" },
    });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "worksheet-1"),
      /már ehhez a hibajegyhez/,
    );
  });

  it("nem létező hibajegyre nem találhatót mond", async () => {
    const { service } = serviceWith({ jobStatus: null, sheet: null });

    await assert.rejects(
      () => service.attachWorksheet("nincs-ilyen", "worksheet-1"),
      /hibajegy nem található/,
    );
  });

  it("nem létező munkalapra is nem találhatót mond, és megnevezi, melyiket", async () => {
    const { service } = serviceWith({ jobStatus: "NEW", sheet: null });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "nincs-ilyen"),
      /munkalap nem található/,
    );
  });

  /**
   * HA KÖZBEN MÁS CSATOLTA, a tárolóréteg nem talál sort (a feltétel a
   * `WHERE`-ben áll), és ütközést mondunk - nem sikert.
   */
  it("közben elvitt lapnál ütközést jelez, nem sikert", async () => {
    const { service } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: null },
      attached: false,
    });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "worksheet-1"),
      /időközben/,
    );
  });
});

describe("a munkalap leválasztása a hibajegyről", () => {
  it("az ehhez a jegyhez tartozó lapot leválasztja", async () => {
    const { service, calls } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: "job-1" },
    });

    await service.detachWorksheet("job-1", "worksheet-1");

    assert.deepEqual(calls, [
      { serviceJobId: "job-1", worksheetId: "worksheet-1" },
    ]);
  });

  /**
   * A TILTOTT ESETEK, NÉV SZERINT.
   *
   * Egy készlet, ami csak a sikeres leválasztást nézi, akkor is zöld maradna,
   * ha a szolgáltatás BÁRMELYIK lapot leválasztaná BÁRMELYIK jegyről - és az
   * néma kár: egy másik jegy alól tűnne el egy munka.
   */
  it("MÁSIK jegy lapját nem választja le, és nem is ír", async () => {
    const { service, calls } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: "masik-jegy" },
    });

    await assert.rejects(
      () => service.detachWorksheet("job-1", "worksheet-1"),
      /másik hibajegyhez/,
    );
    assert.equal(calls.length, 0);
  });

  it("jegy nélküli lapra külön mondatot ad, és nem ír", async () => {
    const { service, calls } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: null },
    });

    await assert.rejects(
      () => service.detachWorksheet("job-1", "worksheet-1"),
      /nem tartozik hibajegyhez/,
    );
    assert.equal(calls.length, 0);
  });

  it("közben elmozdult lapnál ütközést jelez, nem sikert", async () => {
    const { service } = serviceWith({
      jobStatus: "NEW",
      sheet: { serviceJobId: "job-1" },
      attached: false,
    });

    await assert.rejects(
      () => service.detachWorksheet("job-1", "worksheet-1"),
      /időközben elmozdult/,
    );
  });
});
