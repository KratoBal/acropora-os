import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "reflect-metadata";

import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants.js";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { KnowledgeDiscoveryController } from "./discovery-run.controller.js";
import { CROSSREF_BASE, EUROPE_PMC_BASE } from "./discovery-run.js";
import {
  KnowledgeDiscoveryService,
  STALE_AFTER_MS,
  type DiscoveryServiceDeps,
} from "./discovery-run.service.js";
import { RunAlreadyRunning, type StoreSummary } from "./discovery-run.store.js";
import {
  crossrefList,
  europePmcList,
  europePmcResult,
  fakeClock,
  scriptedApis,
} from "./discovery-test-fixtures.js";

const USER = { id: "u-1" } as AuthenticatedUser;
const BODY = {
  label: "vegpont-teszt",
  europePmc: [{ query: "phosphate AND Acropora", maxResults: 5 }],
};

const SUMMARY: StoreSummary = {
  runId: "run-1",
  created: 1,
  matched: 0,
  versionsCreated: 0,
  claimsDisputed: 0,
  ambiguous: [],
  unchecked: 0,
  retractionUnchecked: 0,
};

function service(
  over: Partial<DiscoveryServiceDeps> = {},
  running: { id: string; startedAt: Date } | null = null,
) {
  const calls: string[] = [];
  const network = scriptedApis([
    [
      `${EUROPE_PMC_BASE}/search?query=phosphate`,
      { status: 200, body: europePmcList([europePmcResult()], 853) },
    ],
    [
      `${CROSSREF_BASE}/works?filter=doi:`,
      { status: 200, body: crossrefList([{ DOI: "10.5555/coral.1" }]) },
    ],
  ]);
  const clock = fakeClock();
  const deps: DiscoveryServiceDeps = {
    env: { KNOWLEDGE_DISCOVERY: "on" },
    store: {
      preview: async () => SUMMARY,
      startRun: async (start) => {
        calls.push(`start:${start.requestedById}:${start.input.label}`);
        return "run-1";
      },
      finishRun: async (runId, result) => {
        calls.push(`finish:${runId}:${result.status}`);
        return SUMMARY;
      },
      failRun: async (runId, reason) => {
        calls.push(`fail:${runId}:${reason}`);
      },
      heartbeat: async (runId) => {
        calls.push(`beat:${runId}`);
      },
      abandonStale: async (before) => {
        calls.push(`stale:${before.toISOString()}`);
        return 0;
      },
      running: async () => running,
      listRuns: async (limit) => {
        calls.push(`list:${limit}`);
        return [];
      },
      getRun: async (id) => {
        calls.push(`get:${id}`);
        return null;
      },
    },
    fetch: network.fetch,
    sleep: clock.sleep,
    now: clock.now,
    every: (beat) => {
      beat();
      return () => calls.push("stop");
    },
    ...over,
  };
  return { svc: new KnowledgeDiscoveryService(deps), calls, network };
}

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: { getStatus?: () => number }) => error.getStatus?.() ?? 0,
  );

describe("starting a discovery over HTTP", () => {
  it("starts a run with the caller as actor, answers RUNNING, and finishes it in the background", async () => {
    const t = service();
    const answer = await t.svc.start(BODY, USER);
    assert.deepEqual(answer, { id: "run-1", status: "RUNNING" });
    await t.svc.inFlight.get("run-1");
    assert.deepEqual(t.calls, [
      `stale:${new Date(Date.parse("2026-10-23T14:00:00Z") - STALE_AFTER_MS).toISOString()}`,
      "start:u-1:vegpont-teszt",
      "beat:run-1",
      "finish:run-1:FINISHED",
      "stop",
    ]);
    assert.equal(t.svc.inFlight.size, 0);
  });

  it("the switch off: 403, before the store or the network is touched", async () => {
    for (const env of [{}, { KNOWLEDGE_DISCOVERY: "off" }]) {
      const t = service({ env });
      assert.equal(await status(t.svc.start(BODY, USER)), HttpStatus.FORBIDDEN);
      assert.deepEqual(t.calls, []);
      assert.equal(t.network.asked.length, 0);
    }
  });

  it("a bad body or a bad request limit: 400, nothing started", async () => {
    for (const body of [
      {},
      { ...BODY, label: "" },
      { ...BODY, maxRequests: 0 },
      { ...BODY, maxRequests: 1001 },
      { ...BODY, maxRequests: "5" },
    ]) {
      const t = service();
      assert.equal(
        await status(t.svc.start(body, USER)),
        HttpStatus.BAD_REQUEST,
      );
      assert.deepEqual(t.calls, []);
    }
  });

  it("one run at a time: a RUNNING record, or one of this process, is a 409", async () => {
    const t = service({}, { id: "run-0", startedAt: new Date() });
    assert.equal(await status(t.svc.start(BODY, USER)), HttpStatus.CONFLICT);
    assert.ok(!t.calls.some((c) => c.startsWith("start:")));

    const u = service();
    await u.svc.start(BODY, USER);
    assert.equal(await status(u.svc.start(BODY, USER)), HttpStatus.CONFLICT);
    await u.svc.inFlight.get("run-1");
  });

  it("the database's one-RUNNING index refusing the insert is a 409 too (two api instances)", async () => {
    const t = service();
    const store = (t.svc as unknown as { deps: DiscoveryServiceDeps }).deps
      .store;
    store.startRun = async () => {
      throw new RunAlreadyRunning();
    };
    assert.equal(await status(t.svc.start(BODY, USER)), HttpStatus.CONFLICT);
    assert.equal(t.network.asked.length, 0);
    assert.equal(t.svc.inFlight.size, 0);
  });

  it("a run that throws is FAILED by name, and the process goes on", async () => {
    const t = service();
    const store = (t.svc as unknown as { deps: DiscoveryServiceDeps }).deps
      .store;
    store.finishRun = async () => {
      throw new SyntaxError("a text that must not be stored");
    };
    await t.svc.start(BODY, USER);
    await t.svc.inFlight.get("run-1");
    assert.deepEqual(t.calls.slice(-2), ["fail:run-1:SyntaxError", "stop"]);
  });

  it("reads: the list is the latest 20, a missing run is a 404", async () => {
    const t = service();
    await t.svc.list();
    assert.equal(await status(t.svc.get("nincs")), HttpStatus.NOT_FOUND);
    assert.deepEqual(t.calls, ["list:20", "get:nincs"]);
  });
});

describe("the discovery endpoints", () => {
  const proto = KnowledgeDiscoveryController.prototype;

  it("every route needs knowledge.research.run", () => {
    for (const handler of [proto.start, proto.list, proto.get])
      assert.deepEqual(
        Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler),
        [PERMISSIONS.KNOWLEDGE_RESEARCH_RUN],
        handler.name,
      );
  });

  it("the start answers 202: the run goes on after the answer", () => {
    assert.equal(
      Reflect.getMetadata(HTTP_CODE_METADATA, proto.start),
      HttpStatus.ACCEPTED,
    );
  });

  it("knowledge.research.run is OWNER and ADMIN only, not even MANAGER", async () => {
    const { ROLE_PERMISSIONS } = await import("@acropora/types");
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, perms]) =>
        (perms as readonly string[]).includes(
          PERMISSIONS.KNOWLEDGE_RESEARCH_RUN,
        ),
      )
      .map(([role]) => role)
      .sort();
    assert.deepEqual(holders, ["ADMIN", "OWNER"]);
  });
});
