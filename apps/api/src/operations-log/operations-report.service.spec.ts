import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type {
  OperationsReportEntryInput,
  OperationsReportScheduleInput,
} from "@acropora/types";

import type {
  OperationsReportEntryFilter,
  OperationsReportRepository,
  OperationsReportScope,
} from "./operations-report.repository.js";
import { OperationsReportService } from "./operations-report.service.js";

/*
  A HAVI KIMUTATÁS SZOLGÁLTATÁSA (task os-uzemeltetesi-naplo, S4). MI PIROSIT: ha a hónap alakja vagy a hatókör (helyszín VAGY
  eszköz, pontosan az egyik) nem lenne kötelező; ha a bejegyzések a hónap előtti hét nap nélkül töltődnének (a hét-határon átnyúló
  heti feladat hiányzónak látszana); ha a nem található helyszín 404 helyett üres kimutatást adna; ha a nézet nem jutna el a
  számításig (a partner nézetben a nevek maradnának).
*/
const SCOPE: OperationsReportScope = {
  siteLabel: "Állatkert · Biodóm",
  assets: [{ id: "a1", label: "E-1 Szűrő", categoryId: "c1" }],
  entryFilter: { departmentIds: ["d1", "d2"] },
};

function fixture(over: { scope?: OperationsReportScope | null } = {}) {
  const calls: {
    window?: [Date, Date];
    filters: OperationsReportEntryFilter[];
  } = { filters: [] };
  const entry: OperationsReportEntryInput = {
    id: "e1",
    templateId: "t1",
    templateName: "Visszamosás",
    frequency: "WEEKLY",
    assetId: "a1",
    assetLabel: "E-1 Szűrő",
    startedAt: "2026-11-12T09:00:00.000Z",
    finishedAt: "2026-11-12T09:30:00.000Z",
    participantNames: ["Kovács Béla"],
    anomaly: false,
    anomalyNote: null,
    serviceJob: null,
    values: [],
  };
  const repository = {
    scope: async () => (over.scope === undefined ? SCOPE : over.scope),
    entries: async (
      filter: OperationsReportEntryFilter,
      from: Date,
      to: Date,
    ) => {
      calls.filters.push(filter);
      calls.window = [from, to];
      return [entry];
    },
    schedules: async (): Promise<OperationsReportScheduleInput[]> => [],
  } as unknown as OperationsReportRepository;
  return { service: new OperationsReportService(repository), calls };
}

const NOW = new Date("2026-11-20T09:00:00.000Z");

describe("a havi kimutatás szolgáltatása", () => {
  it("helyszínre készül: a hónap és a hét nap, a hatókör eszközei, a számítás eredménye", async () => {
    const { service, calls } = fixture();
    const result = await service.build(
      { month: "2026-11", departmentId: "d1" },
      "INTERNAL",
      NOW,
    );
    assert.equal(result.siteLabel, "Állatkert · Biodóm");
    assert.equal(result.generatedAt, NOW.toISOString());
    assert.equal(result.report.totals.entries, 1);
    // a sorok a rögzítéskori helyszín szerint, a „teljesült-e" az élő eszközök minden bejegyzése szerint
    assert.deepEqual(calls.filters, [
      { departmentIds: ["d1", "d2"] },
      { assetIds: ["a1"] },
    ]);
    // az ablak a hónap elé hét nappal kezdődik (budapesti november 1. 00:00 = október 31. 23:00 UTC), a hónap végéig tart
    assert.equal(calls.window![0].toISOString(), "2026-10-24T23:00:00.000Z");
    assert.equal(calls.window![1].toISOString(), "2026-11-30T23:00:00.000Z");
  });

  it("a partner nézet a nevek helyett Acropora-t ad", async () => {
    const { service } = fixture();
    const result = await service.build(
      { month: "2026-11", assetId: "a1" },
      "PARTNER",
      NOW,
    );
    assert.deepEqual(result.report.assets[0]!.entries[0]!.performers, [
      "Acropora",
    ]);
  });

  it("hibás hónap, hatókör nélkül és mindkét hatókörrel 400, ismeretlen helyszín és eszköz 404", async () => {
    const { service } = fixture();
    await assert.rejects(
      () =>
        service.build(
          { month: "2026-13", departmentId: "d1" },
          "INTERNAL",
          NOW,
        ),
      BadRequestException,
    );
    await assert.rejects(
      () => service.build({ month: "2026-11" }, "INTERNAL", NOW),
      /helyszínt vagy az eszközt/,
    );
    await assert.rejects(
      () =>
        service.build(
          { month: "2026-11", departmentId: "d1", assetId: "a1" },
          "INTERNAL",
          NOW,
        ),
      /VAGY eszközre/,
    );
    const missing = fixture({ scope: null }).service;
    await assert.rejects(
      () =>
        missing.build({ month: "2026-11", departmentId: "x" }, "INTERNAL", NOW),
      (error: Error) =>
        error instanceof NotFoundException && /helyszín/.test(error.message),
    );
    await assert.rejects(
      () => missing.build({ month: "2026-11", assetId: "x" }, "INTERNAL", NOW),
      (error: Error) =>
        error instanceof NotFoundException && /eszköz/.test(error.message),
    );
  });
});
