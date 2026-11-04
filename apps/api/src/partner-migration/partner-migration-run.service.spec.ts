import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  PartnerMigrationPlan,
  PartnerMigrationRow,
} from "@acropora/types";

import type { RestoreOutcome } from "./partner-migration.executor.js";
import {
  cleanBinds,
  PartnerMigrationRunService,
  restoreFingerprint,
  type MigrationSteps,
  type PartnerMigrationRunRepository,
} from "./partner-migration-run.service.js";
import type { PartnerMigrationPlanService } from "./partner-migration.service.js";

/**
 * AZ ÁTVEZETÉS FUTTATÁSA AZ OLDALRÓL (ugyanaz a mag, mint a CLI). MI PIROSÍT: ha a próba ír; ha az írás a lenyomat nélkül vagy
 * elavult lenyomattal elindul; ha hibás döntéssel elindul; ha az író kivétele nyers hibaként ér ki; ha a visszaállítás nem a
 * próba lenyomatával, vagy nem ugyanabban a tranzakcióban számol; ha a törzs rossz alakú kötési döntése átmegy.
 */
const row = (over: Partial<PartnerMigrationRow>): PartnerMigrationRow => ({
  supplierId: "s1",
  code: "P1",
  name: "Partner",
  taxNumber: null,
  country: null,
  isActive: true,
  roles: ["SUPPLIER"],
  worksheetPartnerCode: null,
  linkedCustomer: null,
  candidates: [],
  nameCandidates: [],
  action: "CREATE_NEW",
  notes: [],
  ...over,
});
const planOf = (rows: PartnerMigrationRow[]): PartnerMigrationPlan => ({
  generatedAt: "2026-11-04T00:00:00.000Z",
  total: rows.length,
  byAction: {},
  rows,
});

function setup(rows: PartnerMigrationRow[]) {
  let current = planOf(rows);
  const calls: string[] = [];
  const txMarker = { tx: true };
  const repository = {
    transaction: async <T>(work: (tx: unknown) => Promise<T>) => {
      calls.push("begin");
      try {
        return await work(txMarker);
      } finally {
        calls.push("end");
      }
    },
  } as unknown as PartnerMigrationRunRepository;
  let restoreState: RestoreOutcome[] = [
    { supplierId: "s1", customerId: "c1", result: "RESTORED" },
  ];
  const steps = {
    apply: async (
      tx: unknown,
      operations: readonly { kind: string; code: string }[],
      actor: string | null,
    ) => {
      assert.equal(tx, txMarker);
      calls.push(`apply:${operations.length}:${actor}`);
      return operations.map((op) => ({
        code: op.code,
        mode: op.kind === "SKIP" ? "SKIPPED" : "CREATED",
      }));
    },
    restore: async (tx: unknown, actor: string | null, dry = false) => {
      assert.equal(tx, txMarker);
      calls.push(`restore:${dry ? "dry" : "write"}:${actor}`);
      return restoreState;
    },
  } as unknown as MigrationSteps;
  const plan = {
    build: async () => current,
  } as unknown as PartnerMigrationPlanService;
  return {
    service: new PartnerMigrationRunService(plan, repository, steps),
    calls,
    setPlan: (rows2: PartnerMigrationRow[]) => (current = planOf(rows2)),
    setRestore: (next: RestoreOutcome[]) => (restoreState = next),
  };
}

describe("PartnerMigrationRunService.preview", () => {
  it("decides the operations, counts them, names the target and the fingerprint, and writes nothing", async () => {
    const w = setup([
      row({ supplierId: "s1", code: "P1" }),
      row({
        supplierId: "s2",
        code: "P2",
        action: "BIND_EXISTING",
        candidates: [
          {
            id: "c9",
            customerNumber: "V-9",
            displayName: "X",
            taxNumber: null,
            euTaxNumber: null,
            fromUnas: true,
            references: 0,
          },
        ],
      }),
      row({ supplierId: "s3", code: "P3", action: "SKIP_OWN" }),
    ]);
    const preview = await w.service.preview();
    assert.deepEqual(preview.counts, { create: 1, bind: 1, skip: 1 });
    assert.equal(preview.operations[1]!.customerId, "c9");
    assert.match(preview.operations[2]!.reason ?? "", /saját cég/);
    assert.match(preview.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(typeof preview.target, "string");
    assert.deepEqual(w.calls, []);
  });
});

describe("PartnerMigrationRunService.apply", () => {
  it("writes in one transaction with the actor when the fingerprint is the previewed one", async () => {
    const w = setup([row({})]);
    const { fingerprint } = await w.service.preview();
    const result = await w.service.apply(fingerprint, undefined, "u1");
    assert.deepEqual(w.calls, ["begin", "apply:1:u1", "end"]);
    assert.deepEqual(
      result.outcomes.map((o) => o.mode),
      ["CREATED"],
    );
  });

  it("refuses a stale fingerprint (the plan changed since the preview) and writes nothing", async () => {
    const w = setup([row({})]);
    const { fingerprint } = await w.service.preview();
    w.setPlan([row({}), row({ supplierId: "s2", code: "P2" })]);
    await assert.rejects(
      w.service.apply(fingerprint, undefined, "u1"),
      /közben változott/,
    );
    await assert.rejects(
      w.service.apply("0".repeat(64), undefined, "u1"),
      /közben változott/,
    );
    assert.deepEqual(w.calls, []);
  });

  it("refuses wrong binds even with a matching-looking fingerprint, and writes nothing", async () => {
    const w = setup([row({})]);
    const { fingerprint } = await w.service.preview();
    await assert.rejects(
      w.service.apply(fingerprint, { P1: "c1" }, "u1"),
      /döntések hibásak/,
    );
    assert.deepEqual(w.calls, []);
  });

  it("turns a stale-plan error of the writer into a conflict with its message", async () => {
    const w = setup([row({})]);
    const { fingerprint } = await w.service.preview();
    const failing = new PartnerMigrationRunService(
      { build: async () => planOf([row({})]) } as never,
      {
        transaction: async (work: (tx: unknown) => Promise<unknown>) =>
          work({}),
      } as never,
      {
        apply: async () => {
          throw new Error("A(z) P1 partnernek már van kötött vevő-sora.");
        },
        restore: async () => [],
      } as never,
    );
    await assert.rejects(
      failing.apply(fingerprint, undefined, "u1"),
      (error: Error) =>
        error.constructor.name === "ConflictException" &&
        /már van kötött/.test(error.message),
    );
  });
});

describe("PartnerMigrationRunService restore", () => {
  it("the preview does not write, and its fingerprint follows the outcomes", async () => {
    const w = setup([row({})]);
    const preview = await w.service.restorePreview();
    assert.deepEqual(w.calls, ["begin", "restore:dry:null", "end"]);
    assert.equal(
      preview.fingerprint,
      restoreFingerprint(preview.outcomes as RestoreOutcome[]),
    );
    w.setRestore([
      { supplierId: "s1", customerId: "c1", result: "KEPT", detail: "x" },
    ]);
    assert.notEqual(
      (await w.service.restorePreview()).fingerprint,
      preview.fingerprint,
    );
  });

  it("the write recomputes the preview in the same transaction, then restores; a changed set is a conflict and writes nothing", async () => {
    const w = setup([row({})]);
    const { fingerprint } = await w.service.restorePreview();
    w.calls.length = 0;
    await w.service.restoreApply(fingerprint, "u1");
    assert.deepEqual(w.calls, [
      "begin",
      "restore:dry:u1",
      "restore:write:u1",
      "end",
    ]);
    w.calls.length = 0;
    w.setRestore([]);
    await assert.rejects(
      w.service.restoreApply(fingerprint, "u1"),
      /közben változtak/,
    );
    assert.deepEqual(w.calls, ["begin", "restore:dry:u1", "end"]);
  });
});

describe("cleanBinds", () => {
  it("accepts string pairs and nothing else", () => {
    assert.deepEqual(cleanBinds(undefined), {});
    assert.deepEqual(cleanBinds({ P1: "c1" }), { P1: "c1" });
    assert.throws(() => cleanBinds({ P1: 5 }), /nem vevő-sor azonosító/);
    assert.throws(() => cleanBinds({ P1: "" }), /nem vevő-sor azonosító/);
    assert.throws(() => cleanBinds(["a"]), /objektum/);
    assert.throws(() => cleanBinds("x"), /objektum/);
  });
});

describe("restoreFingerprint", () => {
  it("does not depend on the order and changes with a result or a row", () => {
    const a: RestoreOutcome = {
      supplierId: "s1",
      customerId: "c1",
      result: "RESTORED",
    };
    const b: RestoreOutcome = {
      supplierId: "s2",
      customerId: "c2",
      result: "KEPT",
    };
    assert.equal(restoreFingerprint([a, b]), restoreFingerprint([b, a]));
    assert.notEqual(
      restoreFingerprint([a, b]),
      restoreFingerprint([a, { ...b, result: "RESTORED" }]),
    );
    assert.notEqual(restoreFingerprint([a, b]), restoreFingerprint([a]));
  });
});
