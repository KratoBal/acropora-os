import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";

import { IS_PUBLIC_KEY } from "../../auth/decorators/public.decorator.js";
import { ContentAgentGuard } from "../content-agent.guard.js";
import { ProductDataController } from "./product-data.controller.js";
import type { ProductDataService } from "./product-data.service.js";

/*
  WHAT TURNS THIS RED: the guard taken off the controller (the global AuthGuard is stepped aside by @Public, so without
  the guard the route would be OPEN to anyone); a write verb added; a bad query reaching the service; the route moved
  under `content/`, where the `:id` parameter routes would swallow it.
*/
const methods = (
  Object.getOwnPropertyNames(ProductDataController.prototype) as string[]
).filter((name) => name !== "constructor");

describe("ProductDataController", () => {
  it("is public only to the global guard and is guarded by the content agent guard", () => {
    assert.equal(
      Reflect.getMetadata(IS_PUBLIC_KEY, ProductDataController),
      true,
    );
    assert.deepEqual(Reflect.getMetadata("__guards__", ProductDataController), [
      ContentAgentGuard,
    ]);
  });

  it("has exactly one route, and it is a GET (nothing writes, in any direction)", () => {
    assert.deepEqual(methods, ["read"]);
    const handler = ProductDataController.prototype.read;
    // Nest's RequestMethod.GET is 0
    assert.equal(Reflect.getMetadata("method", handler), 0);
    assert.equal(
      Reflect.getMetadata("path", ProductDataController),
      "agent-product-data",
    );
  });

  it("parses the query before the service sees it", async () => {
    const calls: unknown[] = [];
    const controller = new ProductDataController({
      read: async (request: unknown) => {
        calls.push(request);
        return { ok: true };
      },
    } as unknown as ProductDataService);
    await controller.read({ ids: "p1" });
    assert.equal(calls.length, 1);
    assert.throws(() => controller.read({}), BadRequestException);
    assert.equal(calls.length, 1);
  });
});
