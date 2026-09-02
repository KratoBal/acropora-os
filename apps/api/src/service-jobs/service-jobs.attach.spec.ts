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
  /** A jegy: `null`, ha nincs ilyen. A `customerId` a jegyen NULLAZHATO. */
  job: { customerId: string | null } | null;
  /** A lap: a `customerId` itt KOTELEZO, ahogy a semaban is. */
  sheet: { serviceJobId: string | null; customerId: string } | null;
  attached?: boolean;
}) {
  const calls: unknown[] = [];
  const repository: Pick<
    ServiceJobsRepository,
    | "jobAttachState"
    | "worksheetAttachState"
    | "attachWorksheet"
    | "detachWorksheet"
  > = {
    jobAttachState: async () => behaviour.job,
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
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: null, customerId: "vevo-1" },
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
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: null, customerId: "vevo-1" },
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
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: "masik-jegy", customerId: "vevo-1" },
    });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "worksheet-1"),
      /másik hibajegyhez/,
    );
    assert.equal(calls.length, 0);
  });

  it("ugyanahhoz a jegyhez másodszor csatolva külön mondatot ad", async () => {
    const { service } = serviceWith({
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: "job-1", customerId: "vevo-1" },
    });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "worksheet-1"),
      /már ehhez a hibajegyhez/,
    );
  });

  it("nem létező hibajegyre nem találhatót mond", async () => {
    const { service } = serviceWith({ job: null, sheet: null });

    await assert.rejects(
      () => service.attachWorksheet("nincs-ilyen", "worksheet-1"),
      /hibajegy nem található/,
    );
  });

  it("nem létező munkalapra is nem találhatót mond, és megnevezi, melyiket", async () => {
    const { service } = serviceWith({
      job: { customerId: "vevo-1" },
      sheet: null,
    });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "nincs-ilyen"),
      /munkalap nem található/,
    );
  });

  /**
   * A PARTNER-EGYEZES KET TILTOTT ESETE, KULON-KULON, NEV SZERINT.
   *
   * KET ALLITAS, mert a ket eset KET KULONBOZO teendot ad a felhasznalonak: az
   * egyiknel a LAP a rossz (masikat kell valasztani), a masiknal a JEGY hianyos
   * (eloszor a partneret kell beallitani). Ha egy allitas fedne mind a kettot,
   * a ket uzenet CSENDBEN egybecsuszhatna, es a teszt ettol meg zold maradna.
   */
  it("MÁSIK partner lapját nem engedi a jegy alá, és nem is ír", async () => {
    const { service, calls } = serviceWith({
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: null, customerId: "MASIK-vevo" },
    });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "worksheet-1"),
      /másik partnerhez tartozik/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * PARTNER NELKULI JEGY ALA NEM MEHET LAP (Balazs dontese, 2026-09-02).
   *
   * A megengedo irany KET rossz allitast csinalna egy muveletbol: rossz helyen
   * a lap, ES a jegy csendben megkapna egy partner tulajdonat, esemeny nelkul.
   */
  it("partner nélküli jegyre azt mondja, hogy előbb a jegyet kell kitölteni", async () => {
    const { service, calls } = serviceWith({
      job: { customerId: null },
      sheet: { serviceJobId: null, customerId: "vevo-1" },
    });

    await assert.rejects(
      () => service.attachWorksheet("job-1", "worksheet-1"),
      /Először állítsd be a hibajegy partnerét/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * HA KÖZBEN MÁS CSATOLTA, a tárolóréteg nem talál sort (a feltétel a
   * `WHERE`-ben áll), és ütközést mondunk - nem sikert.
   */
  it("közben elvitt lapnál ütközést jelez, nem sikert", async () => {
    const { service } = serviceWith({
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: null, customerId: "vevo-1" },
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
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: "job-1", customerId: "vevo-1" },
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
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: "masik-jegy", customerId: "vevo-1" },
    });

    await assert.rejects(
      () => service.detachWorksheet("job-1", "worksheet-1"),
      /másik hibajegyhez/,
    );
    assert.equal(calls.length, 0);
  });

  it("jegy nélküli lapra külön mondatot ad, és nem ír", async () => {
    const { service, calls } = serviceWith({
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: null, customerId: "vevo-1" },
    });

    await assert.rejects(
      () => service.detachWorksheet("job-1", "worksheet-1"),
      /nem tartozik hibajegyhez/,
    );
    assert.equal(calls.length, 0);
  });

  it("közben elmozdult lapnál ütközést jelez, nem sikert", async () => {
    const { service } = serviceWith({
      job: { customerId: "vevo-1" },
      sheet: { serviceJobId: "job-1", customerId: "vevo-1" },
      attached: false,
    });

    await assert.rejects(
      () => service.detachWorksheet("job-1", "worksheet-1"),
      /időközben elmozdult/,
    );
  });

  /**
   * A LEVALASZTAS NEM NEZI A PARTNERT, ES EZ SZANDEKOS.
   *
   * A partner-egyezes a BEKERULES feltetele. Ha a levalasztas is nezne, egy
   * idokozben elmozdult partner beZARNA a hibas allapotot: a lap bent maradna
   * egy olyan jegy alatt, ahonnan senki nem tudja levenni. A visszaut soha ne
   * legyen szigorubb, mint az oda vezeto ut.
   */
  it("partner nélküli jegyről is le lehet választani a lapot", async () => {
    const { service, calls } = serviceWith({
      job: { customerId: null },
      sheet: { serviceJobId: "job-1", customerId: "vevo-1" },
    });

    await service.detachWorksheet("job-1", "worksheet-1");

    assert.equal(calls.length, 1);
  });
});
