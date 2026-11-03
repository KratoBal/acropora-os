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
const ACTOR = "user-1";

interface Calls {
  /** the binding's audit rows, and whether each write ran INSIDE the transaction callback */
  audits: Array<Record<string, unknown>>;
  order: string[];
  /** the id of the transaction each write ran in (0: outside any transaction) */
  transactionOf: Record<string, number>;
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
  /** the audit write fails (the binding must roll back with it) */
  auditFails?: boolean;
}) {
  const calls: Calls = {
    audits: [],
    order: [],
    transactionOf: {},
    creates: [],
    links: [],
    updates: [],
    productReads: 0,
  };
  let inside = 0;
  let transactions = 0;
  const updateCounts = [...(options.updateCounts ?? [1])];
  const tx = {
    product: {
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        calls.updates.push(args);
        calls.order.push("update");
        calls.transactionOf.update = inside;
        return { count: updateCounts.shift() ?? 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.order.push("audit");
        calls.transactionOf.audit = inside;
        if (options.auditFails) throw new Error("audit write failed");
        calls.audits.push(data);
        return {};
      },
    },
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
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => {
        transactions += 1;
        inside = transactions;
        try {
          return await work(tx);
        } finally {
          inside = 0;
        }
      },
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
    const result = await admin.setProductAttributeSet("p1", "set-1", ACTOR);
    assert.deepEqual(result, {
      productId: "p1",
      attributeSetId: "set-1",
      changed: true,
    });
    assert.deepEqual(calls.updates, [
      {
        where: { id: "p1", updatedAt: T1, attributeSetId: null },
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
    await admin.setProductAttributeSet("p-unas", "set-1", ACTOR);
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
      (await clear.admin.setProductAttributeSet("p1", null, ACTOR)).changed,
      true,
    );
    assert.deepEqual(clear.calls.updates[0]!.data, {
      attributeSetId: null,
      updatedAt: T1,
    });
    const same = service({ sets, product: bound });
    assert.equal(
      (await same.admin.setProductAttributeSet("p1", "set-1", ACTOR)).changed,
      false,
    );
    assert.deepEqual(same.calls.updates, []);
  });

  it("an unknown or inactive set is a 400 before the product is read; a missing product is a 404", async () => {
    const off = service({ sets });
    await assert.rejects(
      off.admin.setProductAttributeSet("p1", "set-off", ACTOR),
      BadRequestException,
    );
    await assert.rejects(
      off.admin.setProductAttributeSet("p1", "nincs", ACTOR),
      BadRequestException,
    );
    assert.equal(off.calls.productReads, 0);
    const missing = service({ sets, product: null });
    await assert.rejects(
      missing.admin.setProductAttributeSet("p1", "set-1", ACTOR),
      NotFoundException,
    );
  });

  it("a product that changed in between: re-read, and the NEW updatedAt is the one kept; three misses is a 409", async () => {
    const retry = service({
      sets,
      updatedAtSequence: [T1, T2],
      updateCounts: [0, 1],
    });
    await retry.admin.setProductAttributeSet("p1", "set-1", ACTOR);
    assert.deepEqual(
      retry.calls.updates.map((u) => u.data.updatedAt),
      [T1, T2],
    );
    const stuck = service({ sets, updateCounts: [0, 0, 0] });
    await assert.rejects(
      stuck.admin.setProductAttributeSet("p1", "set-1", ACTOR),
      (e: unknown) => e instanceof ConflictException,
    );
    assert.equal(stuck.calls.updates.length, 3);
  });

  /*
    A KÖTÉS NYOMOT HAGY (acrobot 41724). MI PIROSÍT: ha a kötés audit sor nélkül menne át; ha az audit
    a kötésen KÍVÜL, külön tranzakcióban születne (egy elbukott audit után a kötés megmaradna); ha a
    visszavétel nem írna; ha változatlan érték vagy elvesztett verseny is sort írna; ha a sor nem
    mondaná meg, ki, melyik termék, mi volt és mi lett.
  */
  it("writes ONE audit row for a bind, in the same transaction, with who, which product, from and to", async () => {
    const { admin, calls } = service({ sets });
    await admin.setProductAttributeSet("p1", "set-1", ACTOR);
    assert.deepEqual(calls.audits, [
      {
        userId: ACTOR,
        action: "product.attribute-set.bound",
        entityType: "Product",
        entityId: "p1",
        metadata: { from: null, to: "set-1" },
      },
    ]);
    assert.deepEqual(calls.order, ["update", "audit"]);
    // both ran in the SAME transaction: one id, and not 0 (outside)
    assert.equal(calls.transactionOf.update, calls.transactionOf.audit);
    assert.ok(calls.transactionOf.audit! > 0);
  });

  it("an unbind writes its own audit row with the old set", async () => {
    const bound = { id: "p1", attributeSetId: "set-1", updatedAt: T1 };
    const { admin, calls } = service({ sets, product: bound });
    await admin.setProductAttributeSet("p1", null, ACTOR);
    assert.deepEqual(calls.audits, [
      {
        userId: ACTOR,
        action: "product.attribute-set.unbound",
        entityType: "Product",
        entityId: "p1",
        metadata: { from: "set-1", to: null },
      },
    ]);
  });

  it("writes no audit row for a no-op, and none for a lost race (only for the write that landed)", async () => {
    const bound = { id: "p1", attributeSetId: "set-1", updatedAt: T1 };
    const same = service({ sets, product: bound });
    await same.admin.setProductAttributeSet("p1", "set-1", ACTOR);
    assert.deepEqual(same.calls.audits, []);
    const race = service({
      sets,
      updatedAtSequence: [T1, T2],
      updateCounts: [0, 1],
    });
    await race.admin.setProductAttributeSet("p1", "set-1", ACTOR);
    assert.equal(race.calls.updates.length, 2);
    assert.equal(race.calls.audits.length, 1);
    const stuck = service({ sets, updateCounts: [0, 0, 0] });
    await assert.rejects(
      stuck.admin.setProductAttributeSet("p1", "set-1", ACTOR),
      ConflictException,
    );
    assert.deepEqual(stuck.calls.audits, []);
  });

  it("a failing audit write fails the whole bind: it ran inside the transaction callback, which rolls back", async () => {
    const { admin, calls } = service({ sets, auditFails: true });
    await assert.rejects(
      admin.setProductAttributeSet("p1", "set-1", ACTOR),
      /audit write failed/,
    );
    assert.equal(calls.transactionOf.update, calls.transactionOf.audit);
    assert.ok(calls.transactionOf.audit! > 0);
  });

  /*
    DUPLA KÖTÉS UGYANARRÓL AZ ÁLLAPOTRÓL (barracuda, #2109): a kötés NEM lépteti az `updatedAt`-et,
    tehát egy másik kötés nem változtatja meg a feltétel értékét. Ha a feltételben csak az
    `updatedAt` állt, A és B ugyanarról a látott állapotról (X, T) indulva MINDKETTEN nyertek, és a
    második audit sor hamis `from`-ot írt (X helyett Y). MI PIROSÍT: a feltétel `attributeSetId` nélkül.
    A dupla állapotot tart, a feltételt ki is értékeli, és a két olvasás között elzár, hogy
    mindkét hívás a régi állapotot lássa.
  */
  it("two bindings from the same seen state: one wins, the other re-reads, and the audit chain is X to Y to Z", async () => {
    const state = { attributeSetId: "X" as string | null, updatedAt: T1 };
    const audits: Array<{ from: unknown; to: unknown; userId: unknown }> = [];
    let reads = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    const tx = {
      product: {
        updateMany: async ({
          where,
          data,
        }: {
          where: {
            id: string;
            updatedAt: Date;
            attributeSetId?: string | null;
          };
          data: { attributeSetId: string | null };
        }) => {
          const matches =
            where.updatedAt === state.updatedAt &&
            (!("attributeSetId" in where) ||
              where.attributeSetId === state.attributeSetId);
          if (!matches) return { count: 0 };
          state.attributeSetId = data.attributeSetId;
          return { count: 1 };
        },
      },
      auditLog: {
        create: async ({
          data,
        }: {
          data: { userId: unknown; metadata: { from: unknown; to: unknown } };
        }) => {
          audits.push({ ...data.metadata, userId: data.userId });
          return {};
        },
      },
    };
    const admin = new AttributeSetAdminService();
    Object.defineProperty(admin, "database", {
      value: {
        attributeSet: {
          findUnique: async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            isActive: true,
          }),
        },
        product: {
          findUnique: async () => {
            reads += 1;
            // the first two reads (one per caller) both see the ORIGINAL state
            if (reads <= 2) {
              const seen = { id: "p1", ...state };
              if (reads === 2) release();
              await bothRead;
              return seen;
            }
            return { id: "p1", ...state };
          },
        },
        $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
          work(tx),
      },
    });
    const results = await Promise.all([
      admin.setProductAttributeSet("p1", "Y", "user-a"),
      admin.setProductAttributeSet("p1", "Z", "user-b"),
    ]);
    assert.deepEqual(
      results.map((r) => r.changed),
      [true, true],
    );
    assert.equal(state.attributeSetId, "Z");
    // the chain is continuous: X to Y, then Y to Z, never X to Z twice
    assert.deepEqual(audits, [
      { from: "X", to: "Y", userId: "user-a" },
      { from: "Y", to: "Z", userId: "user-b" },
    ]);
  });
});
