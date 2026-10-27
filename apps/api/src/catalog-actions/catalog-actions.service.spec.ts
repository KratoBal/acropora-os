import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { CATALOG_ACTION_KINDS, type CatalogActionKind } from "@acropora/types";

import {
  CATALOG_ACTION_RUNNERS,
  type CatalogActionRunner,
} from "./catalog-actions.runners.js";
import {
  CatalogActionsService,
  PLAN_VALID_MS,
} from "./catalog-actions.service.js";

/*
  THE BRANDS PAGE CATALOG BUTTONS (kezdolap-marka-sav-os). What turns this red:
  an operation that runs without CATALOG_ADMIN_ACTIONS_ENABLED=true (production
  would write); an apply accepted without a fresh, successful, unused plan of
  the same kind; two runs at once; a failure that reads as success.
*/
const ON = { CATALOG_ADMIN_ACTIONS_ENABLED: "true" };

interface Call {
  kind: CatalogActionKind;
  apply: boolean;
  actor: string;
}

function fakeRunner(
  kind: CatalogActionKind,
  calls: Call[],
  behaviour: {
    exit?: number;
    throws?: string;
    gate?: Promise<void>;
  } = {},
): CatalogActionRunner {
  return {
    kind,
    title: kind,
    description: kind,
    async run(apply, actor, out) {
      calls.push({ kind, apply, actor });
      out.stdout(`${kind} ${apply ? "apply" : "plan"} out\n`);
      out.stderr("err line\n");
      await behaviour.gate;
      if (behaviour.throws) throw new Error(behaviour.throws);
      return behaviour.exit ?? 0;
    },
  };
}

function service(
  env: NodeJS.ProcessEnv,
  behaviour: Partial<
    Record<CatalogActionKind, Parameters<typeof fakeRunner>[2]>
  > = {},
) {
  const calls: Call[] = [];
  const s = new CatalogActionsService(
    CATALOG_ACTION_KINDS.map((kind) =>
      fakeRunner(kind, calls, behaviour[kind]),
    ),
    env,
  );
  return { s, calls };
}

describe("the catalog actions follow CATALOG_ADMIN_ACTIONS_ENABLED", () => {
  for (const [label, env] of [
    ["no variable (production)", {}],
    ["false", { CATALOG_ADMIN_ACTIONS_ENABLED: "false" }],
    ["a value other than true", { CATALOG_ADMIN_ACTIONS_ENABLED: "1" }],
  ] as const) {
    it(`off, ${label}: the overview says disabled, every operation is 404, nothing runs`, () => {
      const { s, calls } = service(env);
      assert.deepEqual(s.overview(), { enabled: false, actions: [] });
      assert.throws(() => s.plan("brand-backfill", "u1"), NotFoundException);
      assert.throws(
        () => s.apply("brand-backfill", "x", "u1"),
        NotFoundException,
      );
      assert.throws(() => s.get("x"), NotFoundException);
      assert.deepEqual(calls, []);
    });
  }

  it("on: the overview lists every kind, with no run yet", () => {
    const { s } = service(ON);
    const view = s.overview();
    assert.equal(view.enabled, true);
    assert.deepEqual(
      view.actions.map((a) => [a.kind, a.lastRun]),
      CATALOG_ACTION_KINDS.map((k) => [k, null]),
    );
  });
});

describe("a plan run", () => {
  it("runs the command without apply, as the signed-in user, and keeps both streams", async () => {
    const { s, calls } = service(ON);
    const started = s.plan("brand-backfill", "u1");
    assert.equal(started.status, "running");
    const run = await s.settled(started.id);
    assert.deepEqual(calls, [
      { kind: "brand-backfill", apply: false, actor: "u1" },
    ]);
    assert.equal(run.status, "succeeded");
    assert.equal(run.exitCode, 0);
    assert.equal(run.output, "brand-backfill plan out\nerr line\n");
    assert.equal(s.overview().actions[0]!.lastRun?.id, run.id);
  });

  it("a non-zero exit is a failed run, not a success", async () => {
    const { s } = service(ON, { "brand-backfill": { exit: 1 } });
    const run = await s.settled(s.plan("brand-backfill", "u1").id);
    assert.equal(run.status, "failed");
    assert.equal(run.exitCode, 1);
  });

  it("a thrown error is a failed run with its message, and the output so far is kept", async () => {
    const { s } = service(ON, { "brand-links": { throws: "shop down" } });
    const run = await s.settled(s.plan("brand-links", "u1").id);
    assert.equal(run.status, "failed");
    assert.equal(run.exitCode, null);
    assert.equal(run.error, "shop down");
    assert.match(run.output, /brand-links plan out/);
  });

  it("an unknown kind is 404", () => {
    const { s, calls } = service(ON);
    assert.throws(() => s.plan("categories", "u1"), NotFoundException);
    assert.deepEqual(calls, []);
  });

  it("only one run at a time, across the kinds", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { s, calls } = service(ON, { "brand-backfill": { gate } });
    const first = s.plan("brand-backfill", "u1");
    assert.throws(() => s.plan("brand-links", "u1"), ConflictException);
    assert.throws(() => s.plan("brand-backfill", "u1"), ConflictException);
    release();
    await s.settled(first.id);
    await s.settled(s.plan("brand-links", "u1").id);
    assert.deepEqual(
      calls.map((c) => c.kind),
      ["brand-backfill", "brand-links"],
    );
  });
});

describe("an apply run needs a fresh, successful, unused plan of the same kind", () => {
  it("confirmed from a good plan: runs with apply, and the plan is used up", async () => {
    const { s, calls } = service(ON);
    const plan = await s.settled(s.plan("brand-backfill", "u1").id);
    const apply = await s.settled(s.apply("brand-backfill", plan.id, "u2").id);
    assert.deepEqual(calls.at(-1), {
      kind: "brand-backfill",
      apply: true,
      actor: "u2",
    });
    assert.equal(apply.status, "succeeded");
    assert.equal(apply.mode, "apply");
    assert.equal(apply.planRunId, plan.id);
    assert.equal(s.get(plan.id).appliedByRunId, apply.id);
    assert.throws(
      () => s.apply("brand-backfill", plan.id, "u2"),
      ConflictException,
    );
    assert.equal(calls.length, 2);
  });

  it("refused without a plan id, with an unknown one, or with another kind's plan", async () => {
    const { s, calls } = service(ON);
    const other = await s.settled(s.plan("brand-links", "u1").id);
    for (const planRunId of [undefined, "", 42, "nope", other.id])
      assert.throws(
        () => s.apply("brand-backfill", planRunId, "u1"),
        BadRequestException,
      );
    assert.equal(calls.filter((c) => c.apply).length, 0);
  });

  it("refused from an apply run used as if it were a plan", async () => {
    const { s, calls } = service(ON);
    const plan = await s.settled(s.plan("brand-links", "u1").id);
    const apply = await s.settled(s.apply("brand-links", plan.id, "u1").id);
    assert.throws(
      () => s.apply("brand-links", apply.id, "u1"),
      BadRequestException,
    );
    assert.equal(calls.filter((c) => c.apply).length, 1);
  });

  it("refused from a failed plan", async () => {
    const { s, calls } = service(ON, { "brand-backfill": { exit: 1 } });
    const plan = await s.settled(s.plan("brand-backfill", "u1").id);
    assert.throws(
      () => s.apply("brand-backfill", plan.id, "u1"),
      BadRequestException,
    );
    assert.equal(calls.filter((c) => c.apply).length, 0);
  });

  it("refused from a plan still running", () => {
    const gate = new Promise<void>(() => {});
    const { s } = service(ON, { "brand-backfill": { gate } });
    const plan = s.plan("brand-backfill", "u1");
    assert.throws(
      () => s.apply("brand-backfill", plan.id, "u1"),
      BadRequestException,
    );
  });

  it("valid at the limit, refused one millisecond past it", async () => {
    const { s, calls } = service(ON);
    const t0 = Date.parse("2026-10-27T12:00:00.000Z");
    s.now = () => new Date(t0);
    const first = await s.settled(s.plan("brand-backfill", "u1").id);
    const second = await s.settled(s.plan("brand-backfill", "u1").id);

    s.now = () => new Date(t0 + PLAN_VALID_MS + 1);
    assert.throws(
      () => s.apply("brand-backfill", first.id, "u1"),
      BadRequestException,
    );
    s.now = () => new Date(t0 + PLAN_VALID_MS);
    await s.settled(s.apply("brand-backfill", second.id, "u1").id);
    assert.equal(calls.filter((c) => c.apply).length, 1);
  });
});

describe("the operations are the existing commands", () => {
  it("one runner per kind, in the order of CATALOG_ACTION_KINDS", () => {
    assert.deepEqual(
      CATALOG_ACTION_RUNNERS.map((r) => r.kind),
      [...CATALOG_ACTION_KINDS],
    );
  });
});
