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

function fake(categories: CategoryForRedirect[] = fa) {
  const writes: string[] = [];
  const created: unknown[] = [];
  const audit: unknown[] = [];
  let tx = false;
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
      findMany: async () => [],
      createMany: async (a: { data: unknown[] }) => {
        writes.push("createMany");
        created.push(...a.data);
      },
      update: async () => writes.push("update"),
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
    $transaction: async (fn: (t: typeof base) => Promise<unknown>) => {
      tx = true;
      try {
        return await fn(base);
      } finally {
        tx = false;
      }
    },
  };
  return { db, writes, created, audit, inTx: () => tx };
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
    assert.deepEqual(f.writes, ["lock", "createMany", "auditLog"]);
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.audit[0], {
      userId: "u1",
      action: "seo.redirects.category-backfill",
      entityType: "UrlRedirect",
      metadata: {
        form: "current",
        paths: 3,
        created: 1,
        updated: 0,
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
});
