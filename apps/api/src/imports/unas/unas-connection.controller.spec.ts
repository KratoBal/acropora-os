import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPermission, PERMISSIONS } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../../auth/decorators/require-permissions.decorator.js";
import { UnasConnectionController } from "./unas-connection.controller.js";
import type { UnasConnectionService } from "./unas-connection.service.js";

describe("UnasConnectionController authorization", () => {
  it("requires settings.manage for every connection operation", () => {
    assert.deepEqual(
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, UnasConnectionController),
      [PERMISSIONS.SETTINGS_MANAGE],
    );
    assert.equal(hasPermission("OWNER", PERMISSIONS.SETTINGS_MANAGE), true);
    assert.equal(hasPermission("ADMIN", PERMISSIONS.SETTINGS_MANAGE), true);
    assert.equal(hasPermission("MANAGER", PERMISSIONS.SETTINGS_MANAGE), false);
    assert.equal(
      hasPermission("WAREHOUSE", PERMISSIONS.SETTINGS_MANAGE),
      false,
    );
  });

  it("passes only the candidate and authenticated actor to the service", async () => {
    const calls: unknown[] = [];
    const controller = new UnasConnectionController({
      replaceCredential: async (apiKey: string, actor: string) => {
        calls.push({ apiKey, actor });
        return {
          configured: true,
          masked: "••••••••",
          modifiedAt: null,
          verification: { status: "SUCCESS", checkedAt: null, code: null },
        };
      },
    } as unknown as UnasConnectionService);
    const response = await controller.replaceCredential(
      { apiKey: "candidate-secret" },
      {
        id: "admin-1",
        email: "admin@example.invalid",
        displayName: "Admin",
        role: "ADMIN",
      },
    );
    assert.deepEqual(calls, [{ apiKey: "candidate-secret", actor: "admin-1" }]);
    assert.equal(JSON.stringify(response).includes("candidate-secret"), false);
  });

  it("normalizes malformed bodies without echoing fields or values", () => {
    const controller = new UnasConnectionController(
      {} as UnasConnectionService,
    );
    assert.throws(
      () =>
        controller.replaceCredential(
          { apiKey: "candidate-secret", "raw-private-field": "payload" },
          {
            id: "admin-1",
            email: "admin@example.invalid",
            displayName: "Admin",
            role: "ADMIN",
          },
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "UNAS_CREDENTIAL_INPUT_INVALID" &&
        !error.message.includes("candidate-secret") &&
        !error.message.includes("raw-private-field"),
    );
    assert.throws(
      () =>
        controller.replaceCredential(
          { apiKey: "x".repeat(4097) },
          {
            id: "admin-1",
            email: "admin@example.invalid",
            displayName: "Admin",
            role: "ADMIN",
          },
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "UNAS_CREDENTIAL_INPUT_INVALID" &&
        error.message.length < 100,
    );
  });
});
