import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobStatus } from "@acropora/database";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

/**
 * A REPOSITORY HELYETTESÍTVE, mert a kérdés a DÖNTÉS, nem az adatbázis:
 * engedjük-e a lépést, és mit mondunk, ha nem.
 */
function serviceWith(behaviour: {
  status: ServiceJobStatus | null;
  moved?: boolean;
}) {
  const calls: unknown[] = [];
  // A VARRAT A VALODI SZERZODES TIPUSAT KAPJA, nem `unknown`-t: igy a fordito
  // szol, ha a repository szignaturaja elmozdul a duplatol. Egy `as unknown as`
  // eppen azt az egy ellenorzest kapcsolna ki, amiert a dupla letezik.
  const repository: Pick<ServiceJobsRepository, "statusOf" | "move"> = {
    statusOf: async () => behaviour.status,
    move: async (input) => {
      calls.push(input);
      return behaviour.moved === false ? { ok: false } : { ok: true };
    },
  };
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    calls,
  };
}

describe("egy lépés a hibajegyen", () => {
  it("a megengedett lépés átmegy, és a naplóhoz továbbadja, honnan hova", async () => {
    const { service, calls } = serviceWith({ status: "NEW" });

    await service.move("job-1", { to: "TRIAGED" }, "user-1");

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      id: "job-1",
      from: "NEW",
      to: "TRIAGED",
      note: null,
      actorUserId: "user-1",
    });
  });

  /**
   * AZ ELUTASÍTÁS MEGNEVEZI, MI MEHETNE HELYETTE.
   *
   * Egy puszta „nem lehet" arra kényszerítené a felhasználót, hogy sorra
   * próbálgassa a gombokat - a válasz pedig úgyis a szerveren áll.
   *
   * ÉS A TILTOTT LÉPÉS NEM ÉR EL AZ ADATBÁZISIG: ezt külön állítjuk, mert egy
   * őrzőt nem az bizonyít, hogy szól, hanem hogy nem történt semmi.
   */
  it("a tiltott lépést elutasítja, megnevezi a lehetségeseket, és nem ír", async () => {
    const { service, calls } = serviceWith({ status: "NEW" });

    await assert.rejects(
      () => service.move("job-1", { to: "COMPLETED" }, "user-1"),
      /TRIAGED/,
    );
    assert.equal(calls.length, 0);
  });

  it("végállapotban azt mondja, hogy nincs több lépés", async () => {
    const { service } = serviceWith({ status: "CANCELLED" });

    await assert.rejects(
      () => service.move("job-1", { to: "NEW" }, "user-1"),
      /nincs több lépése/,
    );
  });

  /**
   * HA KÖZBEN MÁS LÉPETT, NEM ÍRJUK FELÜL CSENDBEN. A tárolóréteg a `from`
   * értéket feltételként használja; ha nem talált sort, az azt jelenti, hogy
   * a jegy elmozdult alattunk.
   */
  it("elmozdult jegynél ütközést jelez, nem sikert", async () => {
    const { service } = serviceWith({ status: "NEW", moved: false });

    await assert.rejects(
      () => service.move("job-1", { to: "TRIAGED" }, "user-1"),
      /időközben/,
    );
  });

  /**
   * AZ ORZO KET MERES: a mondat megjelenik, ES NEM TORTENIK SEMMI. A `calls`
   * uressege az utobbi -- enelkul azt mernenk, hogy a szoveg megvan, nem azt,
   * hogy a vedelem megvolt.
   */
  it("indok nélkül nem enged a várakozó állapotba, és nem ír", async () => {
    const { service, calls } = serviceWith({ status: "TRIAGED" });

    await assert.rejects(
      () => service.move("job-1", { to: "WAITING_FOR_PARTS" }, "user-1"),
      /alkatrész/,
    );
    assert.equal(calls.length, 0);
  });

  /**
   * A CSUPA SZOKOZ UGYANAZ, MINT A SEMMI. Egy szokozokbol allo megjegyzes
   * kitoltott mezonek latszana, es ures sort vinne a jegy tortenetebe.
   */
  it("a csupa szóközből álló indokot nem fogadja el", async () => {
    const { service, calls } = serviceWith({ status: "NEW" });

    await assert.rejects(
      () => service.move("job-1", { to: "CANCELLED", note: "   " }, "user-1"),
      /elállás indoka/,
    );
    assert.equal(calls.length, 0);
  });

  it("indokkal átmegy, és a szöveg eljut a naplóhoz", async () => {
    const { service, calls } = serviceWith({ status: "TRIAGED" });

    await service.move(
      "job-1",
      { to: "WAITING_FOR_PARTS", note: "  Szivattyú, hétfőre ígérik.  " },
      "user-1",
    );

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      id: "job-1",
      from: "TRIAGED",
      to: "WAITING_FOR_PARTS",
      note: "Szivattyú, hétfőre ígérik.",
      actorUserId: "user-1",
    });
  });

  it("nem létező jegyre nem találhatót mond", async () => {
    const { service } = serviceWith({ status: null });

    await assert.rejects(
      () => service.move("hianyzik", { to: "TRIAGED" }, "user-1"),
      /nem található/,
    );
  });
});
