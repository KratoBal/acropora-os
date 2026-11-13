import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type {
  OperationsLogEntryDto,
  OperationsLogEntryInput,
  OperationsTaskFieldDto,
  OperationsTaskTemplateDto,
} from "@acropora/types";

import type {
  OperationsLogEntriesRepository,
  OperationsLogEntryWrite,
} from "./operations-log-entries.repository.js";
import { OperationsLogEntriesService } from "./operations-log-entries.service.js";
import type { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import type { OperationsLogRepository } from "./operations-log.repository.js";

/*
  AZ ÜZEMELTETÉSI NAPLÓ BEJEGYZÉSE (task os-uzemeltetesi-naplo, S2a). MI PIROSIT: ha az újraküldés új bejegyzést hozna létre; ha
  más felhasználó kulcsára idegen bejegyzés jönne vissza; ha a sablon nem az eszközre (vagy annak kategóriájára) szóló
  bejegyzés átmenne; ha a mező pillanatfelvétele (címke, típus, egység, vízóra szerep) nem kerülne a tárba; ha a kivezetett
  mező értéke elveszne; ha az üres szöveg tárolódna, vagy a `false` és a `0` nem; ha a rögzítő nem lenne résztvevő; ha a
  nem választható kolléga átmenne; ha a hiányzó kötelező mező, a fordított idő vagy a leírás nélküli rendellenesség átmenne.
*/
const NOW = Date.now();
const iso = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();

function field(
  key: string,
  type: OperationsTaskFieldDto["type"],
  extra: Partial<OperationsTaskFieldDto> = {},
): OperationsTaskFieldDto {
  return {
    id: `f-${key}`,
    key,
    label: `Címke ${key}`,
    type,
    unit: null,
    required: false,
    meterRole: null,
    sortOrder: 0,
    removedAt: null,
    ...extra,
  };
}

function template(
  over: Partial<OperationsTaskTemplateDto> = {},
): OperationsTaskTemplateDto {
  return {
    id: "t1",
    name: "Homokszűrő visszamosás",
    description: null,
    frequency: "WEEKLY",
    target: { kind: "ASSET", assetId: "a1", assetNumber: "E-1", name: "Szűrő" },
    isActive: true,
    fields: [
      field("elotte", "NUMBER", {
        unit: "m3",
        meterRole: "BEFORE",
        required: true,
      }),
      field("rendben", "BOOLEAN"),
      field("megjegyzes", "TEXT"),
    ],
    retiredFields: [field("regi", "NUMBER", { removedAt: iso(5000) })],
    updatedAt: iso(100),
    ...over,
  };
}

function input(
  over: Partial<OperationsLogEntryInput> = {},
): OperationsLogEntryInput {
  return {
    clientOperationId: "op-abcdef01",
    templateId: "t1",
    assetId: "a1",
    templateFieldKeys: ["elotte", "rendben", "megjegyzes"],
    startedAt: iso(30),
    finishedAt: iso(10),
    values: { elotte: 12.5 },
    ...over,
  };
}

function fixture(
  over: Partial<{
    template: OperationsTaskTemplateDto | null;
    asset: {
      id: string;
      categoryId: string | null;
      departmentId?: string | null;
    } | null;
    existing: { entry: OperationsLogEntryDto; recordedById: string } | null;
    raceWinner: { entry: OperationsLogEntryDto; recordedById: string } | null;
    selectable: string[];
    /** A létrehozott bejegyzés rendellenes-e (a tároló válasza). */
    anomalous: boolean;
    ticketFails: boolean;
  }> = {},
) {
  const calls: {
    write?: OperationsLogEntryWrite;
    created: number;
    tickets: { input: Record<string, unknown>; actor: string }[];
    linked: { entryId: string; serviceJobId: string }[];
  } = {
    created: 0,
    tickets: [],
    linked: [],
  };
  const entries = {
    assetRef: async () =>
      over.asset === undefined
        ? { id: "a1", categoryId: "c1", departmentId: "d1" }
        : over.asset,
    byClientOperationId: async () => over.existing ?? null,
    assignableIds: async (ids: readonly string[]) =>
      new Set(ids.filter((id) => (over.selectable ?? ["u2"]).includes(id))),
    create: async (write: OperationsLogEntryWrite, actorId: string) => {
      calls.created += 1;
      calls.write = write;
      if (over.raceWinner) return { ...over.raceWinner, created: false };
      return {
        entry: {
          id: "e1",
          anomaly: over.anomalous === true,
          serviceJob: null,
        } as OperationsLogEntryDto,
        recordedById: actorId,
        created: true,
      };
    },
    ticketContext: async () => ({
      id: "e1",
      anomaly: true,
      anomalyNote: "Szivárog a szelep",
      templateName: "Homokszűrő visszamosás",
      startedAt: new Date("2026-11-13T09:30:00.000Z"),
      serviceJobId: null,
      recordedById: "u1",
      asset: {
        id: "a1",
        assetNumber: "E-1",
        name: "Szűrő",
        department: { customerId: "c9" },
      },
    }),
    linkServiceJob: async (entryId: string, serviceJobId: string) => {
      calls.linked.push({ entryId, serviceJobId });
      return true;
    },
    byId: async () =>
      ({
        id: "e1",
        anomaly: true,
        serviceJob: { id: "sj1", jobNumber: "HJ-2026-0001", status: "NEW" },
      }) as unknown as OperationsLogEntryDto,
  } as unknown as OperationsLogEntriesRepository;
  const serviceJobs = {
    create: async (input: Record<string, unknown>, actor: string) => {
      if (over.ticketFails) throw new Error("jegyszám-hiba");
      calls.tickets.push({ input, actor });
      return { id: "sj1" };
    },
  } as unknown as ServiceJobsService;
  const templates = {
    templateById: async () =>
      over.template === undefined ? template() : over.template,
  } as unknown as OperationsLogRepository;
  return {
    service: new OperationsLogEntriesService(entries, templates, serviceJobs),
    calls,
  };
}

describe("az üzemeltetési napló bejegyzése", () => {
  it("rögzít: pillanatfelvétel, rögzítő mint résztvevő, sablon neve", async () => {
    const { service, calls } = fixture();
    const result = await service.create(
      input({ participantIds: ["u2"], internalNote: "  belső  " }),
      "u1",
    );
    assert.equal(result.created, true);
    const write = calls.write!;
    assert.deepEqual(write.participantIds, ["u1", "u2"]);
    assert.equal(write.templateName, "Homokszűrő visszamosás");
    // a helyszín a rögzítés pillanatában: a kimutatás ezen készül, az áthelyezés a múltat nem mozdítja
    assert.equal(write.departmentId, "d1");
    assert.equal(write.frequency, "WEEKLY");
    assert.equal(write.internalNote, "belső");
    assert.deepEqual(write.values, [
      {
        fieldKey: "elotte",
        fieldType: "NUMBER",
        label: "Címke elotte",
        unit: "m3",
        meterRole: "BEFORE",
        numberValue: 12.5,
        booleanValue: null,
        textValue: null,
      },
    ]);
  });

  it("a false, a 0 érték; az üres szöveg nincs; a kivezetett mező értéke megmarad", async () => {
    const { service, calls } = fixture();
    await service.create(
      input({
        values: {
          elotte: 0,
          rendben: false,
          megjegyzes: "   ",
          regi: 4,
        },
      }),
      "u1",
    );
    const keys = calls.write!.values.map((v) => v.fieldKey);
    assert.deepEqual(keys, ["elotte", "rendben", "regi"]);
    const rendben = calls.write!.values.find((v) => v.fieldKey === "rendben")!;
    assert.equal(rendben.booleanValue, false);
    assert.equal(rendben.numberValue, null);
    assert.equal(
      calls.write!.values.find((v) => v.fieldKey === "elotte")!.numberValue,
      0,
    );
  });

  it("a szöveg érték kivágott alakban tárolódik", async () => {
    const { service, calls } = fixture();
    await service.create(
      input({ values: { elotte: 1, megjegyzes: "  tiszta  " } }),
      "u1",
    );
    assert.equal(
      calls.write!.values.find((v) => v.fieldKey === "megjegyzes")!.textValue,
      "tiszta",
    );
  });

  it("az újraküldés a meglévőt adja, nem újat hoz létre, és a sablon közben változhat", async () => {
    const existing = {
      entry: { id: "e0" } as OperationsLogEntryDto,
      recordedById: "u1",
    };
    const { service, calls } = fixture({ existing, template: null });
    const result = await service.create(input(), "u1");
    assert.deepEqual(result, { entry: existing.entry, created: false });
    assert.equal(calls.created, 0);
  });

  it("más felhasználó kulcsára idegen bejegyzés nem jön vissza (409), versenyhelyzetben sem", async () => {
    const other = {
      entry: { id: "e0" } as OperationsLogEntryDto,
      recordedById: "u9",
    };
    await assert.rejects(
      () => fixture({ existing: other }).service.create(input(), "u1"),
      ConflictException,
    );
    // a két párhuzamos újraküldés közül a vesztes a nyertes sorát kapja
    await assert.rejects(
      () => fixture({ raceWinner: other }).service.create(input(), "u1"),
      ConflictException,
    );
    const same = {
      entry: { id: "e0" } as OperationsLogEntryDto,
      recordedById: "u1",
    };
    const result = await fixture({ raceWinner: same }).service.create(
      input(),
      "u1",
    );
    assert.equal(result.created, false);
  });

  it("ismeretlen sablon és eszköz 404, nem a célra szóló sablon 400", async () => {
    await assert.rejects(
      () => fixture({ template: null }).service.create(input(), "u1"),
      NotFoundException,
    );
    await assert.rejects(
      () => fixture({ asset: null }).service.create(input(), "u1"),
      NotFoundException,
    );
    await assert.rejects(
      () =>
        fixture({ asset: { id: "a2", categoryId: "c1" } }).service.create(
          input({ assetId: "a2" }),
          "u1",
        ),
      BadRequestException,
    );
  });

  it("a kategóriára szóló sablon az azonos kategóriájú eszközre rögzíthető, másikra nem", async () => {
    const byCategory = template({
      target: { kind: "CATEGORY", categoryId: "c1", name: "Szűrők" },
    });
    const ok = fixture({
      template: byCategory,
      asset: { id: "a5", categoryId: "c1" },
    });
    assert.equal(
      (await ok.service.create(input({ assetId: "a5" }), "u1")).created,
      true,
    );
    await assert.rejects(
      () =>
        fixture({
          template: byCategory,
          asset: { id: "a6", categoryId: "c2" },
        }).service.create(input({ assetId: "a6" }), "u1"),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        fixture({
          template: byCategory,
          asset: { id: "a7", categoryId: null },
        }).service.create(input({ assetId: "a7" }), "u1"),
      BadRequestException,
    );
  });

  it("a kivezetett sablonra és eszközre is fogad (a munka megtörtént)", async () => {
    const { service } = fixture({ template: template({ isActive: false }) });
    assert.equal((await service.create(input(), "u1")).created, true);
  });

  it("hibás bemenet 400: hiányzó kötelező, fordított idő, leírás nélküli rendellenesség", async () => {
    const run = (patch: Partial<OperationsLogEntryInput>) =>
      fixture().service.create(input(patch), "u1");
    await assert.rejects(() => run({ values: {} }), /kötelező kitölteni/);
    await assert.rejects(
      () => run({ startedAt: iso(5), finishedAt: iso(20) }),
      /nem lehet a kezdés előtt/,
    );
    await assert.rejects(
      () => run({ anomaly: true, anomalyNote: " " }),
      /leírás kötelező/,
    );
    await assert.rejects(
      () => run({ values: { elotte: 1, kep: 1 } }),
      BadRequestException,
    );
  });

  it("a nem választható kolléga 400, a rögzítő saját magát nem duplázza", async () => {
    await assert.rejects(
      () => fixture().service.create(input({ participantIds: ["u9"] }), "u1"),
      /nem választható kolléga/,
    );
    const { service, calls } = fixture();
    await service.create(input({ participantIds: ["u1", "u2"] }), "u1");
    assert.deepEqual(calls.write!.participantIds, ["u1", "u2"]);
  });

  it("a rendellenesség leírása csak rendellenességnél tárolódik", async () => {
    const { service, calls } = fixture();
    await service.create(
      input({ anomaly: true, anomalyNote: "  Szivárog  " }),
      "u1",
    );
    assert.equal(calls.write!.anomaly, true);
    assert.equal(calls.write!.anomalyNote, "Szivárog");
    await service.create(input(), "u1");
    assert.equal(calls.write!.anomaly, false);
    assert.equal(calls.write!.anomalyNote, null);
  });

  it("a rendellenességből hibajegy nyílik: az eszközhöz, a bejegyzés kulcsával, a rögzítő nevén, és összeköttetik", async () => {
    const { service, calls } = fixture({ anomalous: true });
    const result = await service.create(
      input({ anomaly: true, anomalyNote: "Szivárog a szelep" }),
      "u1",
    );
    assert.equal(calls.tickets.length, 1);
    const ticket = calls.tickets[0]!;
    assert.equal(ticket.actor, "u1");
    assert.equal(ticket.input.originAssetId, "a1");
    // a partner a helyszínből jön, nem az eszköz denormalizált mezőjéből
    assert.equal(ticket.input.customerId, "c9");
    assert.equal(ticket.input.kind, "REPAIR");
    assert.equal(ticket.input.clientOperationId, "ops-anomaly:e1");
    assert.match(
      String(ticket.input.title),
      /^Rendellenesség: Homokszűrő visszamosás, E-1 Szűrő$/,
    );
    assert.match(String(ticket.input.description), /^Szivárog a szelep\n/);
    assert.match(
      String(ticket.input.description),
      /Üzemeltetési napló: Homokszűrő visszamosás/,
    );
    assert.deepEqual(calls.linked, [{ entryId: "e1", serviceJobId: "sj1" }]);
    assert.equal(result.entry.serviceJob?.jobNumber, "HJ-2026-0001");
  });

  it("rendellenesség nélkül nincs hibajegy", async () => {
    const { service, calls } = fixture();
    await service.create(input(), "u1");
    assert.equal(calls.tickets.length, 0);
  });

  it("a jegy nyitásának hibája nem buktatja a rögzítést: a bejegyzés megvan, a jegy nélkül", async () => {
    const { service, calls } = fixture({ anomalous: true, ticketFails: true });
    const result = await service.create(
      input({ anomaly: true, anomalyNote: "Szivárog" }),
      "u1",
    );
    assert.equal(result.created, true);
    assert.equal(result.entry.serviceJob, null);
    assert.equal(calls.linked.length, 0);
  });

  it("az újraküldés a hiányzó jegyet pótolja, a meglévőt nem nyitja újra", async () => {
    const withoutTicket = {
      entry: {
        id: "e1",
        anomaly: true,
        serviceJob: null,
      } as OperationsLogEntryDto,
      recordedById: "u1",
    };
    const healed = fixture({ existing: withoutTicket });
    const result = await healed.service.create(input(), "u1");
    assert.equal(result.created, false);
    assert.equal(healed.calls.tickets.length, 1);
    const withTicket = {
      entry: {
        id: "e1",
        anomaly: true,
        serviceJob: { id: "sj1", jobNumber: "HJ-1", status: "NEW" },
      } as OperationsLogEntryDto,
      recordedById: "u1",
    };
    const complete = fixture({ existing: withTicket });
    await complete.service.create(input(), "u1");
    assert.equal(complete.calls.tickets.length, 0);
  });
});
