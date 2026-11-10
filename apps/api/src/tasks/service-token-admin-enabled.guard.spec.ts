import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { NotFoundException } from "@nestjs/common";

import {
  ServiceTokenAdminEnabledGuard,
  isServiceTokenAdminEnabled,
} from "./service-token-admin-enabled.guard.js";

const saved = process.env.SERVICE_TOKEN_ADMIN_ENABLED;
afterEach(() => {
  if (saved === undefined) delete process.env.SERVICE_TOKEN_ADMIN_ENABLED;
  else process.env.SERVICE_TOKEN_ADMIN_ENABLED = saved;
});

describe("service token admin switch", () => {
  it("is on only for exactly `true`", () => {
    assert.equal(
      isServiceTokenAdminEnabled({ SERVICE_TOKEN_ADMIN_ENABLED: "true" }),
      true,
    );
    for (const value of [
      undefined,
      "",
      "false",
      "TRUE",
      "True",
      "1",
      " true",
      "true ",
    ])
      assert.equal(
        isServiceTokenAdminEnabled({ SERVICE_TOKEN_ADMIN_ENABLED: value }),
        false,
        `value ${JSON.stringify(value)} must not turn it on`,
      );
  });

  it("the guard answers 404 when the variable is unset, and lets the request through when `true`", () => {
    const guard = new ServiceTokenAdminEnabledGuard();
    delete process.env.SERVICE_TOKEN_ADMIN_ENABLED;
    assert.throws(() => guard.canActivate(), NotFoundException);
    process.env.SERVICE_TOKEN_ADMIN_ENABLED = "false";
    assert.throws(() => guard.canActivate(), NotFoundException);
    process.env.SERVICE_TOKEN_ADMIN_ENABLED = "true";
    assert.equal(guard.canActivate(), true);
  });

  it("reads the value at request time, not at import", () => {
    const guard = new ServiceTokenAdminEnabledGuard();
    process.env.SERVICE_TOKEN_ADMIN_ENABLED = "true";
    assert.equal(guard.canActivate(), true);
    process.env.SERVICE_TOKEN_ADMIN_ENABLED = "false";
    assert.throws(() => guard.canActivate(), NotFoundException);
  });

  /*
    THE WIRING: the path is the package root's, and the reads are inside the tests (a throwing `describe` body is a silent
    `not ok`; the unit runner now fails on it, but a failing test is the louder form).
  */
  it("sits on the controller as a whole, so every route is shut with it", () => {
    const controller = readFileSync(
      "src/tasks/service-token-admin.controller.ts",
      "utf8",
    );
    assert.match(
      controller,
      /@Controller\("service-tokens"\)\s*@UseGuards\(ServiceTokenAdminEnabledGuard\)/,
    );
  });

  it("is named in both env templates, off", () => {
    for (const file of [".env.example", ".env.production.example"]) {
      const template = readFileSync(`../../${file}`, "utf8");
      assert.match(template, /^SERVICE_TOKEN_ADMIN_ENABLED=false$/m, file);
    }
  });
});
