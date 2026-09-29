import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GlsGmailSyncService } from "./gls-gmail-sync.service.js";

import {
  describeGlsSyncState,
  glsGmailCredentials,
  glsSyncSwitch,
} from "./gls-gmail.config.js";
import { GlsGmailSyncScheduler } from "./gls-gmail-sync.scheduler.js";
import { glsSyncState } from "./gls-gmail-sync.service.js";

const KEY = {
  GMAIL_FOXPOST_CLIENT_ID: "foxpost-client",
  GMAIL_FOXPOST_CLIENT_SECRET: "foxpost-secret",
  GMAIL_FOXPOST_REFRESH_TOKEN: "foxpost-refresh",
};

describe("glsSyncSwitch", () => {
  it("reads the switch patiently, and never lets a strange value be quietly off", () => {
    for (const value of ["true", "True", " TRUE ", "true\n"])
      assert.deepEqual(
        glsSyncSwitch(value),
        { on: true },
        JSON.stringify(value),
      );
    for (const value of ["false", "FALSE", " false "])
      assert.deepEqual(glsSyncSwitch(value), { on: false, reason: "OFF" });
    for (const value of [undefined, "", "  "])
      assert.deepEqual(glsSyncSwitch(value), { on: false, reason: "NOT_SET" });
    // production 2026-09-29: the Foxpost switch was set to something that was
    // not "true", and nothing said so for seven weeks
    for (const value of ["1", "yes", "on", "tru", '"true"'])
      assert.deepEqual(
        glsSyncSwitch(value),
        { on: false, reason: "UNRECOGNISED" },
        value,
      );
  });
});

describe("glsGmailCredentials", () => {
  it("uses its own key, else the Foxpost pull's key for the same mailbox", () => {
    assert.equal(glsGmailCredentials({})?.source, undefined);
    assert.equal(glsGmailCredentials(KEY)?.source, "GMAIL_FOXPOST");
    assert.deepEqual(
      glsGmailCredentials({
        ...KEY,
        GMAIL_GLS_CLIENT_ID: "gls-client",
        GMAIL_GLS_CLIENT_SECRET: "gls-secret",
        GMAIL_GLS_REFRESH_TOKEN: "gls-refresh",
      }),
      {
        clientId: "gls-client",
        clientSecret: "gls-secret",
        refreshToken: "gls-refresh",
        source: "GMAIL_GLS",
      },
    );
  });
});

describe("glsSyncState", () => {
  it("tells every way of being off apart, and a missing key from a switch", () => {
    assert.equal(glsSyncState({}), "DISABLED_NOT_SET");
    assert.equal(
      glsSyncState({ GMAIL_GLS_SYNC_ENABLED: "false" }),
      "DISABLED_OFF",
    );
    assert.equal(
      glsSyncState({ GMAIL_GLS_SYNC_ENABLED: "1" }),
      "DISABLED_UNRECOGNISED",
    );
    assert.equal(glsSyncState({ GMAIL_GLS_SYNC_ENABLED: "true" }), "NO_KEY");
    assert.equal(
      glsSyncState({ GMAIL_GLS_SYNC_ENABLED: "True", ...KEY }),
      "ENABLED",
    );
  });

  it("names the key's variables in the sentence, never its value", () => {
    const sentence = describeGlsSyncState(
      { on: true },
      glsGmailCredentials(KEY),
      60,
    );
    assert.equal(
      sentence,
      "GLS Gmail sync enabled (60 min, key: GMAIL_FOXPOST_*)",
    );
    assert.ok(!sentence.includes("foxpost-refresh"));
  });
});

describe("GlsGmailSyncScheduler.onModuleInit", () => {
  function startedWith(environment: Record<string, string>): string[] {
    const saved = { ...process.env };
    for (const key of Object.keys(process.env))
      if (key.startsWith("GMAIL_GLS_") || key.startsWith("GMAIL_FOXPOST_"))
        delete process.env[key];
    Object.assign(process.env, environment);
    const logged: string[] = [];
    const scheduler = new GlsGmailSyncScheduler({} as GlsGmailSyncService);
    (
      scheduler as unknown as { logger: { log(message: string): void } }
    ).logger = { log: (message: string) => logged.push(message) };
    try {
      scheduler.onModuleInit();
    } finally {
      scheduler.onModuleDestroy();
      process.env = saved;
    }
    return logged;
  }

  it("says in one line at start why it does not run", () => {
    assert.deepEqual(startedWith({}), [
      "GLS Gmail sync disabled (GMAIL_GLS_SYNC_ENABLED is not set)",
    ]);
    assert.deepEqual(startedWith({ GMAIL_GLS_SYNC_ENABLED: "yes" }), [
      "GLS Gmail sync disabled (GMAIL_GLS_SYNC_ENABLED is set to something that is neither true nor false)",
    ]);
    assert.deepEqual(startedWith({ GMAIL_GLS_SYNC_ENABLED: "true" }), [
      "GLS Gmail sync disabled (switched on, but no Gmail key: GMAIL_GLS_* and GMAIL_FOXPOST_* are both empty)",
    ]);
  });

  it("says that it runs, and with which key", () => {
    assert.deepEqual(startedWith({ GMAIL_GLS_SYNC_ENABLED: "true", ...KEY }), [
      "GLS Gmail sync enabled (60 min, key: GMAIL_FOXPOST_*)",
    ]);
  });
});
