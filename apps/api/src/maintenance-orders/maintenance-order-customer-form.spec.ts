import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { UploadCustomerFormDto, itemIdsFromMultipart } from "./dto.js";
import { nextMaintenanceOrderNumber } from "./maintenance-order-number.js";
import { maintenanceOrderOccasionYear } from "./maintenance-order-occasion-year.js";
import { MaintenanceOrdersService } from "./maintenance-orders.service.js";

/**
 * A VEVŐ SAJÁT MEGRENDELŐLAPJA (karbantartási felmérés S6), adatbázis nélkül:
 * a repository és a két szolgáltatás helyén hamis objektumok, mint a
 * `maintenance-orders.service.spec.ts`-ben.
 *
 * MI PIROSÍT: ha a vevői lap más szabályon megy át, mint a kiállítás (javítási
 * szerződés, nem PDF); ha az alkalomkeret vagy egy kettős beküldés után mégis
 * létrejön a sor; ha a lap és a munkalapok nem az aláírás-út kulcsaival jönnek
 * létre (egy újrafuttatás ekkor új sort hozna); ha a vevő PDF-je az aláírt
 * példány helyére is mentődne.
 */

const ACTOR = {
  id: "user-1",
  displayName: "Kovács Anna",
  role: "MANAGER",
} as AuthenticatedUser;

const PDF = {
  mimetype: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 vevo megrendelolapja"),
  originalname: "vevo-megrendelolap.pdf",
  size: 29,
} as Express.Multer.File;

function contract(kind: "MAINTENANCE" | "PURCHASE" | "REPAIR" = "MAINTENANCE") {
  return {
    id: "contract-1",
    number: "SZ2026/0000019",
    title: "Vízgépészet karbantartása",
    status: "ACTIVE",
    kind,
    customer: { id: "customer-1", displayName: "Fővárosi Állatkert" },
    items: [
      {
        id: "item-1",
        position: 1,
        description: "Cápasuli RO karbantartás",
        unitNet: new Prisma.Decimal("410000"),
        quantity: new Prisma.Decimal("1"),
        occasionsPerYear: 4,
        vatRatePercent: new Prisma.Decimal("27"),
        departmentId: "kismedence",
      },
    ],
  };
}

function wire(overrides: Record<string, unknown> = {}) {
  const calls = {
    created: [] as Array<Record<string, unknown>>,
    saveSigned: 0,
    job: undefined as Record<string, unknown> | undefined,
    worksheets: [] as Array<Record<string, unknown>>,
    attached: undefined as [string, string] | undefined,
    reserved: 0,
  };
  const repository = {
    contractForIssuance: async () => contract(),
    departmentTree: async (ids: readonly string[]) =>
      ids.map((id) => ({ id, name: id, parentId: null })),
    departmentPaths: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, [id]])),
    lastNumberOfYear: async () => null,
    reserveOccasions: async (
      _input: unknown,
      write: (tx: unknown) => Promise<unknown>,
    ) => {
      calls.reserved += 1;
      return { ok: true, value: await write({}) };
    },
    customerFormDuplicate: async () => null,
    createCustomerForm: async (input: Record<string, unknown>) => {
      calls.created.push(input);
      return { id: "order-9", ...input };
    },
    // az S3 folytatási ága ezt olvassa vissza: SIGNED, lap nélkül
    detail: async () => ({
      id: "order-9",
      number: "MR-2026-001",
      status: "SIGNED",
      serviceJobId: null,
      contract: {
        id: "contract-1",
        title: "Vízgépészet karbantartása",
        customerId: "customer-1",
      },
      items: [
        {
          description: "Cápasuli RO karbantartás",
          quantity: new Prisma.Decimal("1"),
          contractItem: { id: "item-1", departmentId: "kismedence" },
        },
      ],
    }),
    itemAssetsBySite: async () =>
      new Map([["item-1", { onSite: ["szivattyu"], outside: [] }]]),
    saveSignedDocumentAndMarkSigned: async () => {
      calls.saveSigned += 1;
    },
    attachServiceJob: async (id: string, serviceJobId: string) => {
      calls.attached = [id, serviceJobId];
      return { id, status: "SIGNED", serviceJobId };
    },
    ...overrides,
  };
  const service = new MaintenanceOrdersService(
    repository as never,
    {
      create: async (input: Record<string, unknown>) => {
        calls.job = input;
        return { id: "job-9" };
      },
    } as never,
    {
      create: async (input: Record<string, unknown>) => {
        calls.worksheets.push(input);
        return { id: "worksheet-9" };
      },
    } as never,
  );
  return { service, calls };
}

const DTO = { contractId: "contract-1", itemIds: ["item-1"] };

describe("MaintenanceOrdersService.uploadCustomerForm", () => {
  it("a sort a szerződésből építi, és a lapot az aláírás-út kulcsaival hozza létre", async () => {
    const { service, calls } = wire();
    const result = await service.uploadCustomerForm(DTO, PDF, ACTOR);

    assert.equal(calls.created.length, 1);
    const created = calls.created[0]!;
    assert.equal(
      created.number,
      nextMaintenanceOrderNumber({
        year: maintenanceOrderOccasionYear(new Date()),
        lastNumber: null,
      }),
    );
    assert.equal(created.contractId, "contract-1");
    assert.equal(created.issuedByName, "Kovács Anna");
    assert.deepEqual(created.document, {
      fileName: "vevo-megrendelolap.pdf",
      contentType: "application/pdf",
      content: PDF.buffer,
    });
    assert.deepEqual(
      (created.items as Array<{ contractItemId: string }>).map(
        (item) => item.contractItemId,
      ),
      ["item-1"],
    );

    // a vevő PDF-je nem lesz egyben "aláírt példány" is
    assert.equal(calls.saveSigned, 0);
    assert.equal(
      calls.job?.clientOperationId,
      "maintenance-order-order-9-signed",
    );
    assert.deepEqual(calls.job?.assetIds, ["szivattyu"]);
    assert.deepEqual(
      calls.worksheets.map((w) => w.clientOperationId),
      ["maintenance-order-order-9-worksheet-item-1"],
    );
    assert.deepEqual(calls.attached, ["order-9", "job-9"]);
    assert.equal((result as { serviceJobId: string }).serviceJobId, "job-9");
  });

  it("ugyanaz a szerződés-szabály, mint a kiállításnál: javítási szerződésre nem", async () => {
    const { service, calls } = wire({
      contractForIssuance: async () => contract("REPAIR"),
    });
    await assert.rejects(
      () => service.uploadCustomerForm(DTO, PDF, ACTOR),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("Javítási szerződésre"),
    );
    assert.equal(calls.reserved, 0);
    assert.equal(calls.created.length, 0);
  });

  it("csak valódi PDF: más fájlnál semmi nem jön létre", async () => {
    const { service, calls } = wire();
    await assert.rejects(
      () =>
        service.uploadCustomerForm(
          DTO,
          {
            ...PDF,
            buffer: Buffer.from("<html>"),
            mimetype: "application/pdf",
          },
          ACTOR,
        ),
      BadRequestException,
    );
    assert.equal(calls.reserved, 0);
    assert.equal(calls.created.length, 0);
  });

  it("elfogyott alkalomkeretnél 409, és sor nem jön létre", async () => {
    const { service, calls } = wire({
      reserveOccasions: async () => ({
        ok: false,
        exhausted: ["Cápasuli RO karbantartás"],
      }),
    });
    await assert.rejects(
      () => service.uploadCustomerForm(DTO, PDF, ACTOR),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes("elfogyott az évi alkalomkeret") &&
        error.message.includes("Cápasuli RO karbantartás"),
    );
    assert.equal(calls.created.length, 0);
    assert.equal(calls.job, undefined);
  });

  it("ugyanaz a PDF ugyanazokra a tételekre másodszor: 409 a meglévő számmal, új sor és lap nélkül", async () => {
    let asked: unknown;
    const { service, calls } = wire({
      customerFormDuplicate: async (input: unknown) => {
        asked = input;
        return "MR-2026-007";
      },
    });
    await assert.rejects(
      () => service.uploadCustomerForm(DTO, PDF, ACTOR),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes("MR-2026-007"),
    );
    assert.deepEqual(asked, {
      contractId: "contract-1",
      itemIds: ["item-1"],
      content: PDF.buffer,
    });
    assert.equal(calls.created.length, 0);
    assert.equal(calls.job, undefined);
  });

  it("a szám-versenyhelyzet (P2002) magyar 409, mint a kiállításnál", async () => {
    const { service } = wire({
      reserveOccasions: async () => {
        throw new Prisma.PrismaClientKnownRequestError("unique", {
          code: "P2002",
          clientVersion: "test",
        });
      },
    });
    await assert.rejects(
      () => service.uploadCustomerForm(DTO, PDF, ACTOR),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes("időközben már kiosztásra került"),
    );
  });
});

describe("UploadCustomerFormDto: az itemIds multipart-ban", () => {
  const check = async (itemIds: unknown) => {
    const dto = plainToInstance(UploadCustomerFormDto, {
      contractId: "contract-1",
      itemIds,
    });
    return { dto, errors: await validate(dto) };
  };

  it("ismételt mező (tömb), JSON-tömb és egyetlen érték ugyanarra a tömbre fordul", async () => {
    for (const [input, expected] of [
      [
        ["a", "b"],
        ["a", "b"],
      ],
      ['["a","b"]', ["a", "b"]],
      ["a", ["a"]],
    ] as const) {
      const { dto, errors } = await check(input);
      assert.deepEqual(errors, [], `hiba erre: ${JSON.stringify(input)}`);
      assert.deepEqual(dto.itemIds, expected);
    }
  });

  it("üres tömb, hibás JSON és nem szöveg elem elutasítva", async () => {
    for (const input of ["[]", "[a", "[1,2]"]) {
      const { errors } = await check(input);
      assert.ok(errors.length > 0, `átment: ${input}`);
    }
  });

  it("a nem tömb, nem szöveg bemenet nem alakul át", () => {
    assert.equal(itemIdsFromMultipart(7), 7);
  });
});
