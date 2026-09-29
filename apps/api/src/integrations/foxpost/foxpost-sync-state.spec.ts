import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FoxpostGmailClient } from "./foxpost-gmail.client.js";
import type { FoxpostMonthlyReportXlsx } from "./foxpost-monthly-report.xlsx.js";
import type { FoxpostSettlementParser } from "./foxpost-settlement.parser.js";
import type { FoxpostSettlementRepository } from "./foxpost-settlement.repository.js";
import { foxpostSettlementScheduleConfig } from "./foxpost-settlement.scheduler.js";
import { FoxpostSettlementService } from "./foxpost-settlement.service.js";
import {
  foxpostSyncIntervalMinutes,
  foxpostSyncState,
} from "./foxpost-sync-state.js";
import type { UnasApiClient } from "../../imports/unas/unas-api.client.js";
import type { UnasAuthService } from "../../imports/unas/unas-auth.service.js";

/**
 * THE PAGE SAYS WHAT THE SCHEDULER DOES. Measured on production 2026-09-29:
 * the Foxpost pull never ran by itself in seven weeks and nothing showed it.
 * The status and the schedule read the switch through the same function, so
 * the two cannot disagree; these tests hold them side by side.
 */
const KEY = {
  GMAIL_FOXPOST_CLIENT_ID: "id",
  GMAIL_FOXPOST_CLIENT_SECRET: "secret",
  GMAIL_FOXPOST_REFRESH_TOKEN: "refresh",
};

describe("foxpostSyncState", () => {
  it("names why the pull is off, one reason per switch value", () => {
    assert.equal(foxpostSyncState({ ...KEY }), "DISABLED_NOT_SET");
    assert.equal(
      foxpostSyncState({ ...KEY, GMAIL_FOXPOST_SYNC_ENABLED: "  " }),
      "DISABLED_NOT_SET",
    );
    assert.equal(
      foxpostSyncState({ ...KEY, GMAIL_FOXPOST_SYNC_ENABLED: "false" }),
      "DISABLED_OFF",
    );
    assert.equal(
      foxpostSyncState({ ...KEY, GMAIL_FOXPOST_SYNC_ENABLED: "yes" }),
      "DISABLED_UNRECOGNISED",
    );
  });

  it("is on only with both the switch and the key", () => {
    assert.equal(
      foxpostSyncState({ ...KEY, GMAIL_FOXPOST_SYNC_ENABLED: " True\n" }),
      "ENABLED",
    );
    assert.equal(
      foxpostSyncState({ GMAIL_FOXPOST_SYNC_ENABLED: "true" }),
      "NO_KEY",
    );
  });

  it("agrees with the schedule on every switch value", () => {
    for (const value of [
      undefined,
      "",
      "true",
      " TRUE ",
      "false",
      "1",
      "yes",
    ]) {
      const environment = { ...KEY, GMAIL_FOXPOST_SYNC_ENABLED: value };
      assert.equal(
        foxpostSyncState(environment) === "ENABLED",
        foxpostSettlementScheduleConfig(environment).enabled,
        `switch value ${JSON.stringify(value)}`,
      );
    }
  });

  it("reports the interval without throwing, 60 when unset or invalid", () => {
    assert.equal(foxpostSyncIntervalMinutes({}), 60);
    assert.equal(
      foxpostSyncIntervalMinutes({ GMAIL_FOXPOST_SYNC_INTERVAL_MINUTES: "30" }),
      30,
    );
    assert.equal(
      foxpostSyncIntervalMinutes({ GMAIL_FOXPOST_SYNC_INTERVAL_MINUTES: "1" }),
      60,
    );
  });
});

describe("FoxpostSettlementService.syncStatus", () => {
  function service(lastRun: unknown, lastScheduledRun?: unknown) {
    return new FoxpostSettlementService(
      {} as FoxpostGmailClient,
      {} as FoxpostSettlementParser,
      {
        lastRun: async (trigger?: string) =>
          trigger === "SCHEDULED" ? lastScheduledRun : lastRun,
      } as unknown as FoxpostSettlementRepository,
      {} as FoxpostMonthlyReportXlsx,
      {} as UnasAuthService,
      {} as UnasApiClient,
    );
  }

  it("says off, with a key the manual check can still use, and the last run", async () => {
    const run = {
      status: "APPLIED",
      startedAt: "2026-09-29T08:00:00.000Z",
      messagesSeen: 3,
      createdCount: 1,
      skippedCount: 2,
      needsReviewCount: 0,
      failedCount: 0,
    };
    assert.deepEqual(
      await service(run).syncStatus({
        ...KEY,
        GMAIL_FOXPOST_SYNC_ENABLED: "yes",
      }),
      {
        state: "DISABLED_UNRECOGNISED",
        canRunNow: true,
        intervalMinutes: 60,
        lastRun: run,
        lastScheduledRun: undefined,
      },
    );
  });

  it("cannot run now without a key, and has no last run before the first", async () => {
    assert.deepEqual(await service(undefined).syncStatus({}), {
      state: "DISABLED_NOT_SET",
      canRunNow: false,
      intervalMinutes: 60,
      lastRun: undefined,
      lastScheduledRun: undefined,
    });
  });

  it("reports the last AUTOMATIC run apart from the last run", async () => {
    // A person pressed the button after the timer ran: the page must still
    // say when the timer last ran, not the button's run.
    const scheduled = { status: "APPLIED", trigger: "SCHEDULED" };
    const manual = { status: "APPLIED", trigger: "MANUAL" };
    const status = await service(manual, scheduled).syncStatus({
      ...KEY,
      GMAIL_FOXPOST_SYNC_ENABLED: "true",
    });
    assert.equal(status.lastRun, manual);
    assert.equal(status.lastScheduledRun, scheduled);
  });
});
