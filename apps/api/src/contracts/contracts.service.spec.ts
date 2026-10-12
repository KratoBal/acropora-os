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
 *
 * A KAPU: Balázs éles hibája (2026-09-24 20:31, acrobot kártyája 31f8c5b4).
 * Egy már létező szerződésszámmal próbált menteni, és a nyers P2002 helyett
 * csak "A kérés feldolgozása nem sikerült" jelent meg -- a `create()`-en a
 * hiba részben el volt kapva (a szám nem volt benne az üzenetben), az
 * `update()`-en EGYÁLTALÁN NEM volt elkapva.
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
    invoiceCount: async () => 0,
    maintenanceOrderCount: async () => 0,
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

  it("P2002-re 409-et dob, a szerződésszámmal az üzenetben", async () => {
    const { service } = makeService({
      create: async () => {
        throw prismaError("P2002");
      },
    });
    await assert.rejects(
      () => service.create(CREATE_INPUT),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error as Error).message.includes("SZ2026/0000019"),
    );
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

  /**
   * EZ AZ ÁG EDDIG HIÁNYZOTT: a `create()`-en már volt valamilyen P2002-
   * kezelés, az `update()`-en semmi -- egy szerkesztéskor beütött duplikált
   * szám nyers Prisma-hibaként futott volna tovább.
   */
  it("P2002-re 409-et dob, a szerződésszámmal az üzenetben", async () => {
    const { service } = makeService({
      update: async () => {
        throw prismaError("P2002");
      },
    });
    await assert.rejects(
      () => service.update("contract-1", PATCH),
      (error: unknown) =>
        error instanceof ConflictException &&
        (error as Error).message.includes("SZ2026/0000019"),
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

/*
  A SZERZŐDÉS FAJTÁJA (hétfői lista M4). MI PIROSÍT: ha a beszerzési tétel
  megtartaná az alkalmat, a helyszínt, az eszközt vagy a javítási díjat; ha
  mennyiségi egység nélkül, vagy ismeretlennel menthető lenne; ha a
  karbantartási tétel alkalom nélkül menthető lenne; ha egy megrendelőlappal
  bíró szerződés átállhatna Beszerzésre.
*/
describe("ContractsService, a fajta", () => {
  const PURCHASE_ITEM = {
    description: "Tengeri só, 25 kg",
    unitNet: "18000",
    quantity: "4",
    vatRatePercent: "27",
    unitOfMeasureId: "uom-zsak",
    // egy karbantartási változatból maradt mezők: ezek nem maradhatnak meg
    occasionsPerYear: 4,
    departmentId: "dep-1",
    assetIds: ["asset-1"],
    repairWeight: "90",
  };
  const purchaseInput = (item: Record<string, unknown>) =>
    ({
      ...CREATE_INPUT,
      kind: "PURCHASE",
      items: [item],
    }) as unknown as CreateContractDto;
  const outcome = (run: () => Promise<unknown>) =>
    run().then(
      (stored) => stored,
      (error: { status?: number; message: string }) =>
        `${error.status}: ${error.message}`,
    );

  it("CONTRACT-KIND-NORMALIZE: a beszerzési tétel csak a saját mezőit tartja meg", async () => {
    let stored: { kind?: string; items?: Record<string, unknown>[] } = {};
    const { service } = makeService({
      quantityUnitIds: async (ids: string[]) =>
        new Set(ids.filter((id) => id === "uom-zsak")),
      create: async (input: typeof stored) => {
        stored = input;
        return { id: "contract-2" };
      },
    });
    const results = [
      await outcome(() => service.create(purchaseInput(PURCHASE_ITEM))),
      await outcome(() =>
        service.create(
          purchaseInput({ ...PURCHASE_ITEM, unitOfMeasureId: undefined }),
        ),
      ),
      await outcome(() =>
        service.create(
          purchaseInput({ ...PURCHASE_ITEM, unitOfMeasureId: "uom-mg-l" }),
        ),
      ),
      await outcome(() =>
        service.create({
          ...CREATE_INPUT,
          items: [{ ...CREATE_INPUT.items[0]!, occasionsPerYear: undefined }],
        } as CreateContractDto),
      ),
    ];
    const item = stored.items?.[0] ?? {};
    assert.deepEqual(
      {
        results,
        kind: stored.kind,
        item: [
          item.occasionsPerYear,
          item.unitOfMeasureId,
          item.departmentId,
          item.assetIds,
          item.repairWeight,
          String(item.quantity),
        ],
      },
      {
        results: [
          { id: "contract-2" },
          "400: A beszerzési tételnél a mennyiségi egység kötelező: Tengeri só, 25 kg.",
          "400: Ismeretlen mennyiségi egység: Tengeri só, 25 kg.",
          "400: A karbantartási tételnél az alkalom / év kötelező: Cápasuli RO karbantartás.",
        ],
        kind: "PURCHASE",
        item: [null, "uom-zsak", null, [], null, "4"],
      },
      "CONTRACT-KIND-NORMALIZE",
    );
  });

  it("CONTRACT-KIND-SWITCH-409: megrendelőlap után nem állhat át Beszerzésre", async () => {
    const switchTo = (orders: number) => {
      const { service } = makeService({
        maintenanceOrderCount: async () => orders,
        quantityUnitIds: async (ids: string[]) => new Set(ids),
      });
      return outcome(() =>
        service.update("contract-1", {
          kind: "PURCHASE",
          items: [PURCHASE_ITEM],
        } as unknown as UpdateContractDto),
      );
    };
    const [blocked, allowed] = [await switchTo(1), await switchTo(0)];
    assert.deepEqual(
      [blocked, (allowed as { kind?: string }).kind],
      [
        "409: Ehhez a szerződéshez már készült karbantartási megrendelőlap, ezért nem állítható át Beszerzésre.",
        "PURCHASE",
      ],
      "CONTRACT-KIND-SWITCH-409",
    );
  });

  it("CONTRACT-KIND-BACK-409: számla után a beszerzési nem lesz újra karbantartási", async () => {
    const back = (invoices: number) => {
      const { service } = makeService({
        invoiceCount: async () => invoices,
        detail: async () => ({
          ...(await fakeRepository().detail()),
          kind: "PURCHASE",
        }),
      });
      return outcome(() =>
        service.update("contract-1", {
          kind: "MAINTENANCE",
          items: [CREATE_INPUT.items[0]],
        } as unknown as UpdateContractDto),
      );
    };
    const [blocked, allowed] = [await back(1), await back(0)];
    assert.deepEqual(
      [blocked, (allowed as { kind?: string }).kind],
      [
        "409: Ebből a szerződésből már készült számla, ezért nem állítható vissza Karbantartásra.",
        "MAINTENANCE",
      ],
      "CONTRACT-KIND-BACK-409",
    );
  });
});
