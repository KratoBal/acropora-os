import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

type DetailRow = Awaited<ReturnType<ServiceJobsRepository["detail"]>>;

/**
 * A VARRAT A VALÓDI SZERZŐDÉS TÍPUSÁT KAPJA (`Pick<...>`), nem `unknown`-t: a
 * részletlap alakja a felület szerződése, és ha a tároló visszatérése
 * elmozdul a duplától, a fordító szóljon, ne a képernyő.
 */
function serviceWith(row: DetailRow) {
  const repository: Pick<ServiceJobsRepository, "detail"> = {
    detail: async () => row,
  };
  return new ServiceJobsService(repository as ServiceJobsRepository);
}

function row(overrides: Partial<NonNullable<DetailRow>> = {}) {
  return {
    id: "job-1",
    jobNumber: "HJ-2026-001",
    title: "Szivattyú leállt",
    description: null,
    status: "TRIAGED" as const,
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    customer: { displayName: "Fővárosi Állat- És Növénykert" },
    events: [
      {
        id: "event-1",
        fromStatus: null,
        toStatus: "NEW" as const,
        note: null,
        createdAt: new Date("2026-09-01T08:00:00.000Z"),
        actor: { displayName: "Szerelő Sándor" },
      },
    ],
    worksheets: [
      {
        id: "worksheet-1",
        number: null,
        createdAt: new Date("2026-09-02T08:00:00.000Z"),
        handedOverAt: null,
      },
    ],
    assets: [
      {
        id: "link-1",
        assetId: "asset-1",
        createdAt: new Date("2026-09-02T09:00:00.000Z"),
        asset: { assetNumber: "ESZ-0007", name: "Szivattyú" },
      },
    ],
    ...overrides,
  } satisfies NonNullable<DetailRow>;
}

describe("a hibajegy részletlapja", () => {
  it("dátumot ISO szöveggé fordít, mert a válasz JSON, nem Date", async () => {
    const detail = await serviceWith(row()).detail("job-1");

    assert.equal(detail.createdAt, "2026-09-01T08:00:00.000Z");
    assert.equal(detail.events[0]!.createdAt, "2026-09-01T08:00:00.000Z");
    assert.equal(detail.worksheets[0]!.createdAt, "2026-09-02T08:00:00.000Z");
    assert.equal(detail.assets[0]!.attachedAt, "2026-09-02T09:00:00.000Z");
  });

  /**
   * A LÉPÉSEKET A TÁBLA ADJA, NEM A FELÜLET. Ha a válasz nem vinné, a kliens
   * kezdené el kitalálni, mi mehet - és onnantól az átmenet-szabály két helyen
   * állna, ami közül csak az egyik a szerver.
   */
  it("megmondja, mit tehet a jegy innen", async () => {
    const detail = await serviceWith(row()).detail("job-1");
    assert.ok(detail.allowedSteps.length > 0);
    assert.ok(!detail.allowedSteps.includes("NEW"));
  });

  it("lezárt jegyen üres a lépések listája", async () => {
    const detail = await serviceWith(row({ status: "CANCELLED" })).detail(
      "job-1",
    );
    assert.deepEqual(detail.allowedSteps, []);
  });

  /**
   * A TÖRÖLT FELHASZNÁLÓ NEM VISZI MAGÁVAL A NAPLÓT: az `actor` `null` lehet,
   * és a válasznak akkor is teljesnek kell lennie. Egy hiányzó mező itt a
   * kliensen `undefined`-ként jelenne meg, hibaüzenet nélkül.
   */
  it("aktor nélküli naplósort is kiad, nem hagyja ki", async () => {
    const eventek = row().events.map((event) => ({ ...event, actor: null }));
    const detail = await serviceWith(row({ events: eventek })).detail("job-1");

    assert.equal(detail.events.length, 1);
    assert.equal(detail.events[0]!.actorName, null);
  });

  it("nem létező jegyre nem találhatót mond, nem üres részletlapot", async () => {
    await assert.rejects(
      () => serviceWith(null).detail("hianyzik"),
      /nem található/,
    );
  });
});
