import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readEnvironment } from "./env";

const VALID = {
  EXPO_PUBLIC_APP_ENV: "development",
  EXPO_PUBLIC_API_URL: "http://192.168.1.50:3001",
};

describe("readEnvironment", () => {
  it("reads a complete configuration", () => {
    const outcome = readEnvironment(VALID);
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.ok && outcome.config, {
      appEnvironment: "development",
      apiUrl: "http://192.168.1.50:3001",
      foregroundLockThresholdMs: 900_000,
    });
  });

  it("defaults the environment name when it is not set", () => {
    const outcome = readEnvironment({
      EXPO_PUBLIC_API_URL: VALID.EXPO_PUBLIC_API_URL,
    });
    assert.equal(outcome.ok && outcome.config.appEnvironment, "development");
  });

  it("drops a trailing slash so paths do not double up", () => {
    const outcome = readEnvironment({
      ...VALID,
      EXPO_PUBLIC_API_URL: "https://api.example.com/",
    });
    assert.equal(
      outcome.ok && outcome.config.apiUrl,
      "https://api.example.com",
    );
  });

  describe("a broken configuration is reported, never thrown", () => {
    // Throwing happens at import time, before any screen exists: the app
    // dies on launch with nothing to read. That is the failure this
    // function is shaped to avoid, so every one of these must return.
    it("says so when the server address is missing", () => {
      const outcome = readEnvironment({
        EXPO_PUBLIC_APP_ENV: "development",
      });
      assert.equal(outcome.ok, false);
      assert.equal(!outcome.ok && outcome.problems.length, 1);
      assert.match(
        (!outcome.ok && outcome.problems[0]) || "",
        /EXPO_PUBLIC_API_URL/,
      );
    });

    it("says so when the server address is not a web address", () => {
      const outcome = readEnvironment({
        ...VALID,
        EXPO_PUBLIC_API_URL: "192.168.1.50:3001",
      });
      assert.equal(outcome.ok, false);
      assert.match(
        (!outcome.ok && outcome.problems[0]) || "",
        /nem érvényes webcím/,
      );
    });

    it("says so when the server address is not http or https", () => {
      const outcome = readEnvironment({
        ...VALID,
        EXPO_PUBLIC_API_URL: "ftp://example.com",
      });
      assert.equal(outcome.ok, false);
      assert.match(
        (!outcome.ok && outcome.problems[0]) || "",
        /nem http vagy https/,
      );
    });

    it("says so when the environment name is not one of the three", () => {
      const outcome = readEnvironment({
        ...VALID,
        EXPO_PUBLIC_APP_ENV: "staging",
      });
      assert.equal(outcome.ok, false);
      assert.match(
        (!outcome.ok && outcome.problems[0]) || "",
        /EXPO_PUBLIC_APP_ENV/,
      );
    });

    it("collects every problem at once, so one fix does not reveal the next", () => {
      const outcome = readEnvironment({ EXPO_PUBLIC_APP_ENV: "staging" });
      assert.equal(outcome.ok, false);
      assert.equal(!outcome.ok && outcome.problems.length, 2);
    });
  });

  it("ignores settings it does not know about", () => {
    const outcome = readEnvironment({ ...VALID, EXPO_PUBLIC_SOMETHING: "x" });
    assert.equal(outcome.ok, true);
  });

  it("does not refuse to start over an unreadable lock threshold", () => {
    // The threshold has a safe default; the server address does not.
    // Refusing to start over a mistyped tuning knob would be the very
    // failure this file exists to prevent.
    const outcome = readEnvironment({
      ...VALID,
      EXPO_PUBLIC_LOCK_THRESHOLD_SECONDS: "tizenöt perc",
    });
    assert.equal(outcome.ok, true);
    assert.equal(
      outcome.ok && outcome.config.foregroundLockThresholdMs,
      900_000,
    );
  });
});
