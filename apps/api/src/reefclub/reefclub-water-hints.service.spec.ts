import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";

import type { ReefClubAquariumAccess } from "./reefclub-aquarium-access.js";
import type { ReefClubDatabase } from "./reefclub-database.js";
import { ReefClubWaterHintsController } from "./reefclub-water-hints.controller.js";
import {
  ReefClubWaterHintsService,
  WATER_HINTS_SWITCH,
  waterHintsEnabled,
} from "./reefclub-water-hints.service.js";
import type { ReefClubRateLimits } from "./reefclub-rate-limits.js";
import type { ReefClubRequest } from "./reefclub.guard.js";

/**
 * A "MI LÓG KI" OLVASÁSA ÉS AZ ÚTVONAL (card ce6c5cc9, V3.4 S3). MI PIROSÍT: a kapcsoló kikapcsolva is olvas valamit; a hozzáférés-ellenőrzés
 * (READ, az egy 404) előtt adat megy ki; a nem tengeri víznél mérést vagy terméket olvas; a vetítés kora nem a legutóbbi SIKERES futásból jön;
 * egy megosztott akváriumnál nem csak a kiadott mérések látszanak; olvasás helyett írás történik; a korlát nem fut.
 */
const NOW = new Date("2026-11-11T12:00:00.000Z");
const HOUR = 3_600_000;

interface Calls {
  access: unknown[][];
  queries: string[];
  wheres: Array<{ AND: Array<Record<string, unknown>> }>;
  takes: unknown[];
  releaseWhere: unknown;
}

function fixture(
  options: {
    waterType?: "TENGERI" | "EDESVIZI" | null;
    builtAgoHours?: number | null;
    origin?: "OWN" | "SHOP";
  } = {},
) {
  const calls: Calls = {
    access: [],
    queries: [],
    wheres: [],
    takes: [],
    releaseWhere: null,
  };
  const waterType =
    options.waterType === undefined ? "TENGERI" : options.waterType;
  const tx = {
    aquarium: {
      findUniqueOrThrow: async () => {
        calls.queries.push("aquarium");
        return { waterType };
      },
    },
    aquariumMeasurementRelease: {
      findMany: async (args: unknown) => {
        calls.queries.push("release");
        calls.releaseWhere = args;
        return [{ measuredAt: new Date("2026-11-10T08:00:00.000Z") }];
      },
    },
    aquariumMeasurement: {
      findMany: async (args: {
        where: { AND: Array<Record<string, unknown>> };
        take?: number;
      }) => {
        calls.queries.push("measurements");
        calls.wheres.push(args.where);
        calls.takes.push(args.take);
        // only KH has a row here: one query per parameter, each for its own latest value
        return args.where.AND[1]?.parameterCode === "KH"
          ? [
              {
                parameterCode: "KH",
                value: { toNumber: () => 6.5 },
                measuredAt: new Date(NOW.getTime() - HOUR),
              },
            ]
          : [];
      },
    },
    reefClubCustomerCandidate: {
      findMany: async () => {
        calls.queries.push("candidates");
        return [
          {
            parameterCode: "KH",
            direction: "EMEL",
            productId: "p1",
            productName: "KH+",
            category: "Adalékok",
            shopUrl: "https://shop.example/p1",
            evidenceRef: "https://gyarto.example/p1",
            referenceKind: "MAKER",
            effects: ["KH:EMEL"],
            sideEffects: ["PH:EMEL"],
            rank: 1,
          },
        ];
      },
    },
    reefClubDoseProjectionRun: {
      findFirst: async () => {
        calls.queries.push("run");
        return options.builtAgoHours === null
          ? null
          : {
              finishedAt: new Date(
                NOW.getTime() - (options.builtAgoHours ?? 1) * HOUR,
              ),
            };
      },
    },
  };
  const database = {
    $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
  } as unknown as ReefClubDatabase;
  const access = {
    aquariumForAccount: async (...args: unknown[]) => {
      calls.access.push(args);
      return { aquariumId: "aq1", origin: options.origin ?? "OWN" };
    },
  } as unknown as ReefClubAquariumAccess;
  return {
    service: new ReefClubWaterHintsService(access, database),
    access,
    database,
    calls,
  };
}

describe("ReefClubWaterHintsService", () => {
  it("asks the access function first (READ, the account and the aquarium), and the 404 stops everything", async () => {
    const fx = fixture();
    await fx.service.hints("acc1", "aq1", NOW);
    assert.deepEqual(fx.calls.access, [["acc1", "aq1", "READ"]]);
    const denied = new ReefClubWaterHintsService(
      {
        aquariumForAccount: async () => {
          throw new NotFoundException("Nem található.");
        },
      } as unknown as ReefClubAquariumAccess,
      {
        $transaction: async () => assert.fail("nothing may be read"),
      } as unknown as ReefClubDatabase,
    );
    await assert.rejects(denied.hints("acc1", "other", NOW), NotFoundException);
  });

  it("the sea: the four parameters (never phosphate), the products and the age of the projection are read; the answer is the rules'", async () => {
    const fx = fixture();
    const hints = await fx.service.hints("acc1", "aq1", NOW);
    assert.deepEqual([...new Set(fx.calls.queries)].sort(), [
      "aquarium",
      "candidates",
      "measurements",
      "run",
    ]);
    // ONE query per parameter, each for its own LATEST value (take 1), never phosphate: a densely logged parameter cannot push a fresh
    // one of another out of a shared limit (barracuda on #2417)
    assert.deepEqual(
      fx.calls.wheres.map((where) => where.AND[1]),
      [
        { parameterCode: "KH" },
        { parameterCode: "KALCIUM" },
        { parameterCode: "MAGNEZIUM" },
        { parameterCode: "NITRAT" },
      ],
    );
    assert.deepEqual(fx.calls.takes, [1, 1, 1, 1]);
    assert.equal(hints.state, "OK");
    assert.equal(hints.rows[0]!.status, "ALATTA");
    assert.equal(hints.rows[0]!.value, 6.5);
    assert.equal(hints.rows[0]!.products[0]!.productId, "p1");
    assert.equal(
      hints.rows[0]!.products[0]!.sideEffectsText,
      "Emellett hat: pH (emeli).",
    );
    assert.equal(hints.productsState, "OK");
  });

  it("not the sea (fresh water or none): only the water type is read, nothing else, and nothing is advised", async () => {
    for (const waterType of ["EDESVIZI", null] as const) {
      const fx = fixture({ waterType });
      const hints = await fx.service.hints("acc1", "aq1", NOW);
      assert.deepEqual(fx.calls.queries, ["aquarium"], String(waterType));
      assert.equal(hints.state, "NOT_AVAILABLE");
      assert.deepEqual(hints.rows, []);
    }
  });

  it("the age of the projection is the last SUCCESSFUL build: 26 hours is still fresh, older or no build at all names no product", async () => {
    const productsOf = async (builtAgoHours: number | null) =>
      (await fixture({ builtAgoHours }).service.hints("acc1", "aq1", NOW))
        .rows[0]!.products.length;
    assert.equal(await productsOf(1), 1);
    assert.equal(await productsOf(26), 1);
    assert.equal(await productsOf(26.5), 0);
    assert.equal(await productsOf(null), 0);
    const stale = await fixture({ builtAgoHours: 30 }).service.hints(
      "acc1",
      "aq1",
      NOW,
    );
    assert.equal(stale.productsState, "STALE");
  });

  it("a shop aquarium shows only the RELEASED measurements (the access module's filter), an own one all of its own", async () => {
    const shop = fixture({ origin: "SHOP" });
    await shop.service.hints("acc1", "aq1", NOW);
    assert.deepEqual(
      shop.calls.wheres.map((where) => where.AND[0]),
      Array(4).fill({
        aquariumId: "aq1",
        measuredAt: { in: [new Date("2026-11-10T08:00:00.000Z")] },
      }),
    );
    assert.ok(shop.calls.queries.includes("release"));
    const own = fixture({ origin: "OWN" });
    await own.service.hints("acc1", "aq1", NOW);
    assert.ok(!own.calls.queries.includes("release"));
  });

  it("only reads: the transaction client has no write method to call", async () => {
    const fx = fixture();
    await fx.service.hints("acc1", "aq1", NOW);
    assert.ok(
      fx.calls.queries.every((name) =>
        ["aquarium", "release", "measurements", "candidates", "run"].includes(
          name,
        ),
      ),
    );
  });
});

describe("the switch and the route", () => {
  const saved = process.env[WATER_HINTS_SWITCH];
  afterEach(() => {
    if (saved === undefined) delete process.env[WATER_HINTS_SWITCH];
    else process.env[WATER_HINTS_SWITCH] = saved;
  });

  it("is on only for exactly `true`", () => {
    assert.equal(waterHintsEnabled({ [WATER_HINTS_SWITCH]: "true" }), true);
    for (const value of [
      undefined,
      "",
      "false",
      "TRUE",
      "1",
      " true",
      "yes",
      "on",
    ])
      assert.equal(
        waterHintsEnabled({ [WATER_HINTS_SWITCH]: value }),
        false,
        JSON.stringify(value),
      );
  });

  const route = () => {
    const log: string[] = [];
    const grant = { aquariumId: "aq1", origin: "OWN" as const };
    const controller = new ReefClubWaterHintsController(
      {
        aquariumForAccount: async (...args: unknown[]) => {
          log.push(`access:${args.join("|")}`);
          return grant;
        },
      } as unknown as ReefClubAquariumAccess,
      {
        forGrant: async () => {
          log.push("service");
          return { state: "OK" };
        },
      } as unknown as ReefClubWaterHintsService,
      {
        waterHintsByAccount: {
          check: (key: string) => log.push(`limit-account:${key}`),
        },
        waterHintsByAquarium: {
          check: (key: string) => log.push(`limit-aquarium:${key}`),
        },
      } as unknown as ReefClubRateLimits,
    );
    const request = { reefClubAccountId: "acc1" } as unknown as ReefClubRequest;
    return { controller, log, request };
  };

  it("switched off it answers OFF after the access check and before a limit or a query (the access function runs first, switch or not)", async () => {
    delete process.env[WATER_HINTS_SWITCH];
    const { controller, log, request } = route();
    const answer = await controller.waterHints(request, "aq1");
    assert.equal(answer.state, "OFF");
    assert.deepEqual(answer.rows, []);
    assert.equal(answer.disclaimer, null);
    assert.deepEqual(log, ["access:acc1|aq1|READ"]);
  });

  it("switched OFF, a foreign or missing aquarium is still the one 404 (the id-route sweep of plan 5.2/1)", async () => {
    delete process.env[WATER_HINTS_SWITCH];
    const controller = new ReefClubWaterHintsController(
      {
        aquariumForAccount: async () => {
          throw new NotFoundException("Nem található.");
        },
      } as unknown as ReefClubAquariumAccess,
      {
        forGrant: async () => assert.fail("nothing may be read"),
      } as unknown as ReefClubWaterHintsService,
      {} as unknown as ReefClubRateLimits,
    );
    await assert.rejects(
      controller.waterHints(
        { reefClubAccountId: "acc1" } as unknown as ReefClubRequest,
        "aq-foreign",
      ),
      NotFoundException,
    );
  });

  it("switched on: the access function first (READ), then the two limits, then the service with the approved grant", async () => {
    process.env[WATER_HINTS_SWITCH] = "true";
    const { controller, log, request } = route();
    const answer = await controller.waterHints(request, "aq1");
    assert.deepEqual(answer, { state: "OK" });
    assert.deepEqual(log, [
      "access:acc1|aq1|READ",
      "limit-account:acc1",
      "limit-aquarium:aq1",
      "service",
    ]);
  });

  it("the one 404 of the access function is the answer, and no limit is used up and nothing is read", async () => {
    process.env[WATER_HINTS_SWITCH] = "true";
    const log: string[] = [];
    const controller = new ReefClubWaterHintsController(
      {
        aquariumForAccount: async () => {
          throw new NotFoundException("Nem található.");
        },
      } as unknown as ReefClubAquariumAccess,
      {
        forGrant: async () => log.push("service"),
      } as unknown as ReefClubWaterHintsService,
      {
        waterHintsByAccount: { check: () => log.push("limit") },
        waterHintsByAquarium: { check: () => log.push("limit") },
      } as unknown as ReefClubRateLimits,
    );
    await assert.rejects(
      controller.waterHints(
        { reefClubAccountId: "acc1" } as unknown as ReefClubRequest,
        "aq-foreign",
      ),
      NotFoundException,
    );
    assert.deepEqual(log, []);
  });

  it("a limit that is full stops the request before the service, per account and per aquarium", async () => {
    process.env[WATER_HINTS_SWITCH] = "true";
    for (const full of ["account", "aquarium"]) {
      const log: string[] = [];
      const controller = new ReefClubWaterHintsController(
        {
          aquariumForAccount: async () => ({
            aquariumId: "aq1",
            origin: "OWN",
          }),
        } as unknown as ReefClubAquariumAccess,
        {
          forGrant: async () => log.push("service"),
        } as unknown as ReefClubWaterHintsService,
        {
          waterHintsByAccount: {
            check: () => {
              if (full === "account") throw new Error("limit");
            },
          },
          waterHintsByAquarium: {
            check: () => {
              if (full === "aquarium") throw new Error("limit");
            },
          },
        } as unknown as ReefClubRateLimits,
      );
      await assert.rejects(
        controller.waterHints(
          { reefClubAccountId: "acc1" } as unknown as ReefClubRequest,
          "aq1",
        ),
        /limit/,
        full,
      );
      assert.deepEqual(log, [], full);
    }
  });
});
