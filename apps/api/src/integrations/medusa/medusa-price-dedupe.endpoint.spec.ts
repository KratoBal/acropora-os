import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { HttpException, NotFoundException } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  MedusaPriceDedupeController,
  dedupeBody,
} from "./medusa-price-dedupe.controller.js";
import {
  MedusaPriceDedupeService,
  priceRepairEnabled,
  type PriceDedupeView,
} from "./medusa-price-dedupe.service.js";
import type { DedupeDeps } from "./medusa-price-dedupe.js";

/*
  THE REPAIR ENDPOINT (acrobot 53863). WHAT TURNS RED: the switch opens on anything but the exact text true; a closed switch still
  answers (it must be a 404 before any work, even with the right permission); the permission is not SETTINGS_MANAGE; the body gate lets
  a mistyped key or a non-boolean apply through (a plan would silently become a write or the other way round); the repair is
  reachable by GET; two runs overlap or a failed run leaves the guard stuck; the template files do not list the switch.
*/
const USER = { id: "user-1" } as AuthenticatedUser;

function controllerWith(
  enabled: boolean,
  run: MedusaPriceDedupeService["run"],
) {
  const service = {
    enabled: () => enabled,
    run,
  } as unknown as MedusaPriceDedupeService;
  return new MedusaPriceDedupeController(service);
}

const view: PriceDedupeView = { apply: false, counts: {}, entries: [] };

describe("a javító végpont kapcsolója", () => {
  it("csak a pontos true szöveg nyitja", () => {
    assert.equal(
      priceRepairEnabled({ MEDUSA_PRICE_REPAIR_ENABLED: "true" }),
      true,
    );
    for (const value of [
      undefined,
      "",
      "TRUE",
      "True",
      "1",
      "yes",
      " true",
      "true ",
      "false",
    ])
      assert.equal(
        priceRepairEnabled({ MEDUSA_PRICE_REPAIR_ENABLED: value }),
        false,
        String(value),
      );
    assert.equal(priceRepairEnabled({}), false);
  });

  it("zárva 404, és a szolgáltatást nem is hívja, érvényes törzsnél sem", async () => {
    let called = 0;
    const closed = controllerWith(false, async () => {
      called += 1;
      return view;
    });
    await assert.rejects(
      () => closed.repair({ osProductIds: ["os_1"], apply: true }, USER),
      (error: unknown) => error instanceof NotFoundException,
    );
    assert.equal(called, 0);
    const open = controllerWith(true, async () => {
      called += 1;
      return view;
    });
    await open.repair({ osProductIds: ["os_1"] }, USER);
    assert.equal(called, 1);
  });

  it("mindkét sablon felsorolja, alapból kikapcsolva", () => {
    for (const file of [".env.example", ".env.production.example"]) {
      const text = readFileSync(`../../${file}`, "utf8");
      assert.match(text, /^MEDUSA_PRICE_REPAIR_ENABLED=false$/m, file);
    }
  });
});

describe("a javító végpont jogai és törzse", () => {
  it("SETTINGS_MANAGE kell, és csak POST van rajta", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        MedusaPriceDedupeController.prototype.repair,
      ),
      [PERMISSIONS.SETTINGS_MANAGE],
    );
    const source = readFileSync(
      "src/integrations/medusa/medusa-price-dedupe.controller.ts",
      "utf8",
    );
    assert.match(source, /@Post\(\)/); // control: the file is the one we read
    assert.doesNotMatch(source, /@(Get|Put|Patch|Delete)\(/);
  });

  it("a rossz törzs 400, az érvényes egyedivé és vágottá válik, az apply alapból hamis", () => {
    const rosszak: unknown[] = [
      null,
      [],
      {},
      { osProductIds: [] },
      { osProductIds: ["a"], aply: true },
      { osProductIds: ["a"], apply: "true" },
      { osProductIds: [""] },
      { osProductIds: [1] },
      { osProductIds: Array.from({ length: 101 }, (_, i) => `p${i}`) },
      { osProductIds: ["x".repeat(201)] },
    ];
    for (const rossz of rosszak)
      assert.throws(
        () => dedupeBody(rossz),
        (error: unknown) =>
          error instanceof HttpException && error.getStatus() === 400,
        JSON.stringify(rossz).slice(0, 60),
      );
    assert.deepEqual(dedupeBody({ osProductIds: [" a ", "a", "b"] }), {
      ids: ["a", "b"],
      apply: false,
    });
    assert.equal(dedupeBody({ osProductIds: ["a"], apply: true }).apply, true);
  });

  it("a bolt elérhetetlensége 503, más hiba nem lesz 503", async () => {
    const unreachable = controllerWith(true, async () => {
      throw new MedusaConnectionError("MEDUSA_UNREACHABLE" as never);
    });
    await assert.rejects(
      () => unreachable.repair({ osProductIds: ["a"] }, USER),
      (error: unknown) =>
        error instanceof HttpException && error.getStatus() === 503,
    );
    const other = controllerWith(true, async () => {
      throw new Error("boom");
    });
    await assert.rejects(
      () => other.repair({ osProductIds: ["a"] }, USER),
      /boom/,
    );
  });
});

describe("a javító szolgáltatás", () => {
  const emptyDeps = (): DedupeDeps => ({
    resolve: async () => ({ targets: [], errors: [] }),
    findMedusaProductId: async () => null,
    reader: { listVariantPrices: async () => ({ rows: [], truncated: false }) },
    matchVariant: () => ({ error: "x" }),
    writer: { setVariantPrices: async () => undefined },
  });

  it("egyszerre egy futás megy, és a hiba után a zár felengedi", async () => {
    let release: () => void = () => undefined;
    const slow = new MedusaPriceDedupeService({
      enabled: () => true,
      deps: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return emptyDeps();
      },
    });
    const first = slow.run(["a"], false);
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
      () => slow.run(["a"], false),
      (error: unknown) =>
        error instanceof HttpException && error.getStatus() === 429,
    );
    release();
    await first;

    const failing = new MedusaPriceDedupeService({
      enabled: () => true,
      deps: async () => {
        throw new Error("boom");
      },
    });
    await assert.rejects(() => failing.run(["a"], false), /boom/);
    await assert.rejects(() => failing.run(["a"], false), /boom/);
  });

  it("az összesítés a bejegyzésekből jön, és az apply jelzőt visszaadja", async () => {
    const service = new MedusaPriceDedupeService({
      enabled: () => true,
      deps: async () => emptyDeps(),
    });
    const result = await service.run(["a", "b"], true);
    assert.equal(result.apply, true);
    assert.deepEqual(result.counts, { unreadable: 2 });
    assert.equal(result.entries.length, 2);
  });
});
