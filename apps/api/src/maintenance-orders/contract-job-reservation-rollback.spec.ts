import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { ServiceJobsRepository } from "../service-jobs/service-jobs.repository.js";
import { ServiceJobsService } from "../service-jobs/service-jobs.service.js";
import type { WorksheetsService } from "../worksheets/worksheets.service.js";
import type { MaintenanceOrdersRepository } from "./maintenance-orders.repository.js";
import { MaintenanceOrdersService } from "./maintenance-orders.service.js";

/*
  MÉRÉS, KÓDMÓDOSÍTÁS NÉLKÜL (kártya f1c14dcb, acrobot 56144): mi történik MA, ha a karbantartási lap létrehozása közben a szerződés alkalomkeretét egy párhuzamos foglalás elviszi.

  A menet (`createOneContractJob`): előellenőrzés (átmegy) -> a lap és a tételenkénti munkalapok LÉTREJÖNNEK -> a tételsorok foglalása a zár alatt, ELBUKIK -> a szolgáltatás a BELSŐ
  visszavonást hívja: `serviceJobs.move(id, CANCELLED)`, majd 409-et dob a keretről. A `move` viszont a FELHASZNÁLÓI lezárási kaput is futtatja (`requireClosableWorksheets`): a CANCELLED lépéshez
  minden munkalap átadása rögzítve kell legyen, a frissen létrehozott piszkozatoké pedig nincs.

  A TESZT A VALÓDI `ServiceJobsService.move`-ot futtatja, csak a tárolója és a lap/munkalap létrehozás (a kapu előtti rész) dupla.

  MA, MÉRVE: a visszavonás elbukik a kapun (400, "Ez a hibajegy nem állítható elállt állapotba. Az átadás nincs rögzítve: ..."), a hívó a 409 helyett EZT kapja, a lap állapota NEM változik
  (a tároló `move`-ja nem fut), és a munkalap-piszkozatok megmaradnak: egy tételek nélküli, nyitott karbantartási lap marad, amit senki nem kért. Ez a teszt a MAI viselkedést rögzíti; a
  javítás átírja (a helyes viselkedés a kártya leírásában, acrobot jóváhagyásával).
*/
const ACTOR = { id: "user-1" } as AuthenticatedUser;
const ITEM = {
  id: "item-1",
  departmentId: "dep-1",
  description: "Cápasuli RO karbantartás",
  quantity: new Prisma.Decimal(1),
  occasionsPerYear: 4,
  unitNet: new Prisma.Decimal(10000),
  vatRatePercent: 27,
};

function world() {
  const moved: unknown[] = [];
  const createdSheets: unknown[] = [];
  const jobRepository = {
    statusOf: async () => "NEW",
    // a frissen létrehozott piszkozat-munkalap: nincs aláírva, az átadás nincs rögzítve
    worksheetSignatureStates: async () => [
      {
        id: "ws-1",
        number: null,
        hiddenAt: null,
        handedOverAt: null,
        versions: [{ status: "DRAFT" }],
      },
    ],
    move: async (input: unknown) => {
      moved.push(input);
      return { ok: true };
    },
  } as unknown as ServiceJobsRepository;
  const realJobs = new ServiceJobsService(jobRepository);
  const serviceJobs = {
    create: async () => ({ id: "job-1", jobNumber: "KT-2026-001" }),
    move: realJobs.move.bind(realJobs),
  } as unknown as ServiceJobsService;
  const worksheets = {
    create: async (input: unknown) => {
      createdSheets.push(input);
      return { id: "ws-1" };
    },
  } as unknown as WorksheetsService;

  let reservations = 0;
  const repository = {
    contractForIssuance: async () => ({
      id: "contract-1",
      status: "ACTIVE",
      kind: "MAINTENANCE",
      title: "Éves karbantartás",
      customer: { id: "customer-1" },
      items: [ITEM],
    }),
    // a lap kulcs alatt még nincs; a létrehozás után már van, tételsor nélkül
    serviceJobContractItemState: async (where: object) =>
      "clientOperationId" in where
        ? null
        : {
            id: "job-1",
            createdAt: new Date("2026-11-18T10:00:00Z"),
            status: "NEW",
            contractId: "contract-1",
            itemCount: 0,
          },
    itemAssetsBySite: async () => new Map(),
    // az előellenőrzés átmegy, a foglalás a lap létrehozása UTÁN elbukik (egy párhuzamos foglalás elvitte az alkalmat)
    reserveOccasions: async () => {
      reservations += 1;
      return reservations === 1
        ? { ok: true as const, value: null }
        : { ok: false as const, exhausted: [ITEM.description], short: [] };
    },
  } as unknown as MaintenanceOrdersRepository;
  return {
    service: new MaintenanceOrdersService(repository, serviceJobs, worksheets),
    moved,
    createdSheets,
  };
}

describe("a karbantartási lap létrehozása, ha a foglalás a lap létrehozása után bukik", () => {
  it("MA: a belső visszavonás a lezárási kapun akad el, a hívó a kapu mondatát kapja a keret 409-e helyett, a lap nem mondódik le", async () => {
    const { service, moved, createdSheets } = world();

    await assert.rejects(
      () =>
        service.createJobFromContract(
          {
            contractId: "contract-1",
            itemIds: ["item-1"],
            clientOperationId: "k1",
          } as never,
          ACTOR,
        ),
      (error: unknown) => {
        // a kapu mondata, nem a keret 409-e
        assert.ok(error instanceof BadRequestException);
        assert.ok(!(error instanceof ConflictException));
        assert.match(
          error.message,
          /Ez a hibajegy nem állítható elállt állapotba\. Az átadás nincs rögzítve: szám nélküli munkalap/,
        );
        return true;
      },
    );
    // a munkalap-piszkozat létrejött, a lap állapota viszont nem változott
    assert.equal(createdSheets.length, 1);
    assert.deepEqual(moved, []);
  });
});
