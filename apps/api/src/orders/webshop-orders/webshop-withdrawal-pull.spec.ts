import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaWithdrawal } from "../../integrations/medusa/medusa-admin.client.js";
import {
  describeWithdrawalPull,
  pullWithdrawals,
  withdrawalAssigneeId,
  withdrawalTask,
  type WithdrawalPullDeps,
  type WithdrawalTaskData,
} from "./webshop-withdrawal-pull.js";
import {
  withdrawalPullConfig,
  WebshopWithdrawalPullScheduler,
} from "./webshop-withdrawal-pull.scheduler.js";

/*
  WHAT TURNS THIS RED (V0.3, slice 4). A task created without an assignee configured, or for an unknown one; a
  declaration marked pulled before (or without) its task; the same declaration making two tasks; one declaration's
  failure stopping the others; a missing assignee that is not said in the log every round; a task text that loses
  the declared name, the lines, the time of receipt or the warning that the right was not checked; a task linking to
  anything but the order; a task key that could collide with a problem report's; the complaint assignee not being
  the fallback, or the withdrawal's own not winning; the scheduler on without the exact switch, an interval out of
  its bounds, a run started twice.
*/
const withdrawal = (
  over: Partial<MedusaWithdrawal> = {},
): MedusaWithdrawal => ({
  id: "ordwdr_1",
  order_id: "order_1",
  customer_name: "Kiss Anna",
  item_ids: ["item_1", "item_2"],
  status: "new",
  created_at: "2026-11-05T18:00:00.000Z",
  pulled_at: null,
  ...over,
});
const order = {
  display_id: 1042,
  items: [
    { id: "item_1", title: "Korall A" },
    { id: "item_2", title: "Korall B" },
  ],
} as never;

function fake(
  rows: MedusaWithdrawal[],
  over: Partial<WithdrawalPullDeps> = {},
) {
  const log: string[] = [];
  const tasks: WithdrawalTaskData[] = [];
  const keys = new Set<string>();
  const deps: WithdrawalPullDeps = {
    list: async () => rows,
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
const env = { WEBSHOP_WITHDRAWAL_ASSIGNEE_ID: "user_1" };

describe("withdrawalTask", () => {
  it("carries the declared name, the line titles, the time of receipt and the declaration id, links to the order, and says the right was not checked", () => {
    const task = withdrawalTask(withdrawal(), order, "user_1");
    assert.equal(task.title, "Webshop elállás, rendelés #1042");
    for (const part of [
      "Nyilatkozó neve: Kiss Anna",
      "Érintett tételek: Korall A, Korall B",
      "Beérkezés ideje (a bolt szerverének órája): 2026-11-05T18:00:00.000Z",
      "Nyilatkozat azonosítója: ordwdr_1",
      "A bolt nem vizsgálta, hogy az elállási jog fennáll-e",
    ])
      assert.ok(task.description.includes(part), part);
    assert.equal(task.linkUrl, "/webshop/rendelesek/order_1");
    assert.equal(task.assigneeId, "user_1");
  });

  it("its key has its own prefix, so it can never collide with a problem report's task", () => {
    assert.equal(
      withdrawalTask(withdrawal(), order, "u").sourceRef,
      "withdrawal:ordwdr_1",
    );
    assert.ok(
      !withdrawalTask(withdrawal(), order, "u").sourceRef.startsWith("report:"),
    );
  });

  it("encodes the order id in the link; a missing order falls back to its id and the lines to their ids", () => {
    const task = withdrawalTask(withdrawal({ order_id: "order/1" }), null, "u");
    assert.equal(task.linkUrl, "/webshop/rendelesek/order%2F1");
    assert.ok(task.title.includes("order/1"));
    assert.ok(task.description.includes("Érintett tételek: item_1, item_2"));
  });
});

describe("withdrawalAssigneeId", () => {
  it("the withdrawal's own setting wins, the complaints' is the fallback, neither is empty", () => {
    assert.equal(
      withdrawalAssigneeId({
        WEBSHOP_WITHDRAWAL_ASSIGNEE_ID: " w ",
        WEBSHOP_COMPLAINT_ASSIGNEE_ID: "c",
      }),
      "w",
    );
    assert.equal(
      withdrawalAssigneeId({ WEBSHOP_COMPLAINT_ASSIGNEE_ID: "c" }),
      "c",
    );
    assert.equal(
      withdrawalAssigneeId({ WEBSHOP_WITHDRAWAL_ASSIGNEE_ID: "  " }),
      "",
    );
    assert.equal(withdrawalAssigneeId({}), "");
  });
});

describe("pullWithdrawals", () => {
  it("creates the task first and marks the declaration pulled after it", async () => {
    const { deps, log } = fake([withdrawal()]);
    const result = await pullWithdrawals(deps, env);
    assert.deepEqual(log, ["task:withdrawal:ordwdr_1", "pulled:ordwdr_1"]);
    assert.equal(result.created, 1);
  });

  it("uses the complaints' assignee when the withdrawal has none", async () => {
    const { deps, tasks } = fake([withdrawal()]);
    await pullWithdrawals(deps, { WEBSHOP_COMPLAINT_ASSIGNEE_ID: "user_1" });
    assert.equal(tasks[0]!.assigneeId, "user_1");
  });

  it("WITHOUT an assignee nothing is created and nothing is marked, and the log says so", async () => {
    const { deps, log } = fake([withdrawal(), withdrawal({ id: "ordwdr_2" })]);
    const result = await pullWithdrawals(deps, {});
    assert.deepEqual(log, []);
    assert.equal(result.waiting, 2);
    assert.equal(result.assigneeProblem, "unset");
    assert.match(describeWithdrawalPull(result), /STAY NEW/);
    assert.match(describeWithdrawalPull(result), /is set/);
  });

  it("an assignee that is not an active user is the same: nothing is created, the log names it", async () => {
    const { deps, log } = fake([withdrawal()]);
    const result = await pullWithdrawals(deps, {
      WEBSHOP_WITHDRAWAL_ASSIGNEE_ID: "user_torolt",
    });
    assert.deepEqual(log, []);
    assert.equal(result.assigneeProblem, "unknown");
    assert.match(describeWithdrawalPull(result), /no active user/);
  });

  it("the same declaration pulled twice is one task (the key), and is still marked", async () => {
    const { deps, log, tasks } = fake([withdrawal()]);
    await pullWithdrawals(deps, env);
    const second = await pullWithdrawals(deps, env);
    assert.equal(tasks.length, 1);
    assert.equal(second.alreadyThere, 1);
    assert.deepEqual(log, [
      "task:withdrawal:ordwdr_1",
      "pulled:ordwdr_1",
      "task:withdrawal:ordwdr_1",
      "pulled:ordwdr_1",
    ]);
  });

  it("a failed mark is retried by the next round and never makes a second task", async () => {
    let fail = true;
    const { deps, tasks } = fake([withdrawal()], {
      markPulled: async () => {
        if (fail) throw Object.assign(new Error("x"), { status: 502 });
      },
    });
    const first = await pullWithdrawals(deps, env);
    assert.deepEqual(first.failed, [
      { withdrawalId: "ordwdr_1", error: "HTTP_502" },
    ]);
    fail = false;
    const second = await pullWithdrawals(deps, env);
    assert.equal(second.failed.length, 0);
    assert.equal(tasks.length, 1);
  });

  it("one declaration's failure does not stop the others, and the log carries ids and codes only", async () => {
    const boom = Object.assign(
      new Error("secret detail with a name Kiss Anna"),
      {
        code: "ERR_X",
      },
    );
    let calls = 0;
    const { deps } = fake([withdrawal({ id: "a" }), withdrawal({ id: "b" })], {
      order: async () => {
        calls += 1;
        if (calls === 1) throw boom;
        return order;
      },
    });
    const result = await pullWithdrawals(deps, env);
    assert.deepEqual(result.failed, [{ withdrawalId: "a", error: "ERR_X" }]);
    assert.equal(result.created, 1);
    assert.ok(!describeWithdrawalPull(result).includes("secret detail"));
  });

  it("nothing waiting is nothing to say", async () => {
    const { deps } = fake([]);
    const result = await pullWithdrawals(deps, env);
    assert.equal(describeWithdrawalPull(result), "");
  });

  it("asks for a bounded batch", async () => {
    let asked = 0;
    const { deps } = fake([], {
      list: async (limit) => {
        asked = limit;
        return [];
      },
    });
    await pullWithdrawals(deps, env);
    assert.equal(asked, 50); // a deliberate number: raising it is a decision, not a refactor
  });
});

describe("the schedule", () => {
  it("is off unless the switch is exactly true, and the complaints' switch does not turn it on", () => {
    for (const value of [undefined, "", "false", "True", "1", "on"])
      assert.equal(
        withdrawalPullConfig({ WEBSHOP_WITHDRAWAL_PULL_ENABLED: value })
          .enabled,
        false,
        String(value),
      );
    assert.equal(
      withdrawalPullConfig({ WEBSHOP_COMPLAINT_PULL_ENABLED: "true" }).enabled,
      false,
    );
    const on = withdrawalPullConfig({
      WEBSHOP_WITHDRAWAL_PULL_ENABLED: "true",
    });
    assert.equal(on.intervalMs, 10 * 60_000);
    assert.equal(on.startupDelayMs, 2 * 60_000);
  });

  it("refuses an interval or delay out of its bounds", () => {
    for (const value of ["4", "1441", "abc", "1.5"])
      assert.throws(
        () =>
          withdrawalPullConfig({
            WEBSHOP_WITHDRAWAL_PULL_ENABLED: "true",
            WEBSHOP_WITHDRAWAL_PULL_INTERVAL_MINUTES: value,
          }),
        /INTERVAL_INVALID/,
      );
    assert.throws(
      () =>
        withdrawalPullConfig({
          WEBSHOP_WITHDRAWAL_PULL_ENABLED: "true",
          WEBSHOP_WITHDRAWAL_PULL_STARTUP_DELAY_MINUTES: "241",
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
    const scheduler = new WebshopWithdrawalPullScheduler(service as never);
    const first = scheduler.runOnce();
    assert.equal(await scheduler.runOnce(), "");
    assert.equal(calls, 1);
    release();
    await first;
  });
});
