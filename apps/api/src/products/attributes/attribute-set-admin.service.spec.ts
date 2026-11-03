import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { AttributeSetAdminService } from "./attribute-set-admin.service.js";
import type { CreateAttributeSetDto } from "./dto/attribute-set.dto.js";

/*
  A KÉSZLET-ÍRÓ OLDAL (S1, kártya 8639ac2a). MI PIROSÍT: ha egy ismeretlen vagy inaktív attribútum
  átmenne; ha a készlet létrehozása meglévő készletet vagy kötést módosítana/törölne (a dupla
  csak `create`/`createMany`-t ismer, bármi más TypeError); ha egy létező kulcs nem 409; ha a kötés a
  `attributeSetId`-n kívül MÁST is írna (a `data` pontos egyezést kér); ha a kötés lépteti a termék
  `updatedAt`-jét (az a termék bolti vetítését indítaná: `medusa-projection-due.ts`); ha a kötés
  UNAS-gazdájú terméken elutasulna; ha egy közben megváltozott termékre a régi `updatedAt`-et írná
  vissza.
*/
const T1 = new Date("2026-11-03T10:00:00.000Z");
const T2 = new Date("2026-11-03T10:05:00.000Z");

interface Calls {
  creates: Array<Record<string, unknown>>;
  links: Array<Record<string, unknown>>;
  updates: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  productReads: number;
}

function service(options: {
  definitions?: string[];
  sets?: Record<string, { id: string; isActive: boolean }>;
  existingKey?: boolean;
  product?: {
    id: string;
    attributeSetId: string | null;
    updatedAt: Date;
  } | null;
  /** a termék `updatedAt`-je az n-edik olvasásnál (a közben történt változás utánzása) */
  updatedAtSequence?: Date[];
  updateCounts?: number[];
}) {
  const calls: Calls = { creates: [], links: [], updates: [], productReads: 0 };
  const tx = {
    attributeSet: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.existingKey)
          throw new Prisma.PrismaClientKnownRequestError("dup", {
            code: "P2002",
            clientVersion: "test",
          });
        calls.creates.push(data);
        return { id: "set-new", ...data };
      },
    },
    attributeSetAttribute: {
      createMany: async ({
        data,
      }: {
        data: Array<Record<string, unknown>>;
      }) => {
        calls.links.push(...data);
        return { count: data.length };
      },
    },
  };
  const updateCounts = [...(options.updateCounts ?? [1])];
  const sequence = [...(options.updatedAtSequence ?? [])];
  const admin = new AttributeSetAdminService();
  Object.defineProperty(admin, "database", {
    value: {
      attributeDefinition: {
        findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
          where.key.in
            .filter((k) => (options.definitions ?? []).includes(k))
            .map((key) => ({ key })),
      },
      attributeSet: {
        findUnique: async ({
          where,
        }: {
          where: { key?: string; id?: string };
        }) => {
          const sets = options.sets ?? {};
          return sets[where.key ?? where.id ?? ""] ?? null;
        },
      },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      product: {
        findUnique: async () => {
          calls.productReads += 1;
          if (options.product === null) return null;
          const base = options.product ?? {
            id: "p1",
            attributeSetId: null,
            updatedAt: T1,
          };
          return { ...base, updatedAt: sequence.shift() ?? base.updatedAt };
        },
        updateMany: async (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          calls.updates.push(args);
          return { count: updateCounts.shift() ?? 1 };
        },
      },
    },
  });
  return { admin, calls };
}

const dto = (
  over: Partial<CreateAttributeSetDto> = {},
): CreateAttributeSetDto => ({
  key: "water_treatment",
  name: "Vízkezelő szerek",
  attributes: [
    { attributeKey: "volume", required: true },
    {
      attributeKey: "manufacturerInfo",
      required: true,
      group: "gyártó",
      sortOrder: 5,
    },
    { attributeKey: "dosing", filterable: true },
  ],
  ...over,
});

describe("AttributeSetAdminService.createSet", () => {
  const defs = ["volume", "manufacturerInfo", "dosing"];

  it("creates the set and its links in one transaction, with the defaults, and nothing else", async () => {
    const { admin, calls } = service({ definitions: defs });
    const result = await admin.createSet(dto());
    assert.deepEqual(calls.creates, [
      { key: "water_treatment", name: "Vízkezelő szerek", parentId: null },
    ]);
    assert.deepEqual(calls.links, [
      {
        attributeSetId: "set-new",
        attributeKey: "volume",
        required: true,
        filterable: null,
        group: null,
        sortOrder: 0,
      },
      {
        attributeSetId: "set-new",
        attributeKey: "manufacturerInfo",
        required: true,
        filterable: null,
        group: "gyártó",
        sortOrder: 5,
      },
      {
        attributeSetId: "set-new",
        attributeKey: "dosing",
        required: false,
        filterable: true,
        group: null,
        sortOrder: 2,
      },
    ]);
    assert.equal(result.key, "water_treatment");
    assert.deepEqual(result.attributeKeys, [
      "volume",
      "manufacturerInfo",
      "dosing",
    ]);
  });

  it("refuses an unknown or inactive attribute, naming it, and creates nothing", async () => {
    const { admin, calls } = service({ definitions: ["volume"] });
    await assert.rejects(
      admin.createSet(dto()),
      (e: unknown) =>
        e instanceof BadRequestException &&
        /manufacturerInfo, dosing/.test(e.message),
    );
    assert.deepEqual(calls.creates, []);
  });

  it("refuses an attribute listed twice, and an unknown or inactive parent", async () => {
    const { admin } = service({
      definitions: defs,
      sets: { dead: { id: "s0", isActive: false } },
    });
    await assert.rejects(
      admin.createSet(
        dto({
          attributes: [{ attributeKey: "volume" }, { attributeKey: "volume" }],
        }),
      ),
      (e: unknown) =>
        e instanceof BadRequestException && /volume/.test(e.message),
    );
    await assert.rejects(
      admin.createSet(dto({ parentKey: "nincs" })),
      BadRequestException,
    );
    await assert.rejects(
      admin.createSet(dto({ parentKey: "dead" })),
      BadRequestException,
    );
  });

  it("an active parent is linked by id; an existing key is a 409", async () => {
    const { admin, calls } = service({
      definitions: defs,
      sets: { additive: { id: "set-parent", isActive: true } },
    });
    await admin.createSet(dto({ parentKey: "additive" }));
    assert.equal(calls.creates[0]!.parentId, "set-parent");
    const taken = service({ definitions: defs, existingKey: true });
    await assert.rejects(
      taken.admin.createSet(dto()),
      (e: unknown) => e instanceof ConflictException,
    );
  });
});

describe("AttributeSetAdminService.setProductAttributeSet", () => {
  const sets = {
    "set-1": { id: "set-1", isActive: true },
    "set-off": { id: "set-off", isActive: false },
  };

  it("writes ONLY the attributeSetId, and keeps the product's updatedAt (it must not start a shop projection)", async () => {
    const { admin, calls } = service({ sets });
    const result = await admin.setProductAttributeSet("p1", "set-1");
    assert.deepEqual(result, {
      productId: "p1",
      attributeSetId: "set-1",
      changed: true,
    });
    assert.deepEqual(calls.updates, [
      {
        where: { id: "p1", updatedAt: T1 },
        data: { attributeSetId: "set-1", updatedAt: T1 },
      },
    ]);
  });

  it("works for a UNAS-managed product: the service never reads the authority (the guard is not on this field)", async () => {
    const unas = {
      id: "p-unas",
      attributeSetId: null,
      updatedAt: T1,
      catalogAuthority: "UNAS",
    };
    const { admin, calls } = service({ sets, product: unas });
    await admin.setProductAttributeSet("p-unas", "set-1");
    assert.equal(calls.updates.length, 1);
    assert.deepEqual(Object.keys(calls.updates[0]!.data).sort(), [
      "attributeSetId",
      "updatedAt",
    ]);
  });

  it("null clears the binding; the same value is a no-op without a write", async () => {
    const bound = { id: "p1", attributeSetId: "set-1", updatedAt: T1 };
    const clear = service({ sets, product: bound });
    assert.equal(
      (await clear.admin.setProductAttributeSet("p1", null)).changed,
      true,
    );
    assert.deepEqual(clear.calls.updates[0]!.data, {
      attributeSetId: null,
      updatedAt: T1,
    });
    const same = service({ sets, product: bound });
    assert.equal(
      (await same.admin.setProductAttributeSet("p1", "set-1")).changed,
      false,
    );
    assert.deepEqual(same.calls.updates, []);
  });

  it("an unknown or inactive set is a 400 before the product is read; a missing product is a 404", async () => {
    const off = service({ sets });
    await assert.rejects(
      off.admin.setProductAttributeSet("p1", "set-off"),
      BadRequestException,
    );
    await assert.rejects(
      off.admin.setProductAttributeSet("p1", "nincs"),
      BadRequestException,
    );
    assert.equal(off.calls.productReads, 0);
    const missing = service({ sets, product: null });
    await assert.rejects(
      missing.admin.setProductAttributeSet("p1", "set-1"),
      NotFoundException,
    );
  });

  it("a product that changed in between: re-read, and the NEW updatedAt is the one kept; three misses is a 409", async () => {
    const retry = service({
      sets,
      updatedAtSequence: [T1, T2],
      updateCounts: [0, 1],
    });
    await retry.admin.setProductAttributeSet("p1", "set-1");
    assert.deepEqual(
      retry.calls.updates.map((u) => u.data.updatedAt),
      [T1, T2],
    );
    const stuck = service({ sets, updateCounts: [0, 0, 0] });
    await assert.rejects(
      stuck.admin.setProductAttributeSet("p1", "set-1"),
      (e: unknown) => e instanceof ConflictException,
    );
    assert.equal(stuck.calls.updates.length, 3);
  });
});
