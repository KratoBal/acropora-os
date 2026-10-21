import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { AquariumReefClubController } from "./aquarium-reefclub.controller.js";
import type { AquariumReefClubService } from "./aquarium-reefclub.service.js";

/*
  A REEFCLUB-KÓD KIADÁSA CSAK OTT ÉL, AHOL A REEFCLUB FUT (acrobot 34365, kártya 04a106cd). MI PIROSÍT:
  ha egy végpont a kapcsoló nélkül is futna (élesen egy kolléga kódot adhatna ki, és lokálhosztos levél
  mehetne a vevőnek); ha a kapcsolóval a hívás nem jutna el a szolgáltatásig.
*/
const user = { id: "u1" } as AuthenticatedUser;

function controller(env: NodeJS.ProcessEnv) {
  const calls: string[] = [];
  const service = {
    async issueCode() {
      calls.push("issueCode");
      return { code: "ABCD-EFGH", expiresAt: "2026-10-22T00:00:00.000Z" };
    },
    async links() {
      calls.push("links");
      return [];
    },
    async endLink() {
      calls.push("endLink");
    },
  } as unknown as AquariumReefClubService;
  return { calls, c: new AquariumReefClubController(service, env) };
}

const on = {
  REEFCLUB_WEB_URL: "https://reefclub-staging.acropora.hu",
  REEFCLUB_LINKING_ENABLED: "true",
};

describe("the ReefClub code endpoints follow the linking switch", () => {
  for (const [label, env] of [
    ["no variable (production)", {}],
    ["the switch without the address", { REEFCLUB_LINKING_ENABLED: "true" }],
    [
      "the address without the switch",
      { REEFCLUB_WEB_URL: "https://reefclub-staging.acropora.hu" },
    ],
    [
      "a switch value other than true",
      { ...on, REEFCLUB_LINKING_ENABLED: "1" },
    ],
  ] as const) {
    it(`off, ${label}: every endpoint is 404 and the service is not called`, async () => {
      const { calls, c } = controller(env);
      assert.throws(
        () => c.issueCode("cust", { sendEmail: true }, user),
        NotFoundException,
      );
      await assert.rejects(c.links("cust", user), NotFoundException);
      await assert.rejects(c.endLink("cust", "link", user), NotFoundException);
      assert.deepEqual(calls, []);
    });
  }

  it("on (the address AND the switch): every endpoint reaches the service", async () => {
    const { calls, c } = controller(on);
    await c.issueCode("cust", { sendEmail: false }, user);
    await c.links("cust", user);
    await c.endLink("cust", "link", user);
    assert.deepEqual(calls, ["issueCode", "links", "endLink"]);
  });
});
