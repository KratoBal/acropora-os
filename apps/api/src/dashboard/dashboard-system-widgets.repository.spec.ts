import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DashboardSystemWidgetsRepository } from "./dashboard-system-widgets.repository.js";

interface Call {
  model: string;
  method: string;
  args: unknown;
}

function repositoryWith(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const database = new Proxy(
    {},
    {
      get: (_, model: string) =>
        new Proxy(
          {},
          {
            get: (__, method: string) => async (args: unknown) => {
              calls.push({ model, method, args });
              const answer = answers[`${model}.${method}`];
              return typeof answer === "function" ? answer(args) : answer;
            },
          },
        ),
    },
  );
  const repository = new DashboardSystemWidgetsRepository();
  (repository as unknown as { database: unknown }).database = database;
  return { repository, calls };
}

// 2026-10-02 10:00 Budapest (CEST)
const now = new Date("2026-10-02T08:00:00.000Z");

describe("the JEV and system reads", () => {
  it("JEV counts the last seven Budapest days, and today from Budapest midnight", async () => {
    const { repository, calls } = repositoryWith({
      "decisionRun.groupBy": (args: { by: string[] }) =>
        args.by.length === 1
          ? [{ status: "ERROR", _count: { _all: 2 } }]
          : [
              {
                policyKey: "acropora-missing-invoice-pair-v1",
                exposure: "HIDDEN",
                resolution: "SHADOW_MATCH",
                status: "OK",
                _count: { _all: 4 },
              },
            ],
    });
    const data = await repository.jevIntelligence(now);
    assert.deepEqual(data.today, { runs: 2, errors: 2 });
    assert.equal(data.week.shadow.match, 4);
    const wheres = calls.map(
      (c) =>
        (c.args as { where: { createdAt: { gte: Date } } }).where.createdAt.gte,
    );
    assert.deepEqual(wheres.map((d) => d.toISOString()).sort(), [
      "2026-09-25T22:00:00.000Z",
      "2026-10-01T22:00:00.000Z",
    ]);
  });

  it("system status: one row per source, UNAS and Medusa never; nothing found is no data", async () => {
    const { repository, calls } = repositoryWith({
      "decisionRun.groupBy": [],
      "navConnectionSetting.findUnique": { verificationStatus: "SUCCESS" },
      "foxpostSyncRun.findFirst": {
        status: "FAILED",
        startedAt: new Date("2026-10-01T05:00:00.000Z"),
        completedAt: null,
        errorCode: "MAILBOX_UNREACHABLE",
        failedCount: 0,
      },
    });
    const data = await repository.systemStatus(now, {});
    assert.deepEqual(
      data.sources.map((s) => [s.source, s.state]),
      [
        ["NAV", "no-data"],
        ["MAIL", "no-data"],
        ["FOXPOST", "error"],
        ["GLS", "no-data"],
        ["SIMPLEPAY", "no-data"],
        ["EBIZ", "no-data"],
        ["JEV", "no-data"],
      ],
    );
    // no OTP_EBIZ_API_KEY: "not configured", not "has not run yet"
    assert.equal(
      data.sources.find((s) => s.source === "EBIZ")?.detail,
      "Nincs beállítva.",
    );
    const foxpost = data.sources.find((s) => s.source === "FOXPOST");
    assert.equal(foxpost?.errorCode, "MAILBOX_UNREACHABLE");
    assert.equal(foxpost?.lastRunAt, "2026-10-01T05:00:00.000Z");
    assert.ok(
      !calls.some((c) => /unas|medusa/i.test(c.model)),
      "frozen sources are never read",
    );
    assert.ok(
      calls.every((c) =>
        ["findFirst", "findUnique", "groupBy"].includes(c.method),
      ),
      "read only",
    );
  });
});
