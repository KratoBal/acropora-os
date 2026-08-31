import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import type { HealthResponse } from "@acropora/types";

import { AppController } from "./app.controller.js";
import type { AppService } from "./app.service.js";

/**
 * WHY THIS EXISTS, and why it is a unit test rather than a second smoke test.
 *
 * `health.smoke.spec.ts` covers only the 200 branch, and it needs a real
 * database and Redis to do so. The branch nobody covered is the one a
 * deployment check needs MOST: when a dependency is down, `/health` answers
 * 503 - and the running build's commit is still in that body. A checking tool
 * that only reads 200 responses goes blind exactly on the broken instance,
 * which is the instance whose version you most want to know.
 *
 * The shape of the 503 body was, until this file, derived by reading Nest's
 * `HttpException.createBody` (it returns an object argument unchanged). That is
 * a sound reading of a dependency's source, but it is not a measurement of OUR
 * system, and it silently stops being true if the controller ever wraps the
 * payload. These assertions turn that reading into something the suite holds.
 *
 * No infrastructure is needed: the controller's job here is purely to decide
 * between returning and throwing, so a stub service is enough. That also keeps
 * the file out of the `*.smoke.spec` / `*.integration.spec` exclusions in the
 * `test` script, so it runs in the default suite.
 */

const COMMIT = "0f6eeb6a1b2c3d4e5f60718293a4b5c6d7e8f901";

function healthWith(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return {
    application: { status: "ok", version: "0.1.0", commit: COMMIT },
    database: { status: "ok" },
    redis: { status: "ok" },
    uptime: 12,
    timestamp: "2026-08-31T20:00:00.000Z",
    ...overrides,
  };
}

function controllerReturning(health: HealthResponse): AppController {
  return new AppController({
    getHealth: async () => health,
  } as unknown as AppService);
}

describe("AppController.getHealth", () => {
  it("returns the health payload unchanged when every dependency is ok", async () => {
    const health = healthWith();

    assert.deepEqual(await controllerReturning(health).getHealth(), health);
  });

  it("answers 503 when the database is unavailable", async () => {
    const health = healthWith({ database: { status: "unavailable" } });

    await assert.rejects(
      () => controllerReturning(health).getHealth(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.equal(error.getStatus(), 503);
        return true;
      },
    );
  });

  it("answers 503 when Redis is unavailable", async () => {
    const health = healthWith({ redis: { status: "unavailable" } });

    await assert.rejects(
      () => controllerReturning(health).getHealth(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.equal(error.getStatus(), 503);
        return true;
      },
    );
  });

  /**
   * The load-bearing assertion. A deployment check must be able to read the
   * commit from a 503 with the SAME key path it uses for a 200
   * (`application.commit`), otherwise it needs two parsers - or, far more
   * likely, it grows only the 200 one and reports nothing for broken
   * instances.
   */
  it("keeps the whole payload, commit included, in the 503 body", async () => {
    const health = healthWith({ database: { status: "unavailable" } });

    await assert.rejects(
      () => controllerReturning(health).getHealth(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);

        const body = error.getResponse();

        assert.deepEqual(body, health);
        assert.equal(
          (body as HealthResponse).application.commit,
          COMMIT,
          "the running build's commit must survive into the error body",
        );
        return true;
      },
    );
  });

  it("reports a null commit as null in the 503 body, never as a missing key", async () => {
    const health = healthWith({
      application: { status: "ok", version: "0.1.0", commit: null },
      redis: { status: "unavailable" },
    });

    await assert.rejects(
      () => controllerReturning(health).getHealth(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);

        const body = error.getResponse() as HealthResponse;

        assert.ok(
          "commit" in body.application,
          "an absent key is indistinguishable from an old deployment",
        );
        assert.equal(body.application.commit, null);
        return true;
      },
    );
  });
});
