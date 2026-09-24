import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { ContractsService } from "./contracts.service.js";
import type { CreateContractDto, UpdateContractDto } from "./dto.js";

/**
 * A SZOLGÁLTATÁS SAJÁT (VALÓDI ADATBÁZIS NÉLKÜLI) TESZTJEI -- eddig nem
 * létezett ilyen fájl (lásd a `maintenance-orders.service.spec.ts` fejlécét,
 * ami ezt a hiányt kifejezetten megnevezi).
 */

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code,
    clientVersion: "6.19.3",
  });
}

const CREATE_INPUT: CreateContractDto = {
  customerId: "customer-1",
  number: "SZ2026/0000019",
  title: "Vízgépészet karbantartása",
  validFrom: "2026-01-01",
  items: [
    {
      description: "Cápasuli RO karbantartás",
      unitNet: "410000",
      quantity: "1",
      occasionsPerYear: 4,
      vatRatePercent: "27",
    },
  ],
} as CreateContractDto;

function fakeRepository(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    customerExists: async () => true,
    departmentBelongsToCustomer: async () => true,
    assetsBelongToCustomer: async (assetIds: string[]) => assetIds,
    create: async (input: unknown) => ({
      id: "contract-1",
      ...(input as object),
    }),
    update: async (id: string, input: unknown) => ({
      id,
      ...(input as object),
    }),
    detail: async () => ({
      id: "contract-1",
      customerId: "customer-1",
      number: "SZ2026/0000019",
      title: "Vízgépészet karbantartása",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: null,
      status: "ACTIVE",
      notes: null,
      organizationalUnitName: null,
      contactPersonName: null,
      items: [],
    }),
    ...overrides,
  };
}

function makeService(
  repositoryOverrides: Partial<Record<string, unknown>> = {},
) {
  const repository = fakeRepository(repositoryOverrides);
  return { service: new ContractsService(repository as never), repository };
}

describe("ContractsService.create", () => {
  it("POZITÍV KONTROLL: érvényes bemenetre létrehozza a szerződést", async () => {
    const { service } = makeService();
    const result = await service.create(CREATE_INPUT);
    assert.equal((result as { id: string }).id, "contract-1");
  });
});

describe("ContractsService.update", () => {
  const PATCH: UpdateContractDto = {
    number: "SZ2026/0000019",
  } as UpdateContractDto;

  it("POZITÍV KONTROLL: érvényes bemenetre frissíti a szerződést", async () => {
    const { service } = makeService();
    const result = await service.update("contract-1", PATCH);
    assert.equal((result as { id: string }).id, "contract-1");
  });

  /**
   * A LELET: a repository MINDEN mentéskor törli és újraépíti a
   * tételeket (`contracts.repository.ts` `update()`). Ha egy tételhez
   * már készült megrendelőlap (`MaintenanceOrderItem.contractItemId`,
   * `onDelete: Restrict`), a törlés a Postgres-idegenkulcs-megkötésen
   * akad el (P2003) -- ez a helyszín/eszköz-szerkesztő beépítésekor
   * derült ki (2026-09-24), mert a webes szerkesztő mostantól mindig
   * küld `items`-t.
   */
  it("P2003-ra 409-et dob magyarul, ha a tételekhez már készült megrendelőlap", async () => {
    const { service } = makeService({
      update: async () => {
        throw prismaError("P2003");
      },
    });
    await assert.rejects(
      () => service.update("contract-1", PATCH),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error as Error).message.includes("már készült megrendelőlap"),
    );
  });

  it("egy ismeretlen hibát változatlanul továbbdob", async () => {
    const { service } = makeService({
      update: async () => {
        throw new Error("VALAMI MÁS HIBA");
      },
    });
    await assert.rejects(
      () => service.update("contract-1", PATCH),
      /VALAMI MÁS HIBA/,
    );
  });
});
