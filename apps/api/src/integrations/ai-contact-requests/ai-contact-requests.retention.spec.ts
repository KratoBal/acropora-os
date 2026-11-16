import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_CHAT_SETTINGS_DEFAULTS,
  type AiChatSettings,
} from "@acropora/types";

import type { AiChatSettingsService } from "../ai-chat-settings/ai-chat-settings.service.js";
import type { AiContactRequestsRepository } from "./ai-contact-requests.repository.js";
import { AiContactRequestsRetention } from "./ai-contact-requests.retention.js";

/*
  THE RETENTION JOB AROUND THE SQL (the SQL itself is in the repository's integration spec). WHAT TURNS IT RED: the cutoffs not taken
  from the settings' days (or the two swapped); a value the job should not trust (not whole, outside 7..180, unhandled shorter than
  handled) deleting anything; the numbers not logged or a value in the log; a failing purge escaping the run.
*/
const NOW = new Date("2026-11-11T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function setup(over: Partial<AiChatSettings> = {}) {
  const purged: Array<{ handled: Date; unhandled: Date }> = [];
  const logged: string[] = [];
  const retention = new AiContactRequestsRetention(
    {
      purge: async (handled: Date, unhandled: Date) => {
        purged.push({ handled, unhandled });
        return { handled: 2, unhandled: 3 };
      },
    } as unknown as AiContactRequestsRepository,
    {
      settings: async () => ({ ...AI_CHAT_SETTINGS_DEFAULTS, ...over }),
    } as unknown as AiChatSettingsService,
  );
  (retention as unknown as { logger: object }).logger = {
    log: (line: string) => logged.push(line),
    warn: (line: string) => logged.push(line),
  };
  return { retention, purged, logged };
}

describe("AiContactRequestsRetention.sweep", () => {
  it("cuts the handled at its days and the unhandled at its days, from the settings (the approved defaults 30 and 90)", async () => {
    const w = setup();
    const result = await w.retention.sweep(NOW);
    assert.deepEqual(result, { ran: true, handled: 2, unhandled: 3 });
    assert.equal(w.purged[0]!.handled.getTime(), NOW.getTime() - 30 * DAY);
    assert.equal(w.purged[0]!.unhandled.getTime(), NOW.getTime() - 90 * DAY);
  });

  it("follows a changed setting, and does not swap the two", async () => {
    const w = setup({
      contactHandledRetentionDays: 7,
      contactUnhandledRetentionDays: 180,
    });
    await w.retention.sweep(NOW);
    assert.equal(w.purged[0]!.handled.getTime(), NOW.getTime() - 7 * DAY);
    assert.equal(w.purged[0]!.unhandled.getTime(), NOW.getTime() - 180 * DAY);
  });

  it("skips, deleting nothing, on a value it does not trust: not whole, outside 7..180, unhandled shorter than handled; nothing is clamped", async () => {
    const bad: Array<Partial<AiChatSettings>> = [
      { contactHandledRetentionDays: 6 },
      { contactHandledRetentionDays: 181, contactUnhandledRetentionDays: 181 },
      { contactUnhandledRetentionDays: 366 },
      { contactHandledRetentionDays: 0 },
      { contactHandledRetentionDays: -30 },
      { contactHandledRetentionDays: 30.5 },
      { contactHandledRetentionDays: Number.NaN },
      { contactHandledRetentionDays: "30" as unknown as number },
      { contactHandledRetentionDays: 60, contactUnhandledRetentionDays: 30 },
    ];
    for (const over of bad) {
      const w = setup(over);
      assert.deepEqual(
        await w.retention.sweep(NOW),
        { ran: false, reason: "invalid_days" },
        JSON.stringify(over),
      );
      assert.equal(w.purged.length, 0, JSON.stringify(over));
      assert.ok(
        w.logged.some((line) =>
          line.includes("contact_retention_skipped reason=invalid_days"),
        ),
      );
    }
  });

  it("accepts the limits themselves (7 and 180) and equal days", async () => {
    for (const over of [
      { contactHandledRetentionDays: 7, contactUnhandledRetentionDays: 7 },
      { contactHandledRetentionDays: 180, contactUnhandledRetentionDays: 180 },
    ]) {
      const w = setup(over);
      assert.equal((await w.retention.sweep(NOW)).ran, true);
    }
  });

  it("logs the days and the removed numbers, nothing else", async () => {
    const w = setup();
    await w.retention.sweep(NOW);
    assert.deepEqual(w.logged, [
      "contact_retention handledDays=30 unhandledDays=90 removedHandled=2 removedUnhandled=3",
    ]);
  });

  it("a failing purge rejects the sweep (the timer's catch logs the name only), and a timer is never left running after destroy", async () => {
    const retention = new AiContactRequestsRetention(
      {
        purge: async () => {
          throw new Error("boom");
        },
      } as unknown as AiContactRequestsRepository,
      {
        settings: async () => AI_CHAT_SETTINGS_DEFAULTS,
      } as unknown as AiChatSettingsService,
    );
    await assert.rejects(retention.sweep(NOW), /boom/);
    retention.onModuleInit();
    retention.onModuleDestroy();
    assert.equal((retention as unknown as { timer: unknown }).timer, null);
    assert.equal((retention as unknown as { first: unknown }).first, null);
  });
});
