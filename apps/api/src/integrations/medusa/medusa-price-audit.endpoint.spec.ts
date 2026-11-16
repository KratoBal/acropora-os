import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { HttpException } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { MedusaConnectionError } from "./medusa-connection.types.js";
import {
  MedusaPriceAuditController,
  priceAuditQuery,
} from "./medusa-price-audit.controller.js";
import {
  MedusaPriceAuditService,
  type PriceAuditQuery,
} from "./medusa-price-audit.service.js";
import type { runPriceAuditCli } from "./medusa-price-audit.cli.js";

/*
  THE PRICE AUDIT ENDPOINT (acrobot 53851). WHAT TURNS RED: the permission is not the status read right, a write verb appears on the
  controller, the strict query lets a mistyped key or an oversized page through, the cursor is wrong (a full page must hand on the
  last id, a short page must say it is the end), the CLI's own error lines are lost, two runs overlap, or a failed run leaves the
  guard stuck.
*/
type Runner = typeof runPriceAuditCli;

function runnerOf(ids: string[], stdout = "", stderr = "", exit = 0) {
  const calls: string[][] = [];
  const runner: Runner = async (args, out, _c, _d, onTargets) => {
    calls.push(args);
    onTargets?.(ids);
    if (stdout) out?.stdout(stdout);
    if (stderr) out?.stderr(stderr);
    return exit;
  };
  return { runner, calls };
}

const base: PriceAuditQuery = { limit: 3, from: null, all: false };

describe("a ár-vizsgálat végpontja", () => {
  it("a vetítő sor olvasásának jogát kéri, és csak GET van rajta", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        MedusaPriceAuditController.prototype.audit,
      ),
      [PERMISSIONS.INVENTORY_VIEW],
    );
    const source = readFileSync(
      "src/integrations/medusa/medusa-price-audit.controller.ts",
      "utf8",
    );
    assert.match(source, /@Get\(\)/); // control: the file is the one we read
    assert.doesNotMatch(source, /@(Post|Put|Patch|Delete)\(/);
  });

  it("a szűk lekérdezés: alapértelmezés, érvényes értékek", () => {
    assert.deepEqual(priceAuditQuery({}), {
      limit: 100,
      from: null,
      all: false,
    });
    assert.deepEqual(
      priceAuditQuery({ limit: "300", from: " prod_1 ", all: "true" }),
      { limit: 300, from: "prod_1", all: true },
    );
  });

  it("a rossz lekérdezés 400", () => {
    const rosszak: unknown[] = [
      null,
      [],
      { limt: "5" },
      { limit: "0" },
      { limit: "301" },
      { limit: "abc" },
      { limit: 5 },
      { limit: "5.5" },
      { from: "" },
      { from: "x".repeat(201) },
      { from: ["a"] },
      { all: "yes" },
      { all: true },
    ];
    for (const rossz of rosszak)
      assert.throws(
        () => priceAuditQuery(rossz),
        (error: unknown) =>
          error instanceof HttpException && error.getStatus() === 400,
        JSON.stringify(rossz),
      );
  });

  it("a teljes oldal továbbadja az utolsó azonosítót, a rövid oldal a végét jelzi", async () => {
    const full = runnerOf(["a", "b", "c"], "x\n");
    const fullView = await new MedusaPriceAuditService(full.runner).run(base);
    assert.equal(fullView.nextFrom, "c");
    assert.equal(fullView.selected, 3);

    const short = runnerOf(["a", "b"], "x\n");
    const shortView = await new MedusaPriceAuditService(short.runner).run(base);
    assert.equal(shortView.nextFrom, null);
    assert.equal(shortView.selected, 2);
  });

  it("a parancs saját sorait és hibasorait adja vissza, és a kapcsolókat átadja", async () => {
    const { runner, calls } = runnerOf(
      ["a"],
      "# egy\nsor\n# összesítés: 1\n",
      "hiba szöveg\n",
      1,
    );
    const view = await new MedusaPriceAuditService(runner).run({
      limit: 5,
      from: "p0",
      all: true,
    });
    assert.deepEqual(calls, [["--limit", "5", "--from", "p0", "--all"]]);
    assert.deepEqual(view.lines, ["# egy", "sor", "# összesítés: 1"]);
    assert.deepEqual(view.errors, ["hiba szöveg"]);
    assert.equal(view.exitCode, 1);
  });

  it("egyszerre egy futás megy, és a hiba után a zár felengedi", async () => {
    let release: () => void = () => undefined;
    const slow: Runner = (_a, _o, _c, _d, onTargets) =>
      new Promise((resolve) => {
        onTargets?.([]);
        release = () => resolve(0);
      });
    const service = new MedusaPriceAuditService(slow);
    const first = service.run(base);
    await assert.rejects(
      () => service.run(base),
      (error: unknown) =>
        error instanceof HttpException && error.getStatus() === 429,
    );
    release();
    await first;

    const failing: Runner = async () => {
      throw new Error("boom");
    };
    const second = new MedusaPriceAuditService(failing);
    await assert.rejects(() => second.run(base), /boom/);
    // the guard is released: the next call reaches the runner again
    await assert.rejects(() => second.run(base), /boom/);
  });

  it("a bolt elérhetetlensége 503, más hiba nem lesz 503", async () => {
    const unreachable = new MedusaPriceAuditController({
      run: async () => {
        throw new MedusaConnectionError("MEDUSA_UNREACHABLE" as never);
      },
    } as unknown as MedusaPriceAuditService);
    await assert.rejects(
      () => unreachable.audit({}),
      (error: unknown) =>
        error instanceof HttpException && error.getStatus() === 503,
    );
    const other = new MedusaPriceAuditController({
      run: async () => {
        throw new Error("boom");
      },
    } as unknown as MedusaPriceAuditService);
    await assert.rejects(() => other.audit({}), /boom/);
  });
});
