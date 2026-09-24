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
   * A LELET: a repository tételenként upsertel id szerint
   * (`contracts.repository.ts` `update()`, 2026-09-24-től). Ha a küldött
   * listából KIMARAD egy tétel, amihez már készült megrendelőlap
   * (`MaintenanceOrderItem.contractItemId`, `onDelete: Restrict`), a
   * TÖRLÉSE a Postgres-idegenkulcs-megkötésen akad el (P2003). Ez a fake
   * repository szintjén nem tesz különbséget "minden mentés" és "valódi
   * törlési szándék" között -- azt a `contracts-item-integrity.integration.spec.ts`
   * méri valódi adatbázison.
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

  /**
   * MURENA LELETE, STAGING (79d793aa): egy tétel NÉLKÜLI PATCH (pl. csak a
   * cím vagy az állapot módosul) egy már megrendelőlapos szerződésen a
   * `normalize()` `patch.items ?? existing.items.map(...)` ágán megy át --
   * ez a MEGLÉVŐ tételek `id`-jét viszi tovább (lásd fent az `id: item.id`
   * sort), tehát a repository upsert-ágon MINDET frissítésként ismeri fel,
   * egyet sem töröl, és nincs P2003. Ez a teszt ezt rögzíti: a fake
   * repository a kapott `items`-et visszaadja, és itt azt mérjük, hogy a
   * MEGLÉVŐ tétel `id`-je változatlanul megérkezik hozzá.
   */
  it("tétel nélküli PATCH-nél a MEGLÉVŐ tétel id-jét változatlanul küldi tovább a repositorynak", async () => {
    let receivedItems: Array<{ id?: string }> = [];
    const { service } = makeService({
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
        items: [
          {
            id: "item-1",
            description: "Cápasuli RO karbantartás",
            unitNet: new Prisma.Decimal("410000"),
            quantity: new Prisma.Decimal("1"),
            occasionsPerYear: 4,
            vatRatePercent: new Prisma.Decimal("27"),
            departmentId: null,
            assets: [],
          },
        ],
      }),
      update: async (id: string, input: { items: Array<{ id?: string }> }) => {
        receivedItems = input.items;
        return { id, ...input };
      },
    });

    const result = await service.update("contract-1", {
      status: "TERMINATED",
    } as UpdateContractDto);

    assert.equal((result as { id: string }).id, "contract-1");
    assert.equal(receivedItems.length, 1);
    assert.equal(receivedItems[0]!.id, "item-1");
  });
});
