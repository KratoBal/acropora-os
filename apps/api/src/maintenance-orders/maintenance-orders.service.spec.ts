import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { MaintenanceOrdersService } from "./maintenance-orders.service.js";

/**
 * A SZOLGÁLTATÁS SAJÁT (VALÓDI ADATBÁZIS NÉLKÜLI) TESZTJEI.
 *
 * Ebben a környezetben nincs élő Postgres (nincs `DATABASE_URL`, nincs
 * `RUN_DB_INTEGRATION`), ugyanúgy, ahogy a `contracts.service.ts`-nek sincs
 * ilyen tesztje -- a valódi adatbázis-integráció a CI dolga. Ez a fájl a
 * repository és a két másik szolgáltatás (`ServiceJobsService`,
 * `WorksheetsService`) helyén egyszerű, kézzel írt hamis objektumokat kap:
 * azt méri, hogy a `MaintenanceOrdersService` a VÁRT sorrendben és a VÁRT
 * feltételekkel hívja őket, nem azt, hogy a lekérdezések ténylegesen
 * lefutnak-e.
 */

const ACTOR: AuthenticatedUser = {
  id: "user-1",
  email: "iroda@acropora.hu",
  displayName: "Kovács Anna",
  role: "MANAGER",
  customerId: null,
} as AuthenticatedUser;

function contractRow(
  overrides: Partial<{
    status: string;
    items: Array<{
      id: string;
      position: number;
      description: string;
      unitNet: string;
      quantity: string;
      occasionsPerYear: number;
      vatRatePercent: string;
      departmentId: string | null;
    }>;
  }> = {},
) {
  return {
    id: "contract-1",
    number: "SZ2026/0000019",
    title: "Vízgépészet karbantartása",
    status: overrides.status ?? "ACTIVE",
    organizationalUnitName: "Üzemeltetési Osztály",
    contactPersonName: "Sándor Zsolt",
    customer: {
      id: "customer-1",
      displayName: "Fővárosi Állat- és Növénykert",
    },
    items: (
      overrides.items ?? [
        {
          id: "item-1",
          position: 1,
          description: "Cápasuli RO karbantartás",
          unitNet: "410000",
          quantity: "1",
          occasionsPerYear: 4,
          vatRatePercent: "27",
          departmentId: "department-1",
        },
      ]
    ).map((item) => ({
      ...item,
      unitNet: new Prisma.Decimal(item.unitNet),
      quantity: new Prisma.Decimal(item.quantity),
      vatRatePercent: new Prisma.Decimal(item.vatRatePercent),
    })),
  };
}

function fakeRepository(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    contractForIssuance: async () => contractRow(),
    defaultAddress: async () => ({
      line1: "Állatkerti krt. 6-12.",
      line2: null,
      postalCode: "1146",
      city: "Budapest",
    }),
    issuedOccasionCounts: async () => new Map<string, number>(),
    lastNumberOfYear: async () => null,
    issue: async (input: unknown) => ({ id: "order-1", ...(input as object) }),
    detail: async () => null,
    departmentPaths: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, [id]])),
    saveSignedDocumentAndMarkSigned: async () => undefined,
    attachServiceJob: async () => ({ id: "order-1", status: "SIGNED" }),
    markRevoked: async () => ({ id: "order-1", status: "REVOKED" }),
    document: async () => null,
    list: async () => [],
    ...overrides,
  };
}

function makeService(
  repositoryOverrides: Partial<Record<string, unknown>> = {},
) {
  const repository = fakeRepository(repositoryOverrides);
  const serviceJobs = {
    create: async () => ({ id: "job-1" }),
  };
  const worksheets = {
    create: async () => ({ id: "worksheet-1" }),
  };
  const service = new MaintenanceOrdersService(
    repository as never,
    serviceJobs as never,
    worksheets as never,
  );
  return { service, repository, serviceJobs, worksheets };
}

describe("MaintenanceOrdersService.issue", () => {
  it("csak AKTÍV szerződésre állít ki megrendelőlapot", async () => {
    const { service } = makeService({
      contractForIssuance: async () => contractRow({ status: "DRAFT" }),
    });
    await assert.rejects(
      () =>
        service.issue({ contractId: "contract-1", itemIds: ["item-1"] }, ACTOR),
      /aktív szerződésre/,
    );
  });

  it("elutasítja, ha egy megadott tétel-azonosító nem ehhez a szerződéshez tartozik", async () => {
    /*
      MI PIROSÍT: ha a szolgáltatás nem veti össze a kért `itemIds` HOSSZÁT a
      ténylegesen visszakapott tételekével. A repository `where: {id: {in:
      itemIds}}` szűrése csendben kihagyná az idegen azonosítót -- enélkül az
      állítás nélkül a rendelés simán létrejönne KEVESEBB tétellel, mint amit
      a hívó kért, és senki nem szólna róla.
    */
    const { service } = makeService({
      contractForIssuance: async () => contractRow(), // egy tétellel tér vissza
    });
    await assert.rejects(
      () =>
        service.issue(
          { contractId: "contract-1", itemIds: ["item-1", "idegen-tetel"] },
          ACTOR,
        ),
      /olyan van, ami nem ehhez a szerződéshez/,
    );
  });

  it("elutasítja, ha egy kiválasztott tételnek nincs helyszíne (a munkalap emiatt nem jönne létre)", async () => {
    const { service } = makeService({
      contractForIssuance: async () =>
        contractRow({
          items: [
            {
              id: "item-1",
              position: 1,
              description: "Cápasuli RO karbantartás",
              unitNet: "410000",
              quantity: "1",
              occasionsPerYear: 4,
              vatRatePercent: "27",
              departmentId: null,
            },
          ],
        }),
    });
    await assert.rejects(
      () =>
        service.issue({ contractId: "contract-1", itemIds: ["item-1"] }, ACTOR),
      /nincs megadva helyszín/,
    );
  });

  /**
   * MURENA LELETE, STAGING (79d793aa): a `uploadSignedDocument()` 500-at
   * adott, mert a `ServiceJob.departmentId` NOT NULL, a kiállított
   * rendelésből viszont nem lehet EGY helyszínt levezetni, ha a tételei
   * KÜLÖNBÖZŐ helyszínen vannak. Ezt itt, KIÁLLÍTÁSKOR kérjük számon --
   * ne az aláírás visszaérkezésekor, a legrosszabb pillanatban.
   */
  it("elutasítja, ha a kiválasztott tételek KÜLÖNBÖZŐ helyszínen vannak", async () => {
    const { service } = makeService({
      contractForIssuance: async () =>
        contractRow({
          items: [
            {
              id: "item-1",
              position: 1,
              description: "Cápasuli RO karbantartás",
              unitNet: "410000",
              quantity: "1",
              occasionsPerYear: 4,
              vatRatePercent: "27",
              departmentId: "department-1",
            },
            {
              id: "item-2",
              position: 2,
              description: "Fókamedence karbantartás",
              unitNet: "300000",
              quantity: "1",
              occasionsPerYear: 4,
              vatRatePercent: "27",
              departmentId: "department-2",
            },
          ],
        }),
    });
    await assert.rejects(
      () =>
        service.issue(
          { contractId: "contract-1", itemIds: ["item-1", "item-2"] },
          ACTOR,
        ),
      /különböző helyszínen/,
    );
  });

  it("ConflictException-t dob, ha egy tételnél elfogyott az évi alkalomkeret", async () => {
    /*
      A tétel évi 4 alkalmat enged; ha a számláló szerint MÁR 4 nem visszavont
      rendelés esett rá ebben az évben, az ÖTÖDIK kiállítás elutasítandó.
    */
    const { service } = makeService({
      issuedOccasionCounts: async () => new Map([["item-1", 4]]),
    });
    await assert.rejects(
      () =>
        service.issue({ contractId: "contract-1", itemIds: ["item-1"] }, ACTOR),
      (error: unknown) =>
        error instanceof Error &&
        /elfogyott az évi alkalomkeret/.test(error.message),
    );
  });

  it("POZITÍV KONTROLL: érvényes bemenetre létrehozza a rendelést, egy alkalommal tételenként", async () => {
    /*
      Enélkül a fenti négy negatív állítás akkor is zöld lenne, ha a
      szolgáltatás semmilyen bemenetre nem hozna létre semmit.
    */
    const captured: {
      issueInput?: { items: Array<{ contractItemId: string }> };
    } = {};
    const { service } = makeService({
      issue: async (input: { items: Array<{ contractItemId: string }> }) => {
        captured.issueInput = input;
        return { id: "order-1" };
      },
    });
    const result = await service.issue(
      { contractId: "contract-1", itemIds: ["item-1"] },
      ACTOR,
    );
    assert.equal((result as { id: string }).id, "order-1");
    assert.ok(captured.issueInput);
    assert.equal(captured.issueInput.items.length, 1);
    assert.equal(captured.issueInput.items[0]?.contractItemId, "item-1");
  });
});

describe("MaintenanceOrdersService: állapot-átmenetek", () => {
  function orderRow(
    status: "ISSUED" | "SIGNED" | "REVOKED",
    departmentIds: readonly (string | null)[] = ["department-1"],
  ) {
    return {
      id: "order-1",
      number: "MR-2026-001",
      status,
      // A TELJESEN KÉSZ SIGNED-nek MINDIG van serviceJobId-je -- a
      // "megszakadt próbálkozás" (SIGNED, serviceJobId NÉLKÜL) esetét a
      // sajátos tesztje maga állítja be, felülírással.
      serviceJobId: status === "SIGNED" ? "job-1" : null,
      contract: {
        id: "contract-1",
        title: "Vízgépészet karbantartása",
        customerId: "customer-1",
      },
      items: departmentIds.map((departmentId, index) => ({
        description: `Tétel ${index + 1}`,
        quantity: new Prisma.Decimal("1"),
        contractItem: { departmentId },
      })),
    };
  }

  it("aláírt PDF csak ISSUED állapotú rendeléshez tölthető fel", async () => {
    const { service } = makeService({ detail: async () => orderRow("SIGNED") });
    const file = {
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 ..."),
      originalname: "alairt.pdf",
      size: 10,
    } as Express.Multer.File;
    await assert.rejects(
      () => service.uploadSignedDocument("order-1", file, ACTOR),
      /már alá van írva/,
    );
  });

  it("POZITÍV KONTROLL: ISSUED rendeléshez feltölthető az aláírt PDF, és létrejön a karbantartási lap", async () => {
    let workedsheetCalls = 0;
    const repository = fakeRepository({
      detail: async () => orderRow("ISSUED"),
    });
    const serviceJobs = { create: async () => ({ id: "job-1" }) };
    const worksheets = {
      create: async () => {
        workedsheetCalls += 1;
        return { id: "worksheet-1" };
      },
    };
    const wired = new MaintenanceOrdersService(
      repository as never,
      serviceJobs as never,
      worksheets as never,
    );
    const file = {
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 ..."),
      originalname: "alairt.pdf",
      size: 10,
    } as Express.Multer.File;
    const result = await wired.uploadSignedDocument("order-1", file, ACTOR);
    assert.equal((result as { status: string }).status, "SIGNED");
    assert.equal(workedsheetCalls, 1);
  });

  /**
   * MURENA LELETE, STAGING (79d793aa): a `ServiceJobsService.create()`-nek
   * eddig SEHOL nem küldött `departmentId`-t az `uploadSignedDocument()`,
   * a `ServiceJob.departmentId` pedig NOT NULL (#1043 óta) -- ez adta a
   * 500-at. Ez a teszt azt méri, hogy egy-helyszínes rendelésnél a
   * levezetett helyszín TÉNYLEG eljut a karbantartási laphoz.
   */
  it("egy-helyszínes rendelés feltöltése a HELYES departmentId-vel hozza létre a karbantartási lapot", async () => {
    let capturedDepartmentId: string | undefined;
    const repository = fakeRepository({
      detail: async () => orderRow("ISSUED", ["department-1", "department-1"]),
    });
    const serviceJobs = {
      create: async (input: { departmentId?: string }) => {
        capturedDepartmentId = input.departmentId;
        return { id: "job-1" };
      },
    };
    const worksheets = { create: async () => ({ id: "worksheet-1" }) };
    const wired = new MaintenanceOrdersService(
      repository as never,
      serviceJobs as never,
      worksheets as never,
    );
    const file = {
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 ..."),
      originalname: "alairt.pdf",
      size: 10,
    } as Express.Multer.File;
    await wired.uploadSignedDocument("order-1", file, ACTOR);
    assert.equal(capturedDepartmentId, "department-1");
  });

  /**
   * A MÁSIK FELE: ha a tételek KÜLÖNBÖZŐ helyszínen vannak, 400-at ad, ÉS
   * -- mivel az ellenőrzés a `saveSignedDocumentAndMarkSigned()` ELŐTT fut
   * -- a dokumentum NEM mentődik el. Enélkül a korábbi hiba visszatérne
   * más alakban: egy ismételt próbálkozás duplikált dokumentumot hozna
   * létre.
   */
  it("VEGYES helyszínű rendelésnél 400-at ad, és NEM ment el dokumentumot", async () => {
    let saveCalls = 0;
    const repository = fakeRepository({
      detail: async () => orderRow("ISSUED", ["department-1", "department-2"]),
      saveSignedDocumentAndMarkSigned: async () => {
        saveCalls += 1;
      },
    });
    const wired = new MaintenanceOrdersService(
      repository as never,
      { create: async () => ({ id: "job-1" }) } as never,
      { create: async () => ({ id: "worksheet-1" }) } as never,
    );
    const file = {
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 ..."),
      originalname: "alairt.pdf",
      size: 10,
    } as Express.Multer.File;
    await assert.rejects(
      () => wired.uploadSignedDocument("order-1", file, ACTOR),
      /különböző helyszínen/,
    );
    assert.equal(saveCalls, 0);
  });

  /**
   * A HARMADIK, ÚJ ESET: A MEGSZAKADT PRÓBÁLKOZÁS FOLYTATÁSA.
   *
   * Acrobot kártyája 8b1fd497 (2026-09-24 22:29): a feltöltés ma este
   * élesben megy, tehát egy megszakadt kérés (a dokumentum már mentve, az
   * állapot már SIGNED, de a karbantartási lap még nem jött létre) UTÁN
   * egy újrapróbálkozásnak BE KELL FEJEZNIE a munkát, nem elutasítania és
   * nem újra elmentenie a dokumentumot.
   */
  it("MEGSZAKADT PRÓBÁLKOZÁS FOLYTATÁSA: SIGNED állapotban, serviceJobId nélkül folytatja, nem menti újra a dokumentumot", async () => {
    let saveCalls = 0;
    const repository = fakeRepository({
      detail: async () => ({ ...orderRow("SIGNED"), serviceJobId: null }),
      saveSignedDocumentAndMarkSigned: async () => {
        saveCalls += 1;
      },
    });
    let capturedClientOperationId: string | undefined;
    const serviceJobs = {
      create: async (input: { clientOperationId?: string }) => {
        capturedClientOperationId = input.clientOperationId;
        return { id: "job-1" };
      },
    };
    let workedsheetCalls = 0;
    const worksheets = {
      create: async () => {
        workedsheetCalls += 1;
        return { id: "worksheet-1" };
      },
    };
    const wired = new MaintenanceOrdersService(
      repository as never,
      serviceJobs as never,
      worksheets as never,
    );
    const file = {
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 ..."),
      originalname: "alairt.pdf",
      size: 10,
    } as Express.Multer.File;
    const result = await wired.uploadSignedDocument("order-1", file, ACTOR);
    assert.equal(saveCalls, 0);
    assert.equal(workedsheetCalls, 1);
    assert.equal(capturedClientOperationId, "maintenance-order-order-1-signed");
    assert.equal((result as { status: string }).status, "SIGNED");
  });

  it("TELJESEN KÉSZ rendelésre (SIGNED, van serviceJobId) nem tölthető fel újra aláírt példány", async () => {
    const { service } = makeService({
      detail: async () => ({ ...orderRow("SIGNED"), serviceJobId: "job-1" }),
    });
    const file = {
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 ..."),
      originalname: "alairt.pdf",
      size: 10,
    } as Express.Multer.File;
    await assert.rejects(
      () => service.uploadSignedDocument("order-1", file, ACTOR),
      /már alá van írva/,
    );
  });

  it("csak ISSUED rendelés vonható vissza", async () => {
    const { service } = makeService({
      detail: async () => orderRow("REVOKED"),
    });
    await assert.rejects(
      () => service.revoke("order-1", {}, ACTOR),
      /már vissza van vonva/,
    );
  });

  it("POZITÍV KONTROLL: ISSUED rendelés visszavonható, a névvel és az indoklással", async () => {
    let captured: {
      revokedByName: string | null;
      reason: string | null;
    } | null = null;
    const { service } = makeService({
      detail: async () => orderRow("ISSUED"),
      markRevoked: async (
        _id: string,
        revokedByName: string | null,
        reason: string | null,
      ) => {
        captured = { revokedByName, reason };
        return { id: "order-1", status: "REVOKED" };
      },
    });
    await service.revoke("order-1", { reason: "tévedésből" }, ACTOR);
    assert.deepEqual(captured, {
      revokedByName: "Kovács Anna",
      reason: "tévedésből",
    });
  });
});
