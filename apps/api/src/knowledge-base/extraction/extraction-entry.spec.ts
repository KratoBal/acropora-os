import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";

import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants.js";
import { vocabularyV1 } from "@acropora/knowledge-base";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import {
  RunAbandoned,
  RunAlreadyRunning,
} from "../discovery/discovery-run.store.js";
import type { ClaimExtractor } from "./claim-extractor.js";
import {
  parseSourceIds,
  runExtractionCli,
  type ExtractionCliDeps,
} from "./extraction.cli.js";
import { KnowledgeExtractionController } from "./extraction.controller.js";
import {
  KnowledgeExtractionService,
  type ExtractionServiceDeps,
} from "./extraction.service.js";
import type { ExtractionStore } from "./extraction-store.js";
import { JATS, aiClaim } from "./extraction-test-fixtures.js";

/**
 * THE EXTRACTION'S TWO DOORS (S3): the CLI and the 202 endpoint. WHAT TURNS
 * IT RED: a store without the switch or without an actor; a second run while
 * one is RUNNING (here, or the database's index); a run that throws left
 * RUNNING; the heartbeat not stopped; the endpoint without its permission.
 */
const SRC = "cmsrc00000001";

function fakes(alreadyExtracted = false) {
  const calls: string[] = [];
  const staleBefore: string[] = [];
  const store = {
    source: async (id: string) => ({
      id,
      pmcid: "PMC1",
      retracted: false,
      included: true,
      alreadyExtracted,
      retractionUnchecked: false,
    }),
    saveSource: async (input: {
      claims: unknown[];
      replaceCandidatesBy?: string;
    }) => {
      calls.push(
        `save:${input.claims.length}${input.replaceCandidatesBy ? `:replace=${input.replaceCandidatesBy}` : ""}`,
      );
      return {
        claimsCreated: input.claims.length,
        anchorsCreated: 0,
        questions: 0,
      };
    },
    startRun: async (input: { requestedById: string; sourceIds: string[] }) => {
      calls.push(`start:${input.requestedById}:${input.sourceIds.join(",")}`);
      return "run-1";
    },
    finishRun: async (runId: string, _report: unknown, created: number) => {
      calls.push(`finish:${runId}:${created}`);
    },
    failRun: async (runId: string, reason: string) => {
      calls.push(`fail:${runId}:${reason}`);
    },
    heartbeat: async (runId: string) => {
      calls.push(`beat:${runId}`);
    },
    abandonStale: async (before: Date) => {
      staleBefore.push(before.toISOString());
      return 0;
    },
    listRuns: async () => [],
    getRun: async () => null,
  } as unknown as ExtractionStore;
  const extractor: ClaimExtractor = {
    extract: async () => ({
      kind: "ANSWER",
      claims: [aiClaim()],
      refusedClaims: [],
      extractedBy: "m claim-extraction/v1",
    }),
  };
  const base = {
    env: { KNOWLEDGE_DISCOVERY: "on" } as NodeJS.ProcessEnv,
    store,
    extractor: extractor as ClaimExtractor | null,
    fetch: async () => new Response(JATS, { status: 200 }),
    vocabulary: vocabularyV1(),
    now: () => new Date("2026-10-23T15:00:00Z"),
    every: (beat: () => void) => {
      beat();
      return () => calls.push("stop");
    },
  };
  return { calls, base, staleBefore };
}

function output() {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    sink: {
      stdout: (t: string) => (out.stdout += t),
      stderr: (t: string) => (out.stderr += t),
    },
  };
}

describe("knowledge:extract", () => {
  const cli = (over: Partial<ExtractionCliDeps> = {}, extracted = false) => {
    const f = fakes(extracted);
    const deps: ExtractionCliDeps = {
      ...f.base,
      actorExists: async (id) => id === "u-1",
      ...over,
    };
    return { ...f, deps };
  };

  it("without --apply it previews: counts and codes, nothing stored, no text", async () => {
    const t = cli();
    const o = output();
    assert.equal(await runExtractionCli(["--source", SRC], o.sink, t.deps), 0);
    assert.deepEqual(t.calls, []);
    assert.match(o.out.stdout, /PREVIEWED, 3 szakasz, 1 AI-hívás/);
    assert.match(o.out.stdout, /állítás 1, mező 9, szerkesztői kérdés 1/);
    assert.doesNotMatch(o.out.stdout, /Calcification|Porites/);
  });

  it("--apply stores under a run, beats, and stops beating", async () => {
    const t = cli();
    const o = output();
    assert.equal(
      await runExtractionCli(
        ["--source", SRC, "--apply", "--actor", "u-1"],
        o.sink,
        t.deps,
      ),
      0,
    );
    assert.deepEqual(t.calls, [
      `start:u-1:${SRC}`,
      "beat:run-1",
      "save:1",
      "finish:run-1:1",
      "stop",
    ]);
  });

  it("--reextract reads an extracted source again, and with --apply withdraws in the actor's name (acrobot 35808)", async () => {
    const skipped = cli({}, true);
    const o1 = output();
    await runExtractionCli(
      ["--source", SRC, "--apply", "--actor", "u-1"],
      o1.sink,
      skipped.deps,
    );
    assert.match(o1.out.stdout, /SKIPPED \(ALREADY_EXTRACTED\)/);
    const again = cli({}, true);
    const o2 = output();
    assert.equal(
      await runExtractionCli(
        ["--source", SRC, "--apply", "--actor", "u-1", "--reextract"],
        o2.sink,
        again.deps,
      ),
      0,
    );
    assert.ok(
      again.calls.includes("save:1:replace=u-1"),
      again.calls.join(" "),
    );
    const preview = cli({}, true);
    const o3 = output();
    await runExtractionCli(
      ["--source", SRC, "--reextract"],
      o3.sink,
      preview.deps,
    );
    assert.match(o3.out.stdout, /PREVIEWED/);
    assert.deepEqual(preview.calls, []);
  });

  it("the switch, the AI, the actor, the ids, the one running run", async () => {
    const off = cli({ env: {} });
    assert.equal(
      await runExtractionCli(
        ["--source", SRC, "--apply", "--actor", "u-1"],
        output().sink,
        off.deps,
      ),
      1,
    );
    assert.deepEqual(off.calls, []);
    assert.equal(
      await runExtractionCli(
        ["--source", SRC],
        output().sink,
        cli({ extractor: null }).deps,
      ),
      1,
    );
    assert.equal(
      await runExtractionCli(
        ["--source", SRC, "--apply", "--actor", "nincs"],
        output().sink,
        cli().deps,
      ),
      2,
    );
    assert.equal(
      await runExtractionCli(
        ["--source", "NOT AN ID"],
        output().sink,
        cli().deps,
      ),
      2,
    );
    const busy = cli();
    (
      busy.deps.store as unknown as { startRun: () => Promise<string> }
    ).startRun = async () => {
      throw new RunAlreadyRunning();
    };
    assert.equal(
      await runExtractionCli(
        ["--source", SRC, "--apply", "--actor", "u-1"],
        output().sink,
        busy.deps,
      ),
      5,
    );
  });

  it("a run that throws is FAILED by name, and the heartbeat stops", async () => {
    const t = cli();
    (
      t.deps.store as unknown as { saveSource: () => Promise<never> }
    ).saveSource = async () => {
      throw new SyntaxError("a source's text that must not be stored");
    };
    await assert.rejects(
      runExtractionCli(
        ["--source", SRC, "--apply", "--actor", "u-1"],
        output().sink,
        t.deps,
      ),
      SyntaxError,
    );
    assert.deepEqual(t.calls, [
      `start:u-1:${SRC}`,
      "beat:run-1",
      "fail:run-1:SyntaxError",
      "stop",
    ]);
  });

  it("--apply fails a silent RUNNING row first; a run failed as stale meanwhile exits 6", async () => {
    const t = cli();
    await runExtractionCli(
      ["--source", SRC, "--apply", "--actor", "u-1"],
      output().sink,
      t.deps,
    );
    // now() is 15:00:00Z; silent for 5 minutes = before 14:55:00Z
    assert.deepEqual(t.staleBefore, ["2026-10-23T14:55:00.000Z"]);
    const p = cli();
    await runExtractionCli(["--source", SRC], output().sink, p.deps);
    assert.deepEqual(p.staleBefore, [], "a preview fails nothing");
    const late = cli();
    (
      late.deps.store as unknown as {
        finishRun: (id: string) => Promise<never>;
      }
    ).finishRun = async (id) => {
      throw new RunAbandoned(id);
    };
    const o = output();
    assert.equal(
      await runExtractionCli(
        ["--source", SRC, "--apply", "--actor", "u-1"],
        o.sink,
        late.deps,
      ),
      6,
    );
    assert.match(o.out.stderr, /elhagyottnak jelölte/);
  });

  it("a preview needs the switch too: it is a paid model call (barracuda, #1838)", async () => {
    const t = cli({ env: {} });
    let fetched = 0;
    t.deps.fetch = async () => {
      fetched += 1;
      return new Response(JATS, { status: 200 });
    };
    assert.equal(
      await runExtractionCli(["--source", SRC], output().sink, t.deps),
      1,
    );
    assert.equal(fetched, 0);
  });

  it("source ids: a comma list, at most five, cuid-shaped", () => {
    assert.deepEqual(parseSourceIds(`${SRC}, ${SRC}`), [SRC]);
    assert.equal(
      typeof parseSourceIds(
        "a,b,c,d,e,f"
          .split(",")
          .map((x) => `cm${x}0000000`)
          .join(","),
      ),
      "string",
    );
    assert.equal(typeof parseSourceIds(""), "string");
    assert.equal(typeof parseSourceIds("'; DROP"), "string");
  });
});

describe("the extraction endpoint", () => {
  const USER = { id: "u-1" } as AuthenticatedUser;
  const service = (
    over: Partial<ExtractionServiceDeps> = {},
    extracted = false,
  ) => {
    const f = fakes(extracted);
    return {
      ...f,
      svc: new KnowledgeExtractionService({ ...f.base, ...over }),
    };
  };
  const status = async (p: Promise<unknown>) =>
    p.then(
      () => 200,
      (e: { getStatus?: () => number }) => e.getStatus?.() ?? 0,
    );

  it("starts with the caller as actor, answers RUNNING, and finishes in the background", async () => {
    const t = service();
    assert.deepEqual(await t.svc.start({ sourceIds: [SRC] }, USER), {
      id: "run-1",
      status: "RUNNING",
    });
    await t.svc.inFlight.get("run-1");
    assert.deepEqual(t.calls, [
      `start:u-1:${SRC}`,
      "beat:run-1",
      "save:1",
      "finish:run-1:1",
      "stop",
    ]);
  });

  it("reextract: true reads an extracted source again in the caller's name; without it the source is skipped", async () => {
    const t = service({}, true);
    await t.svc.start({ sourceIds: [SRC], reextract: true }, USER);
    await t.svc.inFlight.get("run-1");
    assert.ok(t.calls.includes("save:1:replace=u-1"), t.calls.join(" "));
    const plain = service({}, true);
    await plain.svc.start({ sourceIds: [SRC] }, USER);
    await plain.svc.inFlight.get("run-1");
    assert.ok(!plain.calls.some((c) => c.startsWith("save:")));
  });

  it("403 with the switch off, 503 without the AI, 400 on bad ids, 409 when one runs", async () => {
    assert.equal(
      await status(service({ env: {} }).svc.start({ sourceIds: [SRC] }, USER)),
      HttpStatus.FORBIDDEN,
    );
    assert.equal(
      await status(
        service({ extractor: null }).svc.start({ sourceIds: [SRC] }, USER),
      ),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
    assert.equal(
      await status(service().svc.start({ sourceIds: [] }, USER)),
      HttpStatus.BAD_REQUEST,
    );
    const busy = service();
    (
      busy.base.store as unknown as { startRun: () => Promise<string> }
    ).startRun = async () => {
      throw new RunAlreadyRunning();
    };
    assert.equal(
      await status(busy.svc.start({ sourceIds: [SRC] }, USER)),
      HttpStatus.CONFLICT,
    );
  });

  it("every route needs knowledge.research.run, and the start answers 202", () => {
    const proto = KnowledgeExtractionController.prototype;
    for (const handler of [proto.start, proto.list, proto.get])
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), [
        PERMISSIONS.KNOWLEDGE_RESEARCH_RUN,
      ]);
    assert.equal(
      Reflect.getMetadata(HTTP_CODE_METADATA, proto.start),
      HttpStatus.ACCEPTED,
    );
  });
});
