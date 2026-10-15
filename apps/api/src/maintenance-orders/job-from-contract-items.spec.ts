import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, ConflictException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import {
  createJobFromContractItems,
  siteForContractItems,
  type ContractItemForJob,
} from "./job-from-contract-items.js";

/**
 * A KÖZÖS ÚT SAJÁT TESZTJEI (karbantartási felmérés S3), adatbázis nélkül.
 * Az aláírás-út viselkedését a `maintenance-orders.service.spec.ts` méri
 * változatlanul; ez a fájl azt, amit az S4 és az S6 hívója is kap.
 *
 * MI PIROSÍT: ha a lap vagy a munkalap kulcsa nem a hívótól jön (egy
 * újrafuttatás ekkor új sort hozna); ha a kimaradt eszköz nem jön vissza, vagy
 * a napló-sor nevet, leírást hordoz; ha a munkalap a másik tétel eszközét is
 * megkapja; ha a helyszín nélküli tétel csendben kimarad.
 */

const ACTOR = { id: "user-1", role: "MANAGER" } as AuthenticatedUser;

const ITEMS: ContractItemForJob[] = [
  {
    id: "item-1",
    departmentId: "kismedence",
    description: "Kismedence karbantartás",
    quantity: 2,
  },
  {
    id: "item-2",
    departmentId: "nagymedence",
    description: "Nagymedence karbantartás",
    quantity: 1,
  },
];

const TREE = [
  { id: "capasuli", name: "Cápasuli", parentId: null },
  { id: "kismedence", name: "Kismedence", parentId: "capasuli" },
  { id: "nagymedence", name: "Nagymedence", parentId: "capasuli" },
  { id: "fokamedence", name: "Fókamedence", parentId: null },
];

function deps(
  assets: Map<string, { onSite: string[]; outside: string[] }>,
  calls: {
    job?: Record<string, unknown>;
    worksheets: Record<string, unknown>[];
    warn: string[];
  },
) {
  return {
    repository: {
      departmentTree: async () => TREE,
      departmentPaths: async (ids: readonly string[]) =>
        new Map(ids.map((id) => [id, [id]])),
      itemAssetsBySite: async () => assets,
    } as never,
    serviceJobs: {
      create: async (input: Record<string, unknown>) => {
        calls.job = input;
        return { id: "job-1" };
      },
    } as never,
    worksheets: {
      create: async (input: Record<string, unknown>) => {
        calls.worksheets.push(input);
        return { id: `worksheet-${calls.worksheets.length}` };
      },
    } as never,
    logger: { warn: (message: string) => void calls.warn.push(message) },
  };
}

describe("createJobFromContractItems", () => {
  it("a kulcsokat a hívó adja, a lap az eszközök uniója, a munkalap a saját tételéé", async () => {
    const calls = {
      worksheets: [] as Record<string, unknown>[],
      warn: [] as string[],
    } as {
      job?: Record<string, unknown>;
      worksheets: Record<string, unknown>[];
      warn: string[];
    };
    const result = await createJobFromContractItems(
      deps(
        new Map([
          ["item-1", { onSite: ["szivattyu", "kozos-szuro"], outside: [] }],
          ["item-2", { onSite: ["uv-lampa", "kozos-szuro"], outside: [] }],
        ]),
        calls,
      ),
      {
        title: "Cápasuli karbantartás (KMR-2026-0001)",
        contract: { id: "contract-1", customerId: "customer-1" },
        departmentId: "capasuli",
        items: ITEMS,
        jobOperationId: "hivo-lap-kulcs",
        worksheetOperationIdPrefix: "hivo-munkalap-",
        source: "teszt",
      },
      ACTOR,
    );

    assert.equal(result.serviceJobId, "job-1");
    assert.equal(result.skippedAssets.size, 0);
    assert.deepEqual(calls.job, {
      title: "Cápasuli karbantartás (KMR-2026-0001)",
      kind: "MAINTENANCE",
      contractId: "contract-1",
      customerId: "customer-1",
      departmentId: "capasuli",
      assetIds: ["szivattyu", "kozos-szuro", "uv-lampa"],
      clientOperationId: "hivo-lap-kulcs",
    });
    assert.deepEqual(
      calls.worksheets.map((w) => [
        w.clientOperationId,
        w.departmentId,
        w.assetIds,
        w.serviceJobId,
      ]),
      [
        [
          "hivo-munkalap-item-1",
          "kismedence",
          ["szivattyu", "kozos-szuro"],
          "job-1",
        ],
        [
          "hivo-munkalap-item-2",
          "nagymedence",
          ["uv-lampa", "kozos-szuro"],
          "job-1",
        ],
      ],
    );
    assert.deepEqual(calls.worksheets[0]?.lines, [
      {
        description: "Kismedence karbantartás",
        quantity: 2,
        unit: "db",
        kind: "OTHER",
      },
    ]);
    assert.deepEqual(calls.warn, []);
  });

  it("a kimaradt eszközt visszaadja és naplózza, azonosítókkal, leírás nélkül", async () => {
    const calls = {
      worksheets: [] as Record<string, unknown>[],
      warn: [] as string[],
    } as {
      job?: Record<string, unknown>;
      worksheets: Record<string, unknown>[];
      warn: string[];
    };
    const result = await createJobFromContractItems(
      deps(
        new Map([
          [
            "item-1",
            {
              onSite: ["szivattyu"],
              outside: ["atkoltozott-1", "atkoltozott-2"],
            },
          ],
          ["item-2", { onSite: [], outside: [] }],
        ]),
        calls,
      ),
      {
        title: "x",
        contract: { id: "contract-1", customerId: "customer-1" },
        departmentId: "capasuli",
        items: ITEMS,
        jobOperationId: "k",
        worksheetOperationIdPrefix: "k-",
        source: "maintenance-order order-1",
      },
      ACTOR,
    );

    assert.deepEqual(
      [...result.skippedAssets],
      [["item-1", ["atkoltozott-1", "atkoltozott-2"]]],
    );
    assert.deepEqual(calls.job?.assetIds, ["szivattyu"]);
    assert.deepEqual(
      calls.worksheets.map((w) => w.assetIds),
      [["szivattyu"], []],
    );
    assert.equal(calls.warn.length, 1);
    const line = calls.warn[0] ?? "";
    for (const part of [
      "maintenance-order order-1",
      "item-1",
      "atkoltozott-1",
      "atkoltozott-2",
      "2 asset(s)",
    ]) {
      assert.ok(line.includes(part), `a napló-sorból hiányzik: ${part}`);
    }
    assert.ok(
      !line.includes("karbantartás"),
      "a napló-sor nem hordozhat leírást",
    );
  });
});

describe("siteForContractItems", () => {
  const repository = {
    departmentTree: async () => TREE,
    departmentPaths: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, ["Gyökér", id]])),
  } as never;

  it("a közös felső helyszínt adja", async () => {
    assert.equal(await siteForContractItems(repository, ITEMS), "capasuli");
  });

  it("egy helyszínnél azt adja, fa-lekérdezés nélkül", async () => {
    const one = ITEMS.slice(0, 1);
    assert.equal(
      await siteForContractItems(
        {
          departmentTree: async () => assert.fail("nem kell fa"),
          departmentPaths: async () => assert.fail("nem kell út"),
        } as never,
        one,
      ),
      "kismedence",
    );
  });

  it("helyszín nélküli tételnél hangosan megáll, a tételt megnevezve", async () => {
    await assert.rejects(
      siteForContractItems(repository, [
        ITEMS[0]!,
        { ...ITEMS[1]!, departmentId: null },
      ]),
      (error: unknown) =>
        error instanceof ConflictException &&
        error.message.includes("Nagymedence karbantartás"),
    );
  });

  it("közös ős nélkül megáll, és megnevezi a helyszínek útját", async () => {
    await assert.rejects(
      siteForContractItems(repository, [
        ITEMS[0]!,
        { ...ITEMS[1]!, departmentId: "fokamedence" },
      ]),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("Gyökér / kismedence") &&
        error.message.includes("Gyökér / fokamedence"),
    );
  });
});
