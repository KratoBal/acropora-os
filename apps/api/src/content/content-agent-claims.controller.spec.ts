import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";

import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator.js";
import { ManufacturerClaimsController } from "../products/manufacturer-claims/manufacturer-claims.controller.js";
import { ContentAgentClaimsController } from "./content-agent-claims.controller.js";
import { ContentAgentController } from "./content-agent.controller.js";
import { ContentAgentGuard } from "./content-agent.guard.js";
import { ContentClaimsController } from "./content-claims.controller.js";

/**
 * THE AGENT ENTRY TO THE CLAIMS IS GUARDED LIKE THE CONTENT AGENT ENTRY, AND ONLY IT IS PUBLIC (T5.3).
 * `@Public()` sets the global guard aside for the whole class; the class guard is what checks. The
 * two human controllers must stay non-public: one slip there would open them, silently.
 */
describe("a gépi állítás-bejárat határa", () => {
  it("a gépi vezérlő nyilvános a globális őrnek, és a tartalom-ágens őrzője védi", () => {
    assert.equal(
      Reflect.getMetadata(IS_PUBLIC_KEY, ContentAgentClaimsController),
      true,
    );
    assert.deepEqual(
      Reflect.getMetadata(GUARDS_METADATA, ContentAgentClaimsController),
      [ContentAgentGuard],
    );
  });

  it("az emberi vezérlők nem nyilvánosak", () => {
    for (const controller of [
      ManufacturerClaimsController,
      ContentClaimsController,
    ])
      assert.equal(
        Reflect.getMetadata(IS_PUBLIC_KEY, controller),
        undefined,
        controller.name,
      );
  });

  it("saját előtag: a tartalom-ágens `content/agent/:id` útvonala nem nyeli el", () => {
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, ContentAgentClaimsController),
      "content/agent-claims",
    );
    assert.equal(
      Reflect.getMetadata(PATH_METADATA, ContentAgentController),
      "content/agent",
    );
  });

  it("archiválás nincs a gépi úton", () => {
    const methods = Object.getOwnPropertyNames(
      ContentAgentClaimsController.prototype,
    );
    assert.ok(methods.includes("setStatus"), "the probe sees the methods");
    assert.deepEqual(
      methods.filter((name) => /archive|delete|remove/i.test(name)),
      [],
    );
  });
});
