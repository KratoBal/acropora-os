import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";

import type { CategoryForRedirect } from "./category-redirect-backfill.js";
import { CategoryRedirectBackfillService } from "./category-redirect-backfill.service.js";

/**
 * A KATEGÓRIA-ÁTIRÁNYÍTÁS VÉGPONTJA (commerce audit P1). MI PIROSIT: a szárazfutás ír; az
 * `apply` lenyomat nélkül vagy más lenyomattal mégis ír; egy elutasítást tartalmazó terv
 * íródik; az írás nem hagy AuditLogot; a lenyomat nem függ a képlettől és az adattól.
 */
const fa: CategoryForRedirect[] = [
  { id: "k-root", unasId: "742922", name: "Termékek", parentId: null },
  { id: "k-eled", unasId: "111", name: "Eledelek", parentId: "k-root" },
  { id: "k-triton", unasId: "555", name: "Triton", parentId: "k-root" },
];

function fake(
  categories: CategoryForRedirect[] = fa,
  existing: unknown[] = [],
) {
  const writes: string[] = [];
  const updates: unknown[] = [];
  const created: unknown[] = [];
  const audit: unknown[] = [];
  let tx = false;
  const options: unknown[] = [];
  const base = {
    category: {
      findMany: async () =>
        categories.map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
        })),
    },
    externalReference: {
      findMany: async () =>
        categories
          .filter((c) => c.unasId)
          .map((c) => ({ entityId: c.id, externalId: c.unasId! })),
    },
    urlRedirect: {
      findMany: async () => existing,
      createMany: async (a: { data: unknown[] }) => {
        writes.push("createMany");
        created.push(...a.data);
      },
      update: async (a: unknown) => {
        writes.push("update");
        updates.push(a);
      },
    },
    auditLog: {
      create: async (a: { data: unknown }) => {
        writes.push("auditLog");
        audit.push(a.data);
      },
    },
    $executeRaw: async () => {
      writes.push("lock");
      return 0;
    },
  };
  const db = {
    ...base,
    $transaction: async (
      fn: (t: typeof base) => Promise<unknown>,
      opts?: unknown,
    ) => {
      options.push(opts);
      tx = true;
      try {
        return await fn(base);
      } finally {
        tx = false;
      }
    },
  };
  return { db, writes, created, updates, audit, options, inTx: () => tx };
}

const service = (f: ReturnType<typeof fake>) =>
  new CategoryRedirectBackfillService(f.db as never);
const PATHS = ["/sct/111/Eledelek", "/spl/999/Ismeretlen", "/blog"];

describe("CategoryRedirectBackfillService", () => {
  it("szárazfutás: jelentés és lenyomat, semmi nem íródik", async () => {
    const f = fake();
    const r = await service(f).run({ paths: PATHS, form: "current" }, "u1");
    assert.equal(r.applied, false);
    assert.equal(r.report.created, 1);
    assert.deepEqual(r.report.unknownId, ["/spl/999/Ismeretlen"]);
    assert.match(r.planHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(f.writes, []);
  });

  it("a lenyomat ugyanarra a bemenetre ugyanaz, más képletre vagy más adatra más", async () => {
    const a = await service(fake()).run(
      { paths: PATHS, form: "current" },
      "u1",
    );
    const b = await service(fake()).run(
      { paths: PATHS, form: "current" },
      "u1",
    );
    const c = await service(fake()).run({ paths: PATHS, form: "legacy" }, "u1");
    const d = await service(
      fake([
        ...fa,
        { id: "k-x", unasId: "777", name: "Új", parentId: "k-root" },
      ]),
    ).run({ paths: [...PATHS, "/sct/777/Uj"], form: "current" }, "u1");
    assert.equal(a.planHash, b.planHash);
    assert.notEqual(a.planHash, c.planHash);
    assert.notEqual(a.planHash, d.planHash);
  });

  it("apply lenyomat nélkül 400, és nem ír", async () => {
    const f = fake();
    await assert.rejects(
      service(f).run({ paths: PATHS, form: "current", apply: true }, "u1"),
      BadRequestException,
    );
    assert.deepEqual(f.writes, []);
  });

  it("apply a szárazfutás lenyomatával: egy tranzakcióban zár alatt ír, AuditLogot hagy", async () => {
    const f = fake();
    const sz = await service(f).run({ paths: PATHS, form: "current" }, "u1");
    const r = await service(f).run(
      { paths: PATHS, form: "current", apply: true, planHash: sz.planHash },
      "u1",
    );
    assert.equal(r.applied, true);
    // az írás tranzakciója nem a Prisma 5 mp-es alapértékével fut (a teljes betöltés benne van)
    assert.deepEqual(f.options, [{ timeout: 60_000, maxWait: 10_000 }]);
    assert.deepEqual(f.writes, ["lock", "createMany", "auditLog"]);
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.audit[0], {
      userId: "u1",
      action: "seo.redirects.category-backfill",
      entityType: "UrlRedirect",
      metadata: {
        form: "current",
        paths: 3,
        repoint: false,
        created: 1,
        updated: 0,
        rewritten: 0,
        manualRewritten: [],
        planHash: sz.planHash,
      },
    });
  });

  it("apply más lenyomattal (közben változott az adat): 409, nem ír", async () => {
    const f = fake();
    const sz = await service(f).run({ paths: PATHS, form: "current" }, "u1");
    const valtozott = fake([
      ...fa,
      { id: "k-x", unasId: "777", name: "Új", parentId: "k-root" },
    ]);
    await assert.rejects(
      service(valtozott).run(
        {
          paths: [...PATHS, "/sct/777/Uj"],
          form: "current",
          apply: true,
          planHash: sz.planHash,
        },
        "u1",
      ),
      ConflictException,
    );
    assert.deepEqual(valtozott.writes, ["lock"]); // a zár megvolt, írás nem
  });

  it("elutasítást tartalmazó terv: 422, nem ír (a lenyomat egyezik, mégsem)", async () => {
    // két kategória ugyanazt a handle-t kapná
    const dupla = fake([
      ...fa,
      { id: "k-x", unasId: "666", name: "TRITON", parentId: "k-eled" },
    ]);
    const paths = ["/sct/555/Triton", "/sct/666/TRITON"];
    const sz = await service(dupla).run({ paths, form: "current" }, "u1");
    assert.ok(sz.report.refused.length >= 1);
    await assert.rejects(
      service(dupla).run(
        { paths, form: "current", apply: true, planHash: sz.planHash },
        "u1",
      ),
      UnprocessableEntityException,
    );
    assert.equal(dupla.created.length, 0);
    assert.ok(!dupla.writes.includes("createMany"));
  });

  it("a medusa képlet a kirakat tényleges kategóriáit kéri: lista nélkül 400, listával a valódi handle; más lista más lenyomat", async () => {
    const f = fake();
    await assert.rejects(
      service(f).run({ paths: PATHS, form: "medusa" }, "u1"),
      BadRequestException,
    );
    const a = await service(f).run(
      {
        paths: ["/sct/111/Eledelek"],
        form: "medusa",
        medusaCategories: [
          { handle: "termékek", name: "Termékek", parent: null },
          {
            handle: "eledelek---termékek",
            name: "Eledelek - Termékek",
            parent: "termékek",
          },
        ],
      },
      "u1",
    );
    assert.deepEqual(a.report.createdRules, [
      {
        source: "/sct/111/Eledelek",
        destination: "/hu/categories/eledelek---termékek",
      },
    ]);
    const b = await service(f).run(
      {
        paths: ["/sct/111/Eledelek"],
        form: "medusa",
        medusaCategories: [
          { handle: "termekek", name: "Termékek", parent: null },
          { handle: "eledelek", name: "Eledelek", parent: "termekek" },
        ],
      },
      "u1",
    );
    assert.notEqual(a.planHash, b.planHash);
    assert.deepEqual(f.writes, []);
  });

  // kártya f6cb0a51: a kategória-átvétel óta a régi `név---szülő` cél 404; a `repoint` a meglévő UNAS_CATEGORY szabályt írja át.
  // MI PIROSIT: a repoint nélkül ír a meglévő szabályra; a lenyomat nem függ a repoint-tól (a szárazfutás nélkül is mehet az írás);
  // az írás nem a szárazfutás szerinti szabályt írja át; az AuditLog nem jelzi az átírást.
  it("repoint: a meglévő UNAS_CATEGORY szabály célja átíródik, a lenyomat más, és az írás csak a repoint-os lenyomattal megy", async () => {
    const meglevo = [
      {
        id: "r1",
        sourcePath: "/sct/111/Eledelek",
        destinationPath: "/hu/categories/eledelek-termekek",
        isActive: true,
        reason: "UNAS_CATEGORY",
      },
    ];
    const f = fake(fa, meglevo);
    const nelkul = await service(f).run(
      { paths: ["/sct/111/Eledelek"], form: "current" },
      "u1",
    );
    assert.equal(nelkul.report.conflicts.length, 1);
    assert.equal(nelkul.report.rewritten.length, 0);
    const repoint = await service(f).run(
      { paths: ["/sct/111/Eledelek"], form: "current", repoint: true },
      "u1",
    );
    assert.equal(repoint.report.rewritten.length, 1);
    assert.equal(repoint.report.conflicts.length, 0);
    assert.notEqual(repoint.planHash, nelkul.planHash);
    assert.deepEqual(f.writes, []); // egyik szárazfutás sem írt

    // a repoint nélküli lenyomattal repoint-os írás: 409 (más a terv), nem ír
    await assert.rejects(
      service(f).run(
        {
          paths: ["/sct/111/Eledelek"],
          form: "current",
          repoint: true,
          apply: true,
          planHash: nelkul.planHash,
        },
        "u1",
      ),
      ConflictException,
    );
    assert.deepEqual(f.writes, ["lock"]);

    const r = await service(f).run(
      {
        paths: ["/sct/111/Eledelek"],
        form: "current",
        repoint: true,
        apply: true,
        planHash: repoint.planHash,
      },
      "u1",
    );
    assert.equal(r.applied, true);
    assert.equal(f.updates.length, 1);
    assert.deepEqual(f.updates[0], {
      where: { id: "r1" },
      data: {
        destinationPath: "/hu/categories/eledelek",
        destinationPathLower: "/hu/categories/eledelek",
        reason: "UNAS_CATEGORY",
        entityType: null,
        entityId: null,
        isActive: true,
        createdById: null,
      },
    });
    const naplo = f.audit[0] as { metadata: Record<string, unknown> };
    assert.equal(naplo.metadata.repoint, true);
    assert.equal(naplo.metadata.rewritten, 1);
    assert.equal(naplo.metadata.updated, 1);
  });

  // kártya f6cb0a51: a MANUAL szabály kifejezett engedélylistája. MI PIROSIT: a lista repoint nélkül elfogadódik (és hallgat); az írás a lista
  // nélküli lenyomattal megy; a MANUAL szabály célja átíródik, de a készítője elvész; az AuditLog nem nevezi meg az átírt MANUAL forrásokat.
  it("repointManual: repoint nélkül 400; a listával a MANUAL szabály átíródik, a készítő megmarad, az AuditLog megnevezi; a lista nélküli lenyomat 409", async () => {
    const meglevo = [
      {
        id: "r1",
        sourcePath: "/sct/111/Eledelek",
        destinationPath: "/hu/categories/eledelek-termekek",
        isActive: true,
        reason: "MANUAL",
        createdAt: new Date("2026-10-30T09:37:00.000Z"),
        createdById: "u-flotta",
      },
    ];
    const f = fake(fa, meglevo);
    await assert.rejects(
      service(f).run(
        {
          paths: ["/sct/111/Eledelek"],
          form: "current",
          repointManual: ["/sct/111/Eledelek"],
        },
        "u1",
      ),
      BadRequestException,
    );

    // egy érvénytelen lista-elem (elgépelés) elutasítva: hibásan nem fut, nem ír
    await assert.rejects(
      service(f).run(
        {
          paths: ["/sct/111/Eledelek"],
          form: "current",
          repoint: true,
          repointManual: ["/sct/111/Eledelek", "/elgepelt ut"],
        },
        "u1",
      ),
      BadRequestException,
    );
    assert.deepEqual(f.writes, []);

    const listaNelkul = await service(f).run(
      { paths: ["/sct/111/Eledelek"], form: "current", repoint: true },
      "u1",
    );
    assert.equal(listaNelkul.report.rewritten.length, 0);
    const listaval = await service(f).run(
      {
        paths: ["/sct/111/Eledelek"],
        form: "current",
        repoint: true,
        repointManual: ["/sct/111/Eledelek"],
      },
      "u1",
    );
    assert.equal(listaval.report.rewritten[0]?.via, "manual-allowlist");
    assert.notEqual(listaval.planHash, listaNelkul.planHash);
    assert.deepEqual(f.writes, []); // egyik szárazfutás sem írt

    // a lista nélküli lenyomattal a listás írás: 409
    await assert.rejects(
      service(f).run(
        {
          paths: ["/sct/111/Eledelek"],
          form: "current",
          repoint: true,
          repointManual: ["/sct/111/Eledelek"],
          apply: true,
          planHash: listaNelkul.planHash,
        },
        "u1",
      ),
      ConflictException,
    );

    const r = await service(f).run(
      {
        paths: ["/sct/111/Eledelek"],
        form: "current",
        repoint: true,
        repointManual: ["/sct/111/Eledelek"],
        apply: true,
        planHash: listaval.planHash,
      },
      "u1",
    );
    assert.equal(r.applied, true);
    assert.deepEqual(f.updates[0], {
      where: { id: "r1" },
      data: {
        destinationPath: "/hu/categories/eledelek",
        destinationPathLower: "/hu/categories/eledelek",
        reason: "UNAS_CATEGORY",
        entityType: null,
        entityId: null,
        isActive: true,
        createdById: "u-flotta",
      },
    });
    const naplo = f.audit[0] as { metadata: Record<string, unknown> };
    assert.deepEqual(naplo.metadata.manualRewritten, ["/sct/111/Eledelek"]);
  });
});
