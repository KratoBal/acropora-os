import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { MemoryRedirectStore } from "./redirect-memory-store.js";
import { redirectPathLower } from "./redirect-path.js";
import {
  parseBatchChanges,
  planRedirectUndo,
  undoPlanHash,
  type CurrentRule,
} from "./redirect-undo.js";
import { RedirectUndoService } from "./redirect-undo.service.js";

/**
 * AZ ÁTIRÁNYÍTÁS-KÖTEG VISSZAVONÁSA (card f6cb0a51, az éles lánc előtt). MI PIROSIT:
 * - a nyilvántartás nem a régi (első módosítás előtti) célt őrzi, vagy az új szabály forrás nélkül marad;
 * - a visszavonás olyan szabályhoz is nyúl, amely azóta másképp változott (a későbbi változás elveszne);
 * - egy már kikapcsolt vagy átírt új szabályt kikapcsol;
 * - a visszavonás láncot hoz létre, és mégis megy;
 * - a szárazfutás ír; az írás lenyomat nélkül, rossz lenyomattal vagy kétszer is megy;
 * - egy rögzítés nélküli köteg visszavonhatónak látszik.
 */

const REGI = "/hu/categories/eledelek---termekek";
const UJ = "/hu/categories/eledelek";

describe("MemoryRedirectStore.changes: a visszavonás nyilvántartása", () => {
  it("a módosított szabály régi és új célját is rögzíti, a kisbetűs cél a régiből számolódik", async () => {
    const store = new MemoryRedirectStore([
      {
        id: "r1",
        sourcePath: "/a",
        destinationPath: REGI,
        isActive: true,
        reason: "UNAS_CATEGORY",
      },
    ]);
    await store.update("r1", {
      destinationPath: UJ,
      destinationPathLower: UJ,
    });

    assert.deepEqual(store.changes(), {
      created: [],
      updated: [
        {
          id: "r1",
          source: "/a",
          from: {
            destinationPath: REGI,
            destinationPathLower: redirectPathLower(REGI),
          },
          to: { destinationPath: UJ, destinationPathLower: UJ },
        },
      ],
    });
  });

  it("két módosítás ugyanazon a szabályon: a `from` az ELSŐ előtti állapot", async () => {
    const store = new MemoryRedirectStore([
      { id: "r1", sourcePath: "/a", destinationPath: "/x", isActive: true },
    ]);
    await store.update("r1", { destinationPath: "/y" });
    await store.update("r1", { destinationPath: "/z" });

    const [valtozas] = store.changes().updated;
    assert.equal(valtozas!.from.destinationPath, "/x");
    assert.equal(valtozas!.to.destinationPath, "/z");
  });

  it("az új szabály forrással és céllal áll, a későbbi módosítása az új sorba olvad (nincs `updated`)", async () => {
    const store = new MemoryRedirectStore();
    const uj = await store.create({
      sourcePath: "/uj",
      sourcePathLower: "/uj",
      destinationPath: "/c1",
      destinationPathLower: "/c1",
      reason: "UNAS_PRODUCT",
      entityType: null,
      entityId: null,
      isActive: true,
      createdById: null,
    });
    await store.update(uj.id, { destinationPath: "/c2" });

    assert.deepEqual(store.changes(), {
      created: [{ source: "/uj", destination: "/c2" }],
      updated: [],
    });
  });

  it("a nyilvántartás a TERVET nem változtatja: az `updated()` ugyanaz, mint nélküle", async () => {
    const store = new MemoryRedirectStore([
      { id: "r1", sourcePath: "/a", destinationPath: "/x", isActive: true },
    ]);
    await store.update("r1", { destinationPath: "/y" });

    assert.deepEqual(store.updated(), [
      { id: "r1", data: { destinationPath: "/y" } },
    ]);
  });
});

function szabaly(
  id: string,
  source: string,
  destination: string,
  extra: Partial<CurrentRule> = {},
): CurrentRule {
  return {
    id,
    sourcePath: source,
    destinationPath: destination,
    destinationPathLower: redirectPathLower(destination),
    isActive: true,
    ...extra,
  };
}

const VALTOZAS = {
  created: [{ source: "/n", destination: "/hu/termek/x" }],
  updated: [
    {
      id: "r1",
      source: "/a",
      from: { destinationPath: REGI, destinationPathLower: REGI },
      to: { destinationPath: UJ, destinationPathLower: UJ },
    },
  ],
};

function allapot(sorok: CurrentRule[]) {
  return {
    byId: new Map(sorok.map((s) => [s.id, s])),
    bySource: new Map(sorok.map((s) => [redirectPathLower(s.sourcePath), s])),
    aktiv: sorok.filter((s) => s.isActive),
  };
}

describe("planRedirectUndo", () => {
  it("a módosított szabályt a régi értékére állítja, az újat kikapcsolja, ha ma még pontosan az, amit az írás hagyott", async () => {
    const a = allapot([
      szabaly("r1", "/a", UJ),
      szabaly("rn", "/n", "/hu/termek/x"),
    ]);

    const terv = await planRedirectUndo(
      "b1",
      VALTOZAS,
      a.byId,
      a.bySource,
      a.aktiv,
    );

    assert.deepEqual(terv.restores, [
      {
        id: "r1",
        source: "/a",
        from: VALTOZAS.updated[0]!.from,
        currentDestination: UJ,
      },
    ]);
    assert.deepEqual(terv.deactivations, [
      { id: "rn", source: "/n", destination: "/hu/termek/x" },
    ]);
    assert.deepEqual(terv.skipped, []);
    assert.deepEqual(terv.invariantViolations, []);
  });

  it("a szabályhoz, amely azóta másképp változott, NEM nyúl (a későbbi változás elveszne), és a kihagyás a jelentésben marad", async () => {
    const a = allapot([
      szabaly("r1", "/a", "/mashova-kerult"),
      szabaly("rn", "/n", "/hu/termek/x"),
    ]);

    const terv = await planRedirectUndo(
      "b1",
      VALTOZAS,
      a.byId,
      a.bySource,
      a.aktiv,
    );

    assert.deepEqual(terv.restores, []);
    assert.equal(terv.skipped.length, 1);
    assert.equal(terv.skipped[0]!.kind, "changed-since");
    assert.equal(terv.skipped[0]!.source, "/a");
    assert.equal(terv.deactivations.length, 1);
  });

  it("egy mezőben, amelyet az írás nem érintett (pl. a szabály eredete), a változás nem akadály: a szabály visszaáll", async () => {
    // az írás csak a célt írta át; az eredet azóta más, de az nem az írás nyoma, tehát nem tartja vissza a visszavonást
    const a = allapot([
      szabaly("r1", "/a", UJ, { reason: "MANUAL" }),
      szabaly("rn", "/n", "/hu/termek/x"),
    ]);

    const terv = await planRedirectUndo(
      "b1",
      VALTOZAS,
      a.byId,
      a.bySource,
      a.aktiv,
    );

    assert.equal(terv.restores.length, 1);
    assert.deepEqual(terv.skipped, []);
  });

  it("a már nem létező szabályt kihagyja (`missing`)", async () => {
    const a = allapot([szabaly("rn", "/n", "/hu/termek/x")]);

    const terv = await planRedirectUndo(
      "b1",
      VALTOZAS,
      a.byId,
      a.bySource,
      a.aktiv,
    );

    assert.deepEqual(
      terv.skipped.map((k) => [k.kind, k.source]),
      [["missing", "/a"]],
    );
    assert.equal(terv.deactivations.length, 1);
  });

  it("az új szabályt, amelynek célja azóta megváltozott vagy már inaktív, nem kapcsolja ki", async () => {
    const atirt = allapot([
      szabaly("r1", "/a", UJ),
      szabaly("rn", "/n", "/hu/termek/mas"),
    ]);
    const inaktiv = allapot([
      szabaly("r1", "/a", UJ),
      szabaly("rn", "/n", "/hu/termek/x", { isActive: false }),
    ]);

    const terv1 = await planRedirectUndo(
      "b1",
      VALTOZAS,
      atirt.byId,
      atirt.bySource,
      atirt.aktiv,
    );
    const terv2 = await planRedirectUndo(
      "b1",
      VALTOZAS,
      inaktiv.byId,
      inaktiv.bySource,
      inaktiv.aktiv,
    );

    assert.deepEqual(terv1.deactivations, []);
    assert.equal(terv1.skipped[0]!.kind, "changed-since");
    assert.deepEqual(terv2.deactivations, []);
    assert.equal(terv2.skipped[0]!.reason, "the rule is already inactive");
  });

  it("láncot létrehozó visszavonás: a jelentés megnevezi a szabályt (a régi cél egy másik aktív szabály forrása)", async () => {
    // az /a régi célja a /c, amely maga forrás (C: /c -> /d): a visszaállítás után /a -> /c -> /d lánc
    const valtozas = {
      created: [],
      updated: [
        {
          id: "r1",
          source: "/a",
          from: { destinationPath: "/c", destinationPathLower: "/c" },
          to: { destinationPath: "/b", destinationPathLower: "/b" },
        },
      ],
    };
    const a = allapot([szabaly("r1", "/a", "/b"), szabaly("r2", "/c", "/d")]);

    const terv = await planRedirectUndo(
      "b1",
      valtozas,
      a.byId,
      a.bySource,
      a.aktiv,
    );

    assert.deepEqual(terv.invariantViolations, [
      { source: "/a", destination: "/c" },
    ]);
  });

  it("a lenyomat a tervvel változik (a kihagyás is beleszámít), és ugyanarra a tervre ugyanaz", async () => {
    const tiszta = allapot([
      szabaly("r1", "/a", UJ),
      szabaly("rn", "/n", "/hu/termek/x"),
    ]);
    const eltert = allapot([
      szabaly("r1", "/a", "/mashova-kerult"),
      szabaly("rn", "/n", "/hu/termek/x"),
    ]);

    const egy = await planRedirectUndo(
      "b1",
      VALTOZAS,
      tiszta.byId,
      tiszta.bySource,
      tiszta.aktiv,
    );
    const ketto = await planRedirectUndo(
      "b1",
      VALTOZAS,
      tiszta.byId,
      tiszta.bySource,
      tiszta.aktiv,
    );
    const masik = await planRedirectUndo(
      "b1",
      VALTOZAS,
      eltert.byId,
      eltert.bySource,
      eltert.aktiv,
    );

    assert.equal(undoPlanHash(egy), undoPlanHash(ketto));
    assert.notEqual(undoPlanHash(egy), undoPlanHash(masik));
  });
});

describe("parseBatchChanges", () => {
  it("a rögzített alakot elfogadja, minden mást `null`-lal utasít el", () => {
    assert.deepEqual(parseBatchChanges({ changes: VALTOZAS }), VALTOZAS);
    assert.equal(parseBatchChanges(null), null);
    assert.equal(parseBatchChanges({}), null);
    assert.equal(parseBatchChanges({ changes: { created: [] } }), null);
    assert.equal(
      parseBatchChanges({
        changes: { created: [{ source: 1, destination: "/x" }], updated: [] },
      }),
      null,
    );
    assert.equal(
      parseBatchChanges({
        changes: { created: [], updated: [{ id: "r1", source: "/a" }] },
      }),
      null,
    );
  });
});

function fake(
  opts: {
    batch?: { id: string; action: string; metadata: unknown } | null;
    undone?: boolean;
    rows?: CurrentRule[];
  } = {},
) {
  const rows = opts.rows ?? [
    szabaly("r1", "/a", UJ),
    szabaly("rn", "/n", "/hu/termek/x"),
  ];
  const batch =
    opts.batch === undefined
      ? {
          id: "b1",
          action: "seo.redirects.category-backfill",
          metadata: { changes: VALTOZAS },
        }
      : opts.batch;
  const writes: string[] = [];
  const updates: unknown[] = [];
  const audit: unknown[] = [];
  const db = {
    auditLog: {
      findUnique: async () => batch,
      findFirst: async () => (opts.undone ? { id: "u1" } : null),
      create: async (a: { data: unknown }) => {
        writes.push("auditLog");
        audit.push(a.data);
        return { id: "audit-9" };
      },
    },
    urlRedirect: {
      findMany: async (a: { where: { isActive?: boolean } }) =>
        a.where.isActive === true ? rows.filter((r) => r.isActive) : rows,
      update: async (a: unknown) => {
        writes.push("update");
        updates.push(a);
      },
    },
    $executeRaw: async () => {
      writes.push("lock");
      return 0;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  const service = new RedirectUndoService(
    db as unknown as ConstructorParameters<typeof RedirectUndoService>[0],
  );
  return { service, writes, updates, audit };
}

describe("RedirectUndoService", () => {
  it("a szárazfutás nem ír, és a tervet meg a lenyomatot adja", async () => {
    const f = fake();

    const r = await f.service.run({ batchId: "b1" }, "u1");

    assert.equal(r.applied, false);
    assert.equal(r.report.restores.length, 1);
    assert.equal(r.report.deactivations.length, 1);
    assert.match(r.planHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(f.writes, []);
  });

  it("apply lenyomat nélkül 400, rossz lenyomattal 409: egyik sem ír (a zár után megáll)", async () => {
    const f = fake();

    await assert.rejects(
      f.service.run({ batchId: "b1", apply: true }, "u1"),
      BadRequestException,
    );
    await assert.rejects(
      f.service.run(
        { batchId: "b1", apply: true, planHash: "0".repeat(64) },
        "u1",
      ),
      ConflictException,
    );
    assert.deepEqual(f.writes, ["lock"]);
  });

  it("a helyes lenyomattal visszaállít és kikapcsol, AuditLogot hagy, és a régi értékeket írja vissza", async () => {
    const f = fake();
    const dry = await f.service.run({ batchId: "b1" }, "u1");

    const r = await f.service.run(
      { batchId: "b1", apply: true, planHash: dry.planHash },
      "u1",
    );

    assert.equal(r.applied, true);
    assert.deepEqual(f.writes, ["lock", "update", "update", "auditLog"]);
    assert.deepEqual(f.updates, [
      { where: { id: "r1" }, data: VALTOZAS.updated[0]!.from },
      { where: { id: "rn" }, data: { isActive: false } },
    ]);
    assert.deepEqual(f.audit[0], {
      userId: "u1",
      action: "seo.redirects.undo",
      entityType: "UrlRedirect",
      metadata: {
        batchId: "b1",
        restored: 1,
        deactivated: 1,
        skipped: 0,
        planHash: dry.planHash,
      },
    });
  });

  it("ismeretlen köteg 404, más művelet 400, rögzítés nélküli köteg 422, már visszavont köteg 409", async () => {
    await assert.rejects(
      fake({ batch: null }).service.run({ batchId: "nincs" }, "u1"),
      NotFoundException,
    );
    await assert.rejects(
      fake({
        batch: {
          id: "b1",
          action: "product.update",
          metadata: { changes: VALTOZAS },
        },
      }).service.run({ batchId: "b1" }, "u1"),
      BadRequestException,
    );
    await assert.rejects(
      fake({
        batch: {
          id: "b1",
          action: "seo.redirects.product-backfill",
          metadata: { created: 9, planHash: "x" },
        },
      }).service.run({ batchId: "b1" }, "u1"),
      UnprocessableEntityException,
    );
    await assert.rejects(
      fake({ undone: true }).service.run({ batchId: "b1" }, "u1"),
      ConflictException,
    );
  });

  it("ha a köteg minden szabálya kimaradt, az írás 422 és nem ír (nincs mit visszavonni)", async () => {
    const f = fake({
      rows: [
        szabaly("r1", "/a", "/mashova-kerult"),
        szabaly("rn", "/n", "/hu/termek/mas"),
      ],
    });
    const dry = await f.service.run({ batchId: "b1" }, "u1");
    assert.equal(dry.report.skipped.length, 2);

    await assert.rejects(
      f.service.run(
        { batchId: "b1", apply: true, planHash: dry.planHash },
        "u1",
      ),
      UnprocessableEntityException,
    );
    assert.deepEqual(f.writes, ["lock"]);
  });

  it("a láncot létrehozó visszavonás 422, és nem ír", async () => {
    const f = fake({
      batch: {
        id: "b1",
        action: "seo.redirects.category-backfill",
        metadata: {
          changes: {
            created: [],
            updated: [
              {
                id: "r1",
                source: "/a",
                from: { destinationPath: "/c", destinationPathLower: "/c" },
                to: { destinationPath: "/b", destinationPathLower: "/b" },
              },
            ],
          },
        },
      },
      rows: [szabaly("r1", "/a", "/b"), szabaly("r2", "/c", "/d")],
    });
    const dry = await f.service.run({ batchId: "b1" }, "u1");
    assert.equal(dry.report.invariantViolations.length, 1);

    await assert.rejects(
      f.service.run(
        { batchId: "b1", apply: true, planHash: dry.planHash },
        "u1",
      ),
      UnprocessableEntityException,
    );
    assert.deepEqual(f.writes, ["lock"]);
  });
});
