import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

function serviceWith(units: unknown) {
  const repository: Pick<ServiceJobsRepository, "selectableUnits"> = {
    selectableUnits: async () =>
      units as Awaited<ReturnType<ServiceJobsRepository["selectableUnits"]>>,
  };
  return new ServiceJobsService(repository as ServiceJobsRepository);
}

describe("a felhasználóhoz választható alegységek", () => {
  it("átadja a listát, ahogy a tároló adta", async () => {
    const service = serviceWith([
      { id: "u1", name: "Biotóp", code: "BIO", parentId: null },
    ]);

    assert.deepEqual(await service.selectableUnits("user-1"), {
      items: [{ id: "u1", name: "Biotóp", code: "BIO", parentId: null }],
    });
  });

  /**
   * A HIANYZO FELHASZNALO NEM URES LISTA, ES A KET ESET TEENDOJE MAS.
   *
   * Egy ures tomb azt mondana, hogy a fiok letezik es nincs mit valasztani --
   * egy elgepelt azonositora pedig a felulet ures legordulot mutatna, hiba
   * nelkul, es a kezelo azt hinne, a partnernek nincs alegysege.
   */
  it("a nem létező felhasználót nem találhatónak mondja", async () => {
    await assert.rejects(
      () => serviceWith(null).selectableUnits("hianyzik"),
      /nem található/,
    );
  });

  /**
   * TESTVER-KONTROLL: A VALODI URES LISTA ATMEGY.
   *
   * Enelkul az elozo allitas akkor is zold lenne, ha a metodus MINDEN bemenetre
   * hibat dobna -- es akkor egy belsos fiok (aminek nincs szallitoja, tehat
   * ures a lista) megnyitasa is elhasalna. Az URES LISTA HAROM KULONBOZO OKBOL
   * johet, es mind a harom RENDES allapot.
   */
  it("az üres lista rendes válasz, nem hiba", async () => {
    assert.deepEqual(await serviceWith([]).selectableUnits("user-1"), {
      items: [],
    });
  });
});
