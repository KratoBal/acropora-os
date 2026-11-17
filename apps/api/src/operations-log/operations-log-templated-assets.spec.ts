import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OperationsLogEntriesService } from "./operations-log-entries.service.js";
import type { OperationsLogEntriesRepository } from "./operations-log-entries.repository.js";
import {
  templateTargets,
  type OperationsLogRepository,
} from "./operations-log.repository.js";
import type { ServiceJobsService } from "../service-jobs/service-jobs.service.js";

/*
  A KEZDŐKÉPERNYŐ SZŰRŐJE (task f6694b49): MELY ESZKÖZÖKHÖZ VAN AKTÍV SABLON. MI PIROSIT: ha a közös célú sablon (eszköz és
  kategória) ismétlődő azonosítót adna; ha egy kategóriára szóló sablon kategória-azonosítója az eszközök közé kerülne (vagy
  fordítva); ha a mindkettő-null sor (amit a CHECK úgyis tilt) üres azonosítót vinne a szűrőbe, amelyből `in: [""]` lenne; ha a
  szolgáltatás a tároló válaszát nem `assetIds` alakban adná tovább.
*/
describe("a sablonok céljai", () => {
  it("az eszköz- és a kategória-azonosítók külön halmazba kerülnek, ismétlés nélkül", () => {
    assert.deepEqual(
      templateTargets([
        { assets: [{ assetId: "a1" }], assetCategoryId: null },
        { assets: [{ assetId: "a1" }], assetCategoryId: null },
        { assets: [], assetCategoryId: "c1" },
        { assets: [], assetCategoryId: "c1" },
        { assets: [{ assetId: "a2" }], assetCategoryId: null },
      ]),
      { assetIds: ["a1", "a2"], categoryIds: ["c1"] },
    );
  });

  it("egy többeszközös lista minden eszközét felveszi, ismétlés nélkül, a másik sablonéval együtt", () => {
    assert.deepEqual(
      templateTargets([
        {
          assets: [{ assetId: "a1" }, { assetId: "a2" }, { assetId: "a3" }],
          assetCategoryId: null,
        },
        {
          assets: [{ assetId: "a2" }, { assetId: "a4" }],
          assetCategoryId: null,
        },
      ]),
      { assetIds: ["a1", "a2", "a3", "a4"], categoryIds: [] },
    );
  });

  it("a cél nélküli sor egyik halmazba sem kerül, és az üres lista üres halmazokat ad", () => {
    assert.deepEqual(templateTargets([{ assets: [], assetCategoryId: null }]), {
      assetIds: [],
      categoryIds: [],
    });
    assert.deepEqual(templateTargets([]), { assetIds: [], categoryIds: [] });
  });
});

describe("a sablonnal rendelkező eszközök szolgáltatása", () => {
  const catalogue = [
    {
      id: "a1",
      assetNumber: "E-1",
      name: "Homokszűrő",
      owner: { id: "p1", displayName: "Fánk" },
      unit: { id: "u1", path: ["Fánk", "Biodóm"] },
    },
  ];
  const make = (colleagues: { id: string; name: string }[] = []) =>
    new OperationsLogEntriesService(
      {
        assignableColleagues: async () => colleagues,
      } as unknown as OperationsLogEntriesRepository,
      {
        assetIdsWithActiveTemplates: async () => ["a1", "a2"],
        startCatalogue: async () => catalogue,
      } as unknown as OperationsLogRepository,
      {} as ServiceJobsService,
    );

  it("az azonosítókat és a katalógust is visszaadja (a régi assetIds alak megmarad)", async () => {
    assert.deepEqual(await make().assetsWithTemplates(), {
      assetIds: ["a1", "a2"],
      assets: catalogue,
    });
  });

  it("a rögzítés résztvevői: a hívó nem szerepel a listán, a többiek igen, a sorrend megmarad", async () => {
    const list = [
      { id: "u-balazs", name: "Balázs" },
      { id: "u-david", name: "Dávid" },
      { id: "u-feri", name: "Feri" },
    ];
    assert.deepEqual(await make(list).colleagues("u-balazs"), {
      items: [list[1], list[2]],
    });
    // ismeretlen hívó: senkit nem veszünk ki
    assert.deepEqual(await make(list).colleagues("u-masvalaki"), {
      items: list,
    });
  });
});
