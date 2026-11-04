import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaProblemReport } from "../../integrations/medusa/medusa-admin.client.js";
import {
  complaintTask,
  describePullReport,
  pullProblemReports,
  type ComplaintTaskData,
  type ProblemPullDeps,
} from "./webshop-problem-report-pull.js";
import {
  problemReportPullConfig,
  WebshopProblemReportPullScheduler,
} from "./webshop-problem-report-pull.scheduler.js";

/*
  WHAT TURNS THIS RED (V1.2, slice 2). A task created without an assignee configured, or for an unknown one;
  a report marked pulled before (or without) its task; the same report making two tasks; one report's failure
  stopping the others; a missing assignee that is not said in the log every round; a task text that loses
  the photos, the phone or the kind; a task linking to anything but the order; the scheduler on without the
  exact switch, an interval out of its bounds, a run started twice.
*/
const report = (
  over: Partial<MedusaProblemReport> = {},
): MedusaProblemReport => ({
  id: "ordprb_1",
  order_id: "order_1",
  kind: "animal_dead",
  item_ids: ["item_1"],
  received_at: "2026-11-03T10:00:00.000Z",
  description: "Elpusztult a korall",
  phone: "+36 30 123 4567",
  status: "new",
  created_at: "2026-11-04T10:00:00.000Z",
  pulled_at: null,
  photos: [
    {
      id: "p1",
      url: "https://shop.example/static/a.jpg",
      mime_type: "image/jpeg",
      size_bytes: 10,
    },
    {
      id: "p2",
      url: "https://shop.example/static/b.png",
      mime_type: "image/png",
      size_bytes: 20,
    },
  ],
  ...over,
});
const order = {
  display_id: 1042,
  items: [{ id: "item_1", title: "Korall A" }],
} as never;

function fake(
  reports: MedusaProblemReport[],
  over: Partial<ProblemPullDeps> = {},
) {
  const log: string[] = [];
  const tasks: ComplaintTaskData[] = [];
  const keys = new Set<string>();
  const deps: ProblemPullDeps = {
    list: async () => reports,
    order: async () => order,
    assigneeActive: async (id) => id === "user_1",
    createTask: async (data) => {
      log.push(`task:${data.sourceRef}`);
      if (keys.has(data.sourceRef)) return "exists";
      keys.add(data.sourceRef);
      tasks.push(data);
      return "created";
    },
    markPulled: async (id) => {
      log.push(`pulled:${id}`);
    },
    ...over,
  };
  return { deps, log, tasks };
}
const env = { WEBSHOP_COMPLAINT_ASSIGNEE_ID: "user_1" };

describe("complaintTask", () => {
  it("carries the kind, the line titles, the time, the text, the phone and every photo address, and links to the order", () => {
    const task = complaintTask(report(), order, "user_1");
    assert.equal(
      task.title,
      "Webshop bejelentés, rendelés #1042: Az állat elpusztult",
    );
    for (const part of [
      "Ok: Az állat elpusztult",
      "Érintett tételek: Korall A",
      "Átvétel ideje: 2026-11-03T10:00:00.000Z",
      "Leírás: Elpusztult a korall",
      "Telefonszám: +36 30 123 4567",
      "https://shop.example/static/a.jpg",
      "https://shop.example/static/b.png",
      "Fotók (2)",
      "Bejelentés azonosítója: ordprb_1",
    ])
      assert.ok(task.description.includes(part), part);
    assert.equal(task.linkUrl, "/webshop/rendelesek/order_1");
    assert.equal(task.sourceRef, "report:ordprb_1");
    assert.equal(task.assigneeId, "user_1");
  });

  it("encodes the order id in the link; a missing order falls back to its id; no photo and no phone say so or stay out", () => {
    const task = complaintTask(
      report({
        order_id: "order/1",
        phone: null,
        photos: [],
        received_at: null,
      }),
      null,
      "u",
    );
    assert.equal(task.linkUrl, "/webshop/rendelesek/order%2F1");
    assert.ok(task.title.includes("order/1"));
    assert.ok(task.description.includes("Fotó nincs."));
    assert.ok(!task.description.includes("Telefonszám"));
    assert.ok(!task.description.includes("Átvétel ideje"));
    assert.ok(task.description.includes("Érintett tételek: item_1"));
  });

  it("an unknown kind is shown as it came, not dropped", () => {
    assert.ok(
      complaintTask(report({ kind: "uj_ok" }), order, "u").title.endsWith(
        ": uj_ok",
      ),
    );
  });
});

describe("pullProblemReports", () => {
  it("creates the task first and marks the report pulled after it", async () => {
    const { deps, log } = fake([report()]);
    const result = await pullProblemReports(deps, env);
    assert.deepEqual(log, ["task:report:ordprb_1", "pulled:ordprb_1"]);
    assert.equal(result.created, 1);
  });

  it("WITHOUT an assignee nothing is created and nothing is marked, and the log says so", async () => {
    const { deps, log } = fake([report(), report({ id: "ordprb_2" })]);
    const result = await pullProblemReports(deps, {});
    assert.deepEqual(log, []);
    assert.equal(result.waiting, 2);
    assert.equal(result.assigneeProblem, "unset");
    assert.match(describePullReport(result), /STAY NEW/);
    assert.match(describePullReport(result), /not set/);
  });

  it("an assignee that is not an active user is the same: nothing is created, the log names it", async () => {
    const { deps, log } = fake([report()]);
    const result = await pullProblemReports(deps, {
      WEBSHOP_COMPLAINT_ASSIGNEE_ID: "user_torolt",
    });
    assert.deepEqual(log, []);
    assert.equal(result.assigneeProblem, "unknown");
    assert.match(describePullReport(result), /no active user/);
  });

  it("the same report pulled twice is one task (the key), and is still marked", async () => {
    const { deps, log, tasks } = fake([report()]);
    await pullProblemReports(deps, env);
    const second = await pullProblemReports(deps, env);
    assert.equal(tasks.length, 1);
    assert.equal(second.alreadyThere, 1);
    assert.deepEqual(log, [
      "task:report:ordprb_1",
      "pulled:ordprb_1",
      "task:report:ordprb_1",
      "pulled:ordprb_1",
    ]);
  });

  it("a failed mark is retried by the next round and never makes a second task", async () => {
    let fail = true;
    const { deps, tasks } = fake([report()], {
      markPulled: async () => {
        if (fail) throw Object.assign(new Error("x"), { status: 502 });
      },
    });
    const first = await pullProblemReports(deps, env);
    assert.deepEqual(first.failed, [
      { reportId: "ordprb_1", error: "HTTP_502" },
    ]);
    fail = false;
    const second = await pullProblemReports(deps, env);
    assert.equal(second.failed.length, 0);
    assert.equal(tasks.length, 1);
  });

  it("one report's failure does not stop the others, and the log carries ids and codes only", async () => {
    const boom = Object.assign(new Error("secret detail with a phone +36"), {
      code: "ERR_X",
    });
    let calls = 0;
    const { deps } = fake([report({ id: "a" }), report({ id: "b" })], {
      order: async () => {
        calls += 1;
        if (calls === 1) throw boom;
        return order;
      },
    });
    const result = await pullProblemReports(deps, env);
    assert.deepEqual(result.failed, [{ reportId: "a", error: "ERR_X" }]);
    assert.equal(result.created, 1);
    assert.ok(!describePullReport(result).includes("secret detail"));
  });

  it("nothing waiting is nothing to say", async () => {
    const { deps } = fake([]);
    const result = await pullProblemReports(deps, env);
    assert.equal(describePullReport(result), "");
  });

  it("asks for a bounded batch", async () => {
    let asked = 0;
    const { deps } = fake([], {
      list: async (limit) => {
        asked = limit;
        return [];
      },
    });
    await pullProblemReports(deps, env);
    assert.equal(asked, 50); // a deliberate number: raising it is a decision, not a refactor
  });
});

describe("the schedule", () => {
  it("is off unless the switch is exactly true", () => {
    for (const value of [undefined, "", "false", "True", "1", "on"])
      assert.equal(
        problemReportPullConfig({ WEBSHOP_COMPLAINT_PULL_ENABLED: value })
          .enabled,
        false,
        String(value),
      );
    const on = problemReportPullConfig({
      WEBSHOP_COMPLAINT_PULL_ENABLED: "true",
    });
    assert.equal(on.intervalMs, 10 * 60_000);
    assert.equal(on.startupDelayMs, 2 * 60_000);
  });

  it("refuses an interval or delay out of its bounds", () => {
    for (const value of ["4", "1441", "abc", "1.5"])
      assert.throws(
        () =>
          problemReportPullConfig({
            WEBSHOP_COMPLAINT_PULL_ENABLED: "true",
            WEBSHOP_COMPLAINT_PULL_INTERVAL_MINUTES: value,
          }),
        /INTERVAL_INVALID/,
      );
    assert.throws(
      () =>
        problemReportPullConfig({
          WEBSHOP_COMPLAINT_PULL_ENABLED: "true",
          WEBSHOP_COMPLAINT_PULL_STARTUP_DELAY_MINUTES: "241",
        }),
      /DELAY_INVALID/,
    );
  });

  it("a run that is still going is not started twice", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const empty = {
      seen: 0,
      created: 0,
      alreadyThere: 0,
      waiting: 0,
      assigneeProblem: null,
      failed: [],
    };
    const service = {
      run: () => {
        calls += 1;
        return calls === 1
          ? new Promise((resolve) => {
              release = () => resolve(empty);
            })
          : Promise.resolve(empty);
      },
    };
    const scheduler = new WebshopProblemReportPullScheduler(service as never);
    const first = scheduler.runOnce();
    assert.equal(await scheduler.runOnce(), "");
    assert.equal(calls, 1);
    release();
    await first;
  });
});
