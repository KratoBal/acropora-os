import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
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
    kind: "MAINTENANCE" | "PURCHASE" | "REPAIR";
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
    kind: overrides.kind ?? "MAINTENANCE",
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
    // alapból van keret: a hívó beszúrása lefut (a valódi zár és számlálás
    // az integrációs specben: maintenance-order-occasion-guard.integration.spec.ts)
    reserveOccasions: async (
      _input: unknown,
      write: (tx: unknown) => Promise<unknown>,
    ) => ({ ok: true, value: await write({}) }),
    lastNumberOfYear: async () => null,
    issue: async (input: unknown) => ({ id: "order-1", ...(input as object) }),
    detail: async () => null,
    departmentPaths: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, [id]])),
    // alapból minden helyszín külön gyökér: nincs közös felső helyszín
    departmentTree: async (ids: readonly string[]) =>
      ids.map((id) => ({ id, name: id, parentId: null })),
    saveSignedDocumentAndMarkSigned: async () => undefined,
    // alapból egyik tételnek sincs szerződéses eszköze
    itemAssetsBySite: async () =>
      new Map<string, { onSite: string[]; outside: string[] }>(),
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

  // hétfői lista M4: a beszerzési szerződésből számla készül, nem megrendelőlap
  it("MAINTENANCE-ORDER-PURCHASE: beszerzési szerződésre nem állít ki megrendelőlapot", async () => {
    const { service } = makeService({
      contractForIssuance: async () => contractRow({ kind: "PURCHASE" }),
    });
    await assert.rejects(
      () =>
        service.issue({ contractId: "contract-1", itemIds: ["item-1"] }, ACTOR),
      /Beszerzési szerződésre nem állítható ki megrendelőlap/,
    );
  });

  it("MAINTENANCE-ORDER-REPAIR: javítási szerződésre nem állít ki megrendelőlapot", async () => {
    const { service } = makeService({
      contractForIssuance: async () => contractRow({ kind: "REPAIR" }),
    });
    await assert.rejects(
      () =>
        service.issue({ contractId: "contract-1", itemIds: ["item-1"] }, ACTOR),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          "Javítási szerződésre nem állítható ki megrendelőlap.",
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

  it("a lejárt zár-várakozás a kiállításnál is 'próbáld újra' 409, nem keret-túllépés", async () => {
    const { service } = makeService({
      reserveOccasions: async () => ({ ok: false, busy: true }),
    });
    const outcome = await service
      .issue({ contractId: "contract-1", itemIds: ["item-1"] }, ACTOR)
      .then(
        () => "nem dobott",
        (error: unknown) =>
          error instanceof ConflictException ? error.message : String(error),
      );
    assert.equal(
      outcome,
      "A szerződés alkalomkeretét most egy másik művelet foglalja. Próbáld újra.",
    );
  });

  it("ConflictException-t dob, ha egy tételnél elfogyott az évi alkalomkeret, és nem ír", async () => {
    /*
      A foglalás (zár + számlálás) a repository dolga; a szolgáltatás azt
      méri itt, hogy a túllépett tételeket megnevezi, a keret adatait (tétel,
      évi alkalom, szerződés) átadja, és túllépésnél nem hívja a beszúrást.
    */
    let asked: unknown;
    let issueCalls = 0;
    const { service } = makeService({
      reserveOccasions: async (input: unknown) => {
        asked = input;
        return { ok: false, exhausted: ["Cápasuli RO karbantartás"] };
      },
      issue: async () => {
        issueCalls += 1;
        return { id: "order-1" };
      },
    });
    const outcome = await service
      .issue({ contractId: "contract-1", itemIds: ["item-1"] }, ACTOR)
      .then(
        () => "nem dobott",
        (error: unknown) =>
          error instanceof ConflictException ? error.message : String(error),
      );
    const year = (asked as { year: number }).year;
    assert.deepEqual(
      [outcome, asked, issueCalls],
      [
        `A következő tételeknél ${year}-ban elfogyott az évi alkalomkeret: Cápasuli RO karbantartás.`,
        {
          contractId: "contract-1",
          year,
          items: [
            {
              contractItemId: "item-1",
              description: "Cápasuli RO karbantartás",
              occasionsPerYear: 4,
            },
          ],
        },
        0,
      ],
    );
  });

  /**
   * A SZÁM ITT NEM FELHASZNÁLÓI BEVITEL (`nextMaintenanceOrderNumber`
   * generálja) -- egy P2002 versenyhelyzetet jelent, ezért az üzenet
   * "próbáld újra"-t mond, nem mezőjavítást. Balázs éles hibája
   * (2026-09-24 20:31, acrobot kártyája 31f8c5b4) a szerződésszámnál merült
   * fel, de ugyanaz a hibaosztály (nyers P2002 -> generikus üzenet) itt is
   * fennállt volna kezelés nélkül.
   */
  it("P2002-re 409-et dob magyarul, a generált szám említésével", async () => {
    const { service } = makeService({
      issue: async () => {
        throw new Prisma.PrismaClientKnownRequestError("duplicate", {
          code: "P2002",
          clientVersion: "6.19.3",
        });
      },
    });
    await assert.rejects(
      () =>
        service.issue({ contractId: "contract-1", itemIds: ["item-1"] }, ACTOR),
      (error: unknown) =>
        error instanceof Error &&
        /időközben már kiosztásra került/.test(error.message) &&
        error.message.includes("MR-"),
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
        contractItem: { id: `item-${index + 1}`, departmentId },
      })),
    };
  }

  /*
    A KÖZÖS FELSŐ HELYSZÍN (Balázs, 2026-10-02 07:36 UTC; kártya 1806e061; az
    éles eset: a Cápasuli és három medencéje). MI PIROSÍT: ha a közös felső
    helyszín alatti tételek nem kaphatnának egy megrendelőlapot; ha a hibajegy
    nem a közös helyszínre kerülne; ha a munkalapok elveszítenék a saját
    medencéjüket, és mind a közösre kerülnének.
  */
  const CAPASULI = [
    { id: "capasuli", name: "Cápasuli", parentId: null },
    { id: "karanten", name: "Karantén medence", parentId: "capasuli" },
    { id: "kismedence", name: "Kismedence", parentId: "capasuli" },
    { id: "nagymedence", name: "Nagymedence", parentId: "capasuli" },
    { id: "fokamedence", name: "Fókamedence", parentId: null },
  ];

  it("a Cápasuli medencéi és maga a Cápasuli: egy megrendelőlap", async () => {
    const item = (id: string, departmentId: string, position: number) => ({
      id,
      position,
      description: `${departmentId} karbantartás`,
      unitNet: "100000",
      quantity: "1",
      occasionsPerYear: 4,
      vatRatePercent: "27",
      departmentId,
    });
    let issued = 0;
    const { service } = makeService({
      departmentTree: async () => CAPASULI,
      contractForIssuance: async () =>
        contractRow({
          items: [
            item("i-1", "capasuli", 1),
            item("i-2", "karanten", 2),
            item("i-3", "nagymedence", 3),
          ],
        }),
      issue: async (input: unknown) => {
        issued += 1;
        return { id: "order-1", ...(input as object) };
      },
    });
    await service.issue(
      { contractId: "contract-1", itemIds: ["i-1", "i-2", "i-3"] },
      ACTOR,
    );
    assert.equal(issued, 1);
  });

  it("aláíráskor a hibajegy a Cápasulira, a munkalapok a saját medencéjükre kerülnek", async () => {
    let jobDepartment: string | undefined;
    const worksheetDepartments: string[] = [];
    const wired = new MaintenanceOrdersService(
      fakeRepository({
        departmentTree: async () => CAPASULI,
        detail: async () =>
          orderRow("ISSUED", ["karanten", "kismedence", "nagymedence"]),
      }) as never,
      {
        create: async (input: { departmentId?: string }) => {
          jobDepartment = input.departmentId;
          return { id: "job-1" };
        },
      } as never,
      {
        create: async (input: { departmentId: string }) => {
          worksheetDepartments.push(input.departmentId);
          return { id: "worksheet-1" };
        },
      } as never,
    );
    await wired.uploadSignedDocument(
      "order-1",
      {
        mimetype: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 ..."),
        originalname: "alairt.pdf",
        size: 10,
      } as Express.Multer.File,
      ACTOR,
    );
    assert.equal(jobDepartment, "capasuli");
    assert.deepEqual(worksheetDepartments, [
      "karanten",
      "kismedence",
      "nagymedence",
    ]);
  });

  /*
    AZ ESZKÖZÖK A SZERZŐDÉSBŐL (karbantartási felmérés S1, 2026-10-15). MI
    PIROSÍT: ha a lap nem kapja meg a tételek eszközeit; ha egy közös eszköz
    kétszer kerül a lapra; ha egy munkalap a MÁSIK tétel eszközét is megkapja;
    ha a repository nem a tétel SAJÁT helyszínét kapja a szűréshez.
  */
  it("aláíráskor a lap a tételek eszközeinek unióját, a munkalap a saját tételéét kapja", async () => {
    let jobAssetIds: string[] | undefined;
    const worksheetAssetIds: Array<string[] | undefined> = [];
    let asked: unknown;
    const wired = new MaintenanceOrdersService(
      fakeRepository({
        departmentTree: async () => CAPASULI,
        detail: async () => orderRow("ISSUED", ["kismedence", "nagymedence"]),
        itemAssetsBySite: async (items: unknown) => {
          asked = items;
          return new Map([
            ["item-1", { onSite: ["szivattyu", "kozos-szuro"], outside: [] }],
            ["item-2", { onSite: ["uv-lampa", "kozos-szuro"], outside: [] }],
          ]);
        },
      }) as never,
      {
        create: async (input: { assetIds?: string[] }) => {
          jobAssetIds = input.assetIds;
          return { id: "job-1" };
        },
      } as never,
      {
        create: async (input: { assetIds?: string[] }) => {
          worksheetAssetIds.push(input.assetIds);
          return { id: "worksheet-1" };
        },
      } as never,
    );
    await wired.uploadSignedDocument(
      "order-1",
      {
        mimetype: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 ..."),
        originalname: "alairt.pdf",
        size: 10,
      } as Express.Multer.File,
      ACTOR,
    );
    assert.deepEqual(asked, [
      { contractItemId: "item-1", departmentId: "kismedence" },
      { contractItemId: "item-2", departmentId: "nagymedence" },
    ]);
    assert.deepEqual(jobAssetIds, ["szivattyu", "kozos-szuro", "uv-lampa"]);
    assert.deepEqual(worksheetAssetIds, [
      ["szivattyu", "kozos-szuro"],
      ["uv-lampa", "kozos-szuro"],
    ]);
  });

  it("eszköz nélküli tételnél a lap és a munkalap üres eszközlistát kap", async () => {
    let jobAssetIds: string[] | undefined;
    const worksheetAssetIds: Array<string[] | undefined> = [];
    const wired = new MaintenanceOrdersService(
      fakeRepository({
        detail: async () => orderRow("ISSUED", ["department-1"]),
      }) as never,
      {
        create: async (input: { assetIds?: string[] }) => {
          jobAssetIds = input.assetIds;
          return { id: "job-1" };
        },
      } as never,
      {
        create: async (input: { assetIds?: string[] }) => {
          worksheetAssetIds.push(input.assetIds);
          return { id: "worksheet-1" };
        },
      } as never,
    );
    await wired.uploadSignedDocument(
      "order-1",
      {
        mimetype: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 ..."),
        originalname: "alairt.pdf",
        size: 10,
      } as Express.Multer.File,
      ACTOR,
    );
    assert.deepEqual(jobAssetIds, []);
    assert.deepEqual(worksheetAssetIds, [[]]);
  });

  it("egy Cápasuli-medence és a független Fókamedence: marad a 400, a helyszínek nevével", async () => {
    const { service } = makeService({
      departmentTree: async () => CAPASULI,
      detail: async () => orderRow("ISSUED", ["karanten", "fokamedence"]),
    });
    await assert.rejects(
      () =>
        service.uploadSignedDocument(
          "order-1",
          {
            mimetype: "application/pdf",
            buffer: Buffer.from("%PDF-1.4 ..."),
            originalname: "alairt.pdf",
            size: 10,
          } as Express.Multer.File,
          ACTOR,
        ),
      /különböző helyszínen vannak \(karanten, fokamedence\)/,
    );
  });

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

  /*
    A KULCSOK BETŰRE A MAI KULCSOK (karbantartási felmérés S3). A lap és a
    munkalapok létrehozása egy közös, paraméterezett úton megy; ha a kulcs
    összeállítása ott elcsúszna, egy megszakadt aláírás újrafuttatása NEM a
    meglévő sorokat találná meg, hanem újakat hozna létre. MI PIROSÍT: bármelyik
    kulcs egyetlen karaktere.
  */
  it("az aláírás-út a lapot és a munkalapokat a mai idempotencia-kulcsokkal hozza létre", async () => {
    let jobKey: string | undefined;
    const worksheetKeys: Array<string | undefined> = [];
    const wired = new MaintenanceOrdersService(
      fakeRepository({
        departmentTree: async () => [
          { id: "capasuli", name: "Cápasuli", parentId: null },
          { id: "kismedence", name: "Kismedence", parentId: "capasuli" },
          { id: "nagymedence", name: "Nagymedence", parentId: "capasuli" },
        ],
        detail: async () => orderRow("ISSUED", ["kismedence", "nagymedence"]),
      }) as never,
      {
        create: async (input: { clientOperationId?: string }) => {
          jobKey = input.clientOperationId;
          return { id: "job-1" };
        },
      } as never,
      {
        create: async (input: { clientOperationId?: string }) => {
          worksheetKeys.push(input.clientOperationId);
          return { id: "worksheet-1" };
        },
      } as never,
    );
    await wired.uploadSignedDocument(
      "order-1",
      {
        mimetype: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 ..."),
        originalname: "alairt.pdf",
        size: 10,
      } as Express.Multer.File,
      ACTOR,
    );
    assert.equal(jobKey, "maintenance-order-order-1-signed");
    assert.deepEqual(worksheetKeys, [
      "maintenance-order-order-1-worksheet-item-1",
      "maintenance-order-order-1-worksheet-item-2",
    ]);
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

/*
  KARBANTARTÁSI LAP A SZERZŐDÉSBŐL, MEGRENDELŐLAP NÉLKÜL (karbantartási felmérés
  S4). MI PIROSÍT: ha nem karbantartási vagy nem aktív szerződésből lap készül;
  ha a szokásos keret-túllépés LAPOT hoz létre a 409 előtt; ha a tételsorok nem a
  szerződéses árat rögzítik; ha a foglalás éve nem a lap létrehozásáé; ha a
  versenyhelyzetben elvesztett foglalás után a lap élve marad; ha egy újrahívás
  újra foglal (a saját sorait felhasználásnak látná); ha a torlódás keret-
  túllépésnek látszik.
*/
describe("MaintenanceOrdersService.createJobFromContract", () => {
  type Reserved =
    | { ok: true }
    | { ok: false; exhausted: string[] }
    | { ok: false; busy: true };

  function harness(
    opts: {
      contract?: ReturnType<typeof contractRow>;
      reservations?: Reserved[];
      itemCount?: number;
      createdAt?: Date;
      status?: string;
      jobContractId?: string | null;
      // a kulcs alatt MÁR létező lap (újrahívás); alapból nincs ilyen
      existing?: { status?: string; contractId?: string; itemCount: number };
    } = {},
  ) {
    const calls: string[] = [];
    const years: number[] = [];
    const inserted: unknown[] = [];
    const moved: unknown[] = [];
    const jobInputs: unknown[] = [];
    const queue = [...(opts.reservations ?? [{ ok: true }, { ok: true }])];
    const repository = fakeRepository({
      contractForIssuance: async () => opts.contract ?? contractRow(),
      reserveOccasions: async (
        input: { year: number },
        write: (tx: unknown) => Promise<unknown>,
      ) => {
        calls.push("reserve");
        years.push(input.year);
        const next = queue.shift() ?? { ok: true };
        if (!next.ok) return next;
        return { ok: true, value: await write({ tx: true }) };
      },
      serviceJobContractItemState: async (
        where: { id: string } | { clientOperationId: string },
      ) => {
        if ("clientOperationId" in where) {
          calls.push("lookup");
          return opts.existing
            ? {
                id: "job-1",
                createdAt: new Date("2026-06-15T10:00:00.000Z"),
                status: opts.existing.status ?? "NEW",
                contractId: opts.existing.contractId ?? "contract-1",
                itemCount: opts.existing.itemCount,
              }
            : null;
        }
        calls.push("state");
        return {
          id: "job-1",
          createdAt: opts.createdAt ?? new Date("2026-06-15T10:00:00.000Z"),
          status: opts.status ?? "NEW",
          contractId:
            opts.jobContractId === undefined
              ? "contract-1"
              : opts.jobContractId,
          itemCount: opts.itemCount ?? 0,
        };
      },
      insertServiceJobContractItems: async (
        tx: unknown,
        serviceJobId: string,
        items: unknown,
      ) => {
        calls.push("insert");
        inserted.push({ tx, serviceJobId, items });
        return { count: 1 };
      },
    });
    const service = new MaintenanceOrdersService(
      repository as never,
      {
        create: async (input: unknown) => {
          calls.push("job");
          jobInputs.push(input);
          return { id: "job-1" };
        },
        move: async (...args: unknown[]) => {
          calls.push("move");
          moved.push(args);
          return { id: "job-1" };
        },
      } as never,
      {
        create: async () => {
          calls.push("worksheet");
          return { id: "worksheet-1" };
        },
      } as never,
    );
    const run = (dto: Record<string, unknown> = {}) =>
      service
        .createJobFromContract(
          {
            contractId: "contract-1",
            itemIds: ["item-1"],
            clientOperationId: "kulcs-0001",
            ...dto,
          } as never,
          ACTOR,
        )
        .then(
          (value) => value as unknown,
          (error: unknown) =>
            `${(error as { getStatus?: () => number }).getStatus?.() ?? "?"}: ${(error as Error).message}`,
        );
    return { run, calls, years, inserted, moved, jobInputs };
  }

  it("csak aktív karbantartási szerződésből, és csak a saját tételeiből", async () => {
    const results = [
      await harness({ contract: contractRow({ kind: "REPAIR" }) }).run(),
      await harness({ contract: contractRow({ kind: "PURCHASE" }) }).run(),
      await harness({ contract: contractRow({ status: "DRAFT" }) }).run(),
      await harness().run({ itemIds: ["item-1", "idegen"] }),
    ];
    assert.deepEqual(results, [
      "400: Csak karbantartási szerződésből készíthető karbantartási lap.",
      "400: Csak karbantartási szerződésből készíthető karbantartási lap.",
      "400: Csak aktív szerződésből készíthető karbantartási lap.",
      "400: A megadott tételek között olyan van, ami nem ehhez a szerződéshez tartozik, vagy már nem létezik.",
    ]);
  });

  it("a rendes út: előellenőrzés, lap a közös úton, tételsorok a szerződéses áron, a lap évére", async () => {
    const h = harness({ createdAt: new Date("2026-12-31T23:30:00.000Z") });
    const result = await h.run({ title: "  Téli karbantartás  " });
    assert.deepEqual(
      {
        result,
        calls: h.calls,
        year: h.years[1],
        job: h.jobInputs[0],
        inserted: h.inserted,
      },
      {
        result: { serviceJobId: "job-1" },
        calls: [
          "lookup",
          "reserve",
          "job",
          "worksheet",
          "state",
          "reserve",
          "insert",
        ],
        // a lap 2026-12-31 23:30 UTC-kor jött létre: Budapesten már 2027
        year: 2027,
        job: {
          title: "Téli karbantartás",
          kind: "MAINTENANCE",
          contractId: "contract-1",
          customerId: "customer-1",
          departmentId: "department-1",
          assetIds: [],
          clientOperationId: "contract-job-kulcs-0001",
        },
        inserted: [
          {
            tx: { tx: true },
            serviceJobId: "job-1",
            items: [
              {
                contractItemId: "item-1",
                description: "Cápasuli RO karbantartás",
                unitNet: new Prisma.Decimal("410000"),
                quantity: new Prisma.Decimal("1"),
                vatRatePercent: new Prisma.Decimal("27"),
              },
            ],
          },
        ],
      },
    );
  });

  it("a szokásos túllépés lap létrehozása NÉLKÜL ad 409-et", async () => {
    const h = harness({
      reservations: [{ ok: false, exhausted: ["Cápasuli RO karbantartás"] }],
    });
    const result = await h.run();
    assert.deepEqual(
      [String(result).replace(/\d{4}-ban/, "ÉV-ban"), h.calls],
      [
        "409: A következő tételeknél ÉV-ban elfogyott az évi alkalomkeret: Cápasuli RO karbantartás.",
        ["lookup", "reserve"],
      ],
    );
  });

  it("versenyhelyzet: a második foglalás elveszett, a friss lap lemondva, 409", async () => {
    const h = harness({
      reservations: [
        { ok: true },
        { ok: false, exhausted: ["Cápasuli RO karbantartás"] },
      ],
    });
    const result = await h.run();
    const [jobId, move] = h.moved[0] as [string, { to: string }];
    assert.deepEqual(
      [String(result).slice(0, 4), h.calls, jobId, move.to, h.inserted],
      [
        "409:",
        ["lookup", "reserve", "job", "worksheet", "state", "reserve", "move"],
        "job-1",
        "CANCELLED",
        [],
      ],
    );
  });

  it("újrahívás: ha a kulcs alatti lapnak már vannak tételsorai, nem foglal újra (az előellenőrzés sem)", async () => {
    const h = harness({ existing: { itemCount: 1 }, itemCount: 1 });
    const result = await h.run();
    assert.deepEqual(
      [result, h.calls],
      [{ serviceJobId: "job-1" }, ["lookup", "job", "worksheet", "state"]],
    );
  });

  it("újrahívás egy lemondott vagy másik szerződés lapjára: 409 a lap és a munkalapok létrehozása ELŐTT (barracuda 31714, 31720)", async () => {
    const cancelled = harness({
      existing: { status: "CANCELLED", itemCount: 0 },
    });
    const foreign = harness({
      existing: { contractId: "contract-2", itemCount: 0 },
    });
    assert.deepEqual(
      [
        await cancelled.run(),
        cancelled.calls,
        await foreign.run(),
        foreign.calls,
      ],
      [
        "409: Ez a karbantartási lap le van mondva. Új lapot kezdj.",
        ["lookup"],
        "409: Ez a kérés-azonosító egy másik szerződés karbantartási lapjához tartozik. Új lapot kezdj.",
        ["lookup"],
      ],
    );
  });

  it("torlódás: a lejárt zár-várakozás 'próbáld újra' 409, nem keret-túllépés", async () => {
    const h = harness({ reservations: [{ ok: false, busy: true }] });
    assert.equal(
      await h.run(),
      "409: A szerződés alkalomkeretét most egy másik művelet foglalja. Próbáld újra.",
    );
  });
});
