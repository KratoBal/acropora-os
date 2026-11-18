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
  A SIKERTELEN LÉTREHOZÁS VISSZAVONÁSA (kártya f1c14dcb, acrobot 56144 és 56153): ha a karbantartási lap létrehozása közben a szerződés alkalomkeretét egy párhuzamos foglalás elviszi, a lap és a
  munkalap-piszkozatai már léteznek. A visszavonás eddig a FELHASZNÁLÓI lezárási kapun (`move` CANCELLED) akadt el: a frissen létrehozott piszkozatok átadása nincs rögzítve, a hívó a keret 409-e
  helyett a kapu hibajegy-szavas 400-át kapta, és egy tételsor nélküli, nyitott lap maradt. MOSTANTÓL a rendszer saját visszavonása külön út (`cancelFailedCreation`): nem esik a felhasználói
  kapu alá (a lap másodperce jött létre, gép nem érkezett), a lap LEMONDVA marad (acrobot: nyom marad róla), az érintetlen piszkozatok el vannak rejtve, a hívó a keret 409-ét kapja.

  A TESZT A VALÓDI `ServiceJobsService`-t futtatja (a tárolója dupla), így a felhasználói kapu is a valódi.
  MI PIROSÍT: ha a visszavonás újra a felhasználói kapun át megy (400 a 409 helyett); ha a lap nem mondódik le; ha a megjegyzés elveszik; ha a felhasználói `move` CANCELLED kapuja gyengül;
  ha egy közben másik állapotba lépett lapot a visszavonás átírja; ha a már lemondott lapon a visszavonás újra ír.
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

function world(status: string = "NEW") {
  const moved: unknown[] = [];
  const cancelled: Array<{ id: string; note: string; actorUserId: string }> =
    [];
  const createdSheets: unknown[] = [];
  const jobRepository = {
    statusOf: async () => status,
    kindOf: async () => "MAINTENANCE",
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
    cancelFailedCreation: async (input: {
      id: string;
      note: string;
      actorUserId: string;
    }) => {
      cancelled.push(input);
      return { ok: true as const, hiddenSheets: 1 };
    },
  } as unknown as ServiceJobsRepository;
  const realJobs = new ServiceJobsService(jobRepository);
  const serviceJobs = {
    create: async () => ({ id: "job-1", jobNumber: "KT-2026-001" }),
    cancelFailedCreation: realJobs.cancelFailedCreation.bind(realJobs),
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
    realJobs,
    moved,
    cancelled,
    createdSheets,
  };
}

const dto = {
  contractId: "contract-1",
  itemIds: ["item-1"],
  clientOperationId: "k1",
} as never;

describe("a karbantartási lap létrehozása, ha a foglalás a lap létrehozása után bukik", () => {
  it("a visszavonás nem akad el a lezárási kapun: a hívó a keret 409-ét kapja, a lap lemondva marad a megjegyzéssel", async () => {
    const { service, moved, cancelled, createdSheets } = world();

    await assert.rejects(
      () => service.createJobFromContract(dto, ACTOR),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match(
          error.message,
          /elfogyott az évi alkalomkeret: Cápasuli RO karbantartás/,
        );
        return true;
      },
    );
    assert.equal(createdSheets.length, 1);
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0]?.id, "job-1");
    assert.equal(cancelled[0]?.actorUserId, "user-1");
    assert.match(cancelled[0]?.note ?? "", /tételek nélkül lemondva/);
    // a felhasználói út (`move`) nem futott
    assert.deepEqual(moved, []);
  });

  it("a felhasználói CANCELLED lépés kapuja változatlan: aláíratlan, át nem adott piszkozat mellett 400", async () => {
    const { realJobs, moved } = world();
    await assert.rejects(
      () =>
        realJobs.move("job-1", { to: "CANCELLED" } as never, "user-1", ACTOR),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /Az átadás nincs rögzítve/.test(error.message),
    );
    assert.deepEqual(moved, []);
  });

  it("ha a lap közben másik állapotba lépett, a visszavonás nem írja át, a hívó így is a keret 409-ét kapja", async () => {
    const { service, cancelled } = world("IN_PROGRESS");
    await assert.rejects(
      () => service.createJobFromContract(dto, ACTOR),
      ConflictException,
    );
    assert.deepEqual(cancelled, []);
  });

  it("a már lemondott lapon a visszavonás nem ír újra", async () => {
    const { service, cancelled } = world("CANCELLED");
    await assert.rejects(
      () => service.createJobFromContract(dto, ACTOR),
      ConflictException,
    );
    assert.deepEqual(cancelled, []);
  });
});
