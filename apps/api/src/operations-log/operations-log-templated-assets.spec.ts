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
        { assetId: "a1", assetCategoryId: null },
        { assetId: "a1", assetCategoryId: null },
        { assetId: null, assetCategoryId: "c1" },
        { assetId: null, assetCategoryId: "c1" },
        { assetId: "a2", assetCategoryId: null },
      ]),
      { assetIds: ["a1", "a2"], categoryIds: ["c1"] },
    );
  });

  it("a cél nélküli sor egyik halmazba sem kerül, és az üres lista üres halmazokat ad", () => {
    assert.deepEqual(
      templateTargets([{ assetId: null, assetCategoryId: null }]),
      {
        assetIds: [],
        categoryIds: [],
      },
    );
    assert.deepEqual(templateTargets([]), { assetIds: [], categoryIds: [] });
  });
});

describe("a sablonnal rendelkező eszközök szolgáltatása", () => {
  it("a tároló azonosítóit assetIds alakban adja vissza", async () => {
    const service = new OperationsLogEntriesService(
      {} as OperationsLogEntriesRepository,
      {
        assetIdsWithActiveTemplates: async () => ["a1", "a2"],
      } as unknown as OperationsLogRepository,
      {} as ServiceJobsService,
    );
    assert.deepEqual(await service.assetsWithTemplates(), {
      assetIds: ["a1", "a2"],
    });
  });
});
