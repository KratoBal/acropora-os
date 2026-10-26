import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { HomepageContentController } from "./homepage-content.controller.js";
import type { HomepageContentService } from "./homepage-content.service.js";

/*
  A WEBSHOP KEZDŐLAP-SZERKESZTŐJE CSAK OTT ÉL, AHOL A KÖRNYEZET A TESZT-WEBSHOPBA ÍRHAT (acrobot 34365,
  kártya 04a106cd; a commerce-kivétel csak a tesztre szól). MI PIROSÍT: ha egy végpont a kapcsoló nélkül
  futna (élesen a szerkesztő az OS adatbázisába írhatna); ha a kapcsolóval nem jutna el a szolgáltatásig.
*/
const user = { id: "u1" } as AuthenticatedUser;
const file = { buffer: Buffer.from("x") } as Express.Multer.File;

function controller(env: NodeJS.ProcessEnv) {
  const calls: string[] = [];
  const record = (name: string) => async () => {
    calls.push(name);
    return {};
  };
  const service = {
    get: record("get"),
    save: record("save"),
    setProjection: record("setProjection"),
    featured: record("featured"),
    setFeatured: record("setFeatured"),
    orderFeatured: record("orderFeatured"),
    uploadImage: record("uploadImage"),
  } as unknown as HomepageContentService;
  return { calls, c: new HomepageContentController(service, env) };
}

const all = (c: HomepageContentController) => [
  () => c.get(),
  () => c.save({}, user),
  () => c.setProjection({ enabled: true }, user),
  () => c.featured(),
  () => c.setFeatured("p1", { featured: true }, user),
  () => c.orderFeatured({ productIds: ["p1"] }, user),
  () => c.uploadImage(file),
];

describe("the home page content endpoints follow MEDUSA_PROJECT_HOMEPAGE_CONTENT", () => {
  for (const [label, env] of [
    ["no variable (production)", {}],
    ["false", { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "false" }],
    ["a value other than true", { MEDUSA_PROJECT_HOMEPAGE_CONTENT: "1" }],
  ] as const) {
    it(`off, ${label}: all seven endpoints are 404 and the service is not called`, () => {
      const { calls, c } = controller(env);
      for (const call of all(c)) assert.throws(call, NotFoundException);
      assert.deepEqual(calls, []);
    });
  }

  it("off: a missing upload is 404 too, not a bad request (the switch comes first)", () => {
    const { c } = controller({});
    assert.throws(() => c.uploadImage(undefined), NotFoundException);
    const on = controller({ MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true" });
    assert.throws(() => on.c.uploadImage(undefined), BadRequestException);
  });

  it("on: every endpoint reaches the service", async () => {
    const { calls, c } = controller({
      MEDUSA_PROJECT_HOMEPAGE_CONTENT: "true",
    });
    for (const call of all(c)) await call();
    assert.deepEqual(calls, [
      "get",
      "save",
      "setProjection",
      "featured",
      "setFeatured",
      "orderFeatured",
      "uploadImage",
    ]);
  });
});
