import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_DAILY_LIMIT,
  parseServiceTokenCommand,
  ServiceTokenCommandError,
} from "./service-token.command.js";

describe("parseServiceTokenCommand", () => {
  it("parses a create command with a default daily limit", () =>
    assert.deepEqual(
      parseServiceTokenCommand([
        "create",
        "--slug",
        "polip",
        "--name",
        "Flotta - polip",
      ]),
      {
        action: "create",
        slug: "polip",
        name: "Flotta - polip",
        dailyLimit: DEFAULT_DAILY_LIMIT,
      },
    ));

  it("accepts --key=value form", () =>
    assert.deepEqual(
      parseServiceTokenCommand([
        "create",
        "--slug=korall",
        "--name=Flotta - korall",
        "--daily-limit=25",
      ]),
      {
        action: "create",
        slug: "korall",
        name: "Flotta - korall",
        dailyLimit: 25,
      },
    ));

  it("rejects a slug that could smuggle the namespace separator", () => {
    for (const slug of ["polip:korall", "Polip", "p", "polip token", ""])
      assert.throws(
        () =>
          parseServiceTokenCommand(["create", "--slug", slug, "--name", "X"]),
        ServiceTokenCommandError,
        `slug should be rejected: ${slug}`,
      );
  });

  it("rejects a non-positive or non-integer daily limit", () => {
    for (const limit of ["0", "-5", "abc", "1.5"])
      assert.throws(
        () =>
          parseServiceTokenCommand([
            "create",
            "--slug",
            "polip",
            "--name",
            "X",
            "--daily-limit",
            limit,
          ]),
        ServiceTokenCommandError,
      );
  });

  it("requires the mandatory options", () => {
    assert.throws(
      () => parseServiceTokenCommand(["create", "--slug", "polip"]),
      ServiceTokenCommandError,
    );
    assert.throws(
      () => parseServiceTokenCommand(["revoke"]),
      ServiceTokenCommandError,
    );
  });

  it("rejects an option left without a value", () =>
    assert.throws(
      () => parseServiceTokenCommand(["create", "--slug", "--name", "Flotta"]),
      ServiceTokenCommandError,
    ));

  it("parses revoke and list", () => {
    assert.deepEqual(parseServiceTokenCommand(["revoke", "--slug", "polip"]), {
      action: "revoke",
      slug: "polip",
    });
    assert.deepEqual(parseServiceTokenCommand(["list"]), { action: "list" });
  });

  it("refuses an unknown action instead of guessing", () =>
    assert.throws(
      () => parseServiceTokenCommand(["delete", "--slug", "polip"]),
      ServiceTokenCommandError,
    ));
});
