import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import {
  CATALOG_ACTION_RUNNERS,
  CatalogActionInputError,
  type CatalogActionRunner,
} from "./catalog-actions.runners.js";
import { CatalogActionsService } from "./catalog-actions.service.js";

/*
  A KIND THAT TAKES A LIST (`brand-from-list`; card 16d06aea). What turns this red: a bad list that starts a run; an apply
  that writes a list sent WITH the apply instead of the plan's; an apply that gets no list at all; a kind without input
  that starts reading the request body; the overview not saying which kind needs a list (the page would show a button
  that can only fail).
*/
const ON = {
  CATALOG_ADMIN_ACTIONS_ENABLED: "true",
  MEDUSA_ADMIN_URL: "https://medusa-teszt.example.test/",
  CATALOG_ACTION_MEDUSA_HOSTS: "medusa-teszt.example.test",
};

function listRunner(
  seen: { apply: boolean; input: unknown }[],
): CatalogActionRunner {
  return {
    kind: "brand-from-list",
    title: "l",
    description: "l",
    parseInput: (body) => {
      const items = (body as { items?: unknown } | undefined)?.items;
      if (!Array.isArray(items))
        throw new CatalogActionInputError("nincs lista");
      return items;
    },
    async run(apply, _actor, out, input) {
      seen.push({ apply, input });
      out.stdout("ok\n");
      return 0;
    },
  };
}
const plainRunner = (seen: unknown[]): CatalogActionRunner => ({
  kind: "brand-from-name",
  title: "n",
  description: "n",
  async run(_apply, _actor, _out, input) {
    seen.push(input);
    return 0;
  },
});

describe("a listát váró művelet", () => {
  it("a próba a törzs listáját kapja; a végrehajtás a PRÓBA listáját, nem a sajátját", async () => {
    const seen: { apply: boolean; input: unknown }[] = [];
    const svc = new CatalogActionsService([listRunner(seen)], ON);
    const plan = svc.plan("brand-from-list", "u1", { items: ["a", "b"] });
    await svc.settled(plan.id);
    // a list sent with the apply request is never read: apply(kind, planRunId, actor) has no place for it
    const apply = svc.apply("brand-from-list", plan.id, "u1");
    await svc.settled(apply.id);
    assert.deepEqual(seen, [
      { apply: false, input: ["a", "b"] },
      { apply: true, input: ["a", "b"] },
    ]);
  });

  it("egy hibás lista 400, és nem indul futás (a zár sem foglalt)", async () => {
    const seen: { apply: boolean; input: unknown }[] = [];
    const svc = new CatalogActionsService([listRunner(seen)], ON);
    assert.throws(
      () => svc.plan("brand-from-list", "u1", { nincs: 1 }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes("nincs lista"),
    );
    assert.deepEqual(seen, []);
    const ok = svc.plan("brand-from-list", "u1", { items: ["a"] });
    await svc.settled(ok.id);
    assert.equal(seen.length, 1);
  });

  it("két próba két külön listát tart, és egyik sem keveredik a másikéval", async () => {
    const seen: { apply: boolean; input: unknown }[] = [];
    const svc = new CatalogActionsService([listRunner(seen)], ON);
    const first = svc.plan("brand-from-list", "u1", { items: ["első"] });
    await svc.settled(first.id);
    const second = svc.plan("brand-from-list", "u1", { items: ["második"] });
    await svc.settled(second.id);
    const apply = svc.apply("brand-from-list", first.id, "u1");
    await svc.settled(apply.id);
    assert.deepEqual(seen.at(-1), { apply: true, input: ["első"] });
  });

  it("a lista nélküli művelet nem olvassa a törzset", async () => {
    const seen: unknown[] = [];
    const svc = new CatalogActionsService([plainRunner(seen)], ON);
    const run = svc.plan("brand-from-name", "u1", { items: ["a"] });
    await svc.settled(run.id);
    assert.deepEqual(seen, [undefined]);
  });

  it("az áttekintés jelzi, melyik művelet kér listát", () => {
    const svc = new CatalogActionsService(CATALOG_ACTION_RUNNERS, ON);
    const views = svc.overview().actions;
    const flagged = views.filter((v) => v.requiresInput).map((v) => v.kind);
    assert.deepEqual(flagged, ["brand-from-list"]);
  });
});
