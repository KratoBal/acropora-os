import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PartnerScope } from "../auth/partner-scope.util.js";
import {
  DashboardAquariumWidgetsRepository,
  EQUIPMENT_WINDOW_DAYS,
} from "./dashboard-aquarium-widgets.repository.js";
import type { ServiceWidgetViewer } from "./dashboard-service-widgets.repository.js";

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
      get: (_, name: string) => {
        if (name === "$queryRaw")
          return async (
            strings: TemplateStringsArray,
            ...values: unknown[]
          ) => {
            calls.push({
              model: "$queryRaw",
              method: "raw",
              args: { sql: strings.join("?"), values },
            });
            return answers["$queryRaw"] ?? [];
          };
        return new Proxy(
          {},
          {
            get: (__, method: string) => async (args: unknown) => {
              calls.push({ model: name, method, args });
              const answer = answers[`${name}.${method}`];
              return typeof answer === "function" ? answer(args) : answer;
            },
          },
        );
      },
    },
  );
  const repository = new DashboardAquariumWidgetsRepository();
  (repository as unknown as { database: unknown }).database = database;
  return { repository, calls };
}

const internal: ServiceWidgetViewer = {
  userId: "u1",
  role: "OWNER",
  scope: { kind: "internal" } as PartnerScope,
  assignedUnitIds: [],
};
const customer: ServiceWidgetViewer = {
  userId: "p1",
  role: "PARTNER_SERVICE",
  scope: { kind: "customer", customerId: "customer-1" } as PartnerScope,
  assignedUnitIds: ["unit-1"],
};
const json = (value: unknown) => JSON.stringify(value);

describe("the aquarium readings", () => {
  it("reads only the visible, active aquariums, then their latest occasion in ONE query", async () => {
    const at = new Date("2026-09-30T08:00:00Z");
    const { repository, calls } = repositoryWith({
      "aquarium.findMany": [
        {
          id: "aq-1",
          name: "Kitalált Reef",
          waterType: "TENGERI",
          targets: [{ parameterCode: "KH", min: "7", max: null }],
        },
        { id: "aq-2", name: "Minta Nano", waterType: null, targets: [] },
      ],
      $queryRaw: [
        {
          aquariumId: "aq-1",
          parameterCode: "KH",
          value: "6.8",
          measuredAt: at,
        },
        {
          aquariumId: "aq-1",
          parameterCode: "NITRAT",
          value: "31",
          measuredAt: at,
        },
      ],
    });
    const readings = await repository.readings(customer);

    const where = json((calls[0]?.args as { where: unknown }).where);
    assert.match(where, /customer-1/, "the partner scope must be applied");
    assert.match(where, /unit-1/);
    assert.match(where, /"isActive":true/);
    const raws = calls.filter((c) => c.model === "$queryRaw");
    assert.equal(
      raws.length,
      1,
      "one raw query for all aquariums, not one per aquarium",
    );
    const raw = raws[0]?.args as { sql: string; values: unknown[] };
    assert.match(
      raw.sql,
      /MAX\("measuredAt"\)/,
      "only the latest occasion is read",
    );
    assert.deepEqual(raw.values, [["aq-1", "aq-2"]]);

    assert.deepEqual(readings[0], {
      id: "aq-1",
      name: "Kitalált Reef",
      waterType: "TENGERI",
      targets: [{ parameterCode: "KH", min: 7, max: null }],
      latest: {
        measuredAt: at,
        values: [
          { parameterCode: "KH", value: 6.8 },
          { parameterCode: "NITRAT", value: 31 },
        ],
      },
    });
    assert.equal(readings[1]?.latest, null);
  });

  it("no visible aquarium: no measurement query at all", async () => {
    const { repository, calls } = repositoryWith({ "aquarium.findMany": [] });
    assert.deepEqual(await repository.readings(internal), []);
    assert.equal(calls.length, 1);
  });
});

describe("Eszköz-karbantartás", () => {
  const now = new Date("2026-10-01T10:00:00Z");

  it("counts aquarium equipment only, overdue and within the window, by Budapest day, in scope", async () => {
    const { repository, calls } = repositoryWith({
      "asset.count": (args: {
        where: { AND: [unknown, { nextServiceAt: unknown }] };
      }) => (json(args.where.AND[1].nextServiceAt).includes("gte") ? 4 : 1),
      "asset.findMany": [
        {
          id: "a1",
          name: "Kitalált nyomószivattyú",
          nextServiceAt: new Date("2026-10-07T08:00:00Z"),
          aquarium: { name: "Kitalált Reef" },
        },
      ],
    });
    const data = await repository.equipment(customer, now);

    assert.deepEqual(
      { overdue: data.overdue, dueSoon: data.dueSoon, window: data.windowDays },
      { overdue: 1, dueSoon: 4, window: EQUIPMENT_WINDOW_DAYS },
    );
    assert.equal(data.soonest[0]?.nextServiceAt, "2026-10-07");
    for (const call of calls) {
      const where = json((call.args as { where: unknown }).where);
      assert.match(
        where,
        /"aquariumId":\{"not":null\}/,
        "only equipment attached to an aquarium",
      );
      assert.match(where, /customer-1/, "the partner's asset scope");
      assert.match(where, /"archivedAt":null/);
    }
    // the window ends where the 16th Budapest day starts (today + 14 days inclusive)
    assert.match(json(calls[1]?.args), /"lt":"2026-10-15T22:00:00.000Z"/);
  });
});
