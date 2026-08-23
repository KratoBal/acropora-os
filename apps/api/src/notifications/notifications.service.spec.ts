import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ApnsMessage, ApnsResult } from "./apns.client.js";
import type { ApnsSender } from "./apns.sender.js";
import type { DeviceTokenRepository } from "./device-token.repository.js";
import type {
  NotificationLogRepository,
  NotificationOutcome,
} from "./notification-log.repository.js";
import { NotificationsService } from "./notifications.service.js";

function sender(
  answer: (message: ApnsMessage) => ApnsResult = () => ({ ok: true }),
  configured = true,
) {
  const sent: ApnsMessage[] = [];
  const value = {
    configured: () => configured,
    send: async (message: ApnsMessage) => {
      sent.push(message);
      return answer(message);
    },
  } as unknown as ApnsSender;
  return { sender: value, sent };
}

function log() {
  const written: NotificationOutcome[] = [];
  const value = {
    recordWorksheetAssignment: async (outcome: NotificationOutcome) => {
      written.push(outcome);
    },
  } as unknown as NotificationLogRepository;
  return { log: value, written };
}

function tokens(
  rows: Array<{ userId: string; token: string; bundleId: string }>,
  onRetire?: (token: string) => void,
) {
  return {
    recipients: async () => rows,
    retire: async (token: string) => {
      onRetire?.(token);
      return { count: 1 };
    },
  } as unknown as DeviceTokenRepository;
}

const notice = {
  worksheetId: "worksheet-1",
  subject: "Szivattyú csere",
  userIds: ["user-2"],
};

describe("worksheet assignment notifications", () => {
  it("sends one notification per device, naming the sheet", async () => {
    const { sender: apns, sent } = sender();
    const service = new NotificationsService(
      tokens([
        {
          userId: "user-2",
          token: "aa".repeat(32),
          bundleId: "hu.acropora.os",
        },
        {
          userId: "user-2",
          token: "bb".repeat(32),
          bundleId: "hu.acropora.os.dev",
        },
      ]),
      apns,
      log().log,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.equal(summary.sent, 2);
    assert.equal(sent[0]?.body, "Szivattyú csere");
    assert.equal(sent[0]?.data?.worksheetId, "worksheet-1");
    // The topic follows the device, not a default: three app variants exist,
    // and Apple refuses a token sent under the wrong one.
    assert.deepEqual(
      sent.map((message) => message.bundleId),
      ["hu.acropora.os", "hu.acropora.os.dev"],
    );
  });

  /**
   * Apple saying the device is gone is the only answer that justifies
   * forgetting a token. Keeping it would mean sending into nothing on every
   * assignment from here on, and the failure would read as a delivery problem
   * rather than a phone that no longer exists.
   */
  it("forgets a token Apple has retired", async () => {
    const retired: string[] = [];
    const { sender: apns } = sender(() => ({
      ok: false,
      retired: true,
      reason: "BadDeviceToken",
    }));
    const service = new NotificationsService(
      tokens(
        [
          {
            userId: "user-2",
            token: "cc".repeat(32),
            bundleId: "hu.acropora.os",
          },
        ],
        (token) => retired.push(token),
      ),
      apns,
      log().log,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.equal(summary.retired, 1);
    assert.deepEqual(retired, ["cc".repeat(32)]);
  });

  /**
   * A timeout is not a dead device. Throwing the token away on any failure
   * would quietly unsubscribe a working phone the first time the network
   * hiccuped, and nobody would notice until an assignment went unanswered.
   */
  it("keeps a token when the failure might pass", async () => {
    const retired: string[] = [];
    const { sender: apns } = sender(() => ({
      ok: false,
      retired: false,
      reason: "timeout",
    }));
    const service = new NotificationsService(
      tokens(
        [
          {
            userId: "user-2",
            token: "dd".repeat(32),
            bundleId: "hu.acropora.os",
          },
        ],
        (token) => retired.push(token),
      ),
      apns,
      log().log,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.equal(summary.failed, 1);
    assert.deepEqual(retired, []);
  });

  it("does nothing at all when this deployment cannot send", async () => {
    const { sender: apns, sent } = sender(() => ({ ok: true }), false);
    const service = new NotificationsService(
      tokens([
        {
          userId: "user-2",
          token: "ee".repeat(32),
          bundleId: "hu.acropora.os",
        },
      ]),
      apns,
      log().log,
    );

    const summary = await service.deliverWorksheetAssignment(notice);

    assert.deepEqual(summary, { sent: 0, retired: 0, failed: 0 });
    assert.deepEqual(sent, []);
  });

  it("stays quiet when nobody was added", async () => {
    const { sender: apns, sent } = sender();
    const service = new NotificationsService(tokens([]), apns, log().log);

    await service.deliverWorksheetAssignment({ ...notice, userIds: [] });

    assert.deepEqual(sent, []);
  });

  /**
   * A log line answers the question while somebody is watching the process.
   * This is for the question asked a day later - "was the technician told?" -
   * which a rotated log file cannot answer.
   *
   * The colleague is named, the device never is: a token is a credential for
   * reaching somebody's phone, and an event row is read by more people than
   * the device table is.
   */
  it("writes down who was reached and who was not, naming people and not devices", async () => {
    const written = log();
    const { sender: apns } = sender((message) =>
      message.bundleId === "hu.acropora.os"
        ? { ok: true }
        : { ok: false, retired: true, reason: "BadDeviceToken" },
    );
    const service = new NotificationsService(
      tokens([
        {
          userId: "user-2",
          token: "aa".repeat(32),
          bundleId: "hu.acropora.os",
        },
        {
          userId: "user-3",
          token: "bb".repeat(32),
          bundleId: "hu.acropora.os.dev",
        },
      ]),
      apns,
      written.log,
    );

    await service.deliverWorksheetAssignment(notice);

    assert.equal(written.written.length, 1);
    const outcome = written.written[0]!;
    assert.equal(outcome.worksheetId, "worksheet-1");
    assert.deepEqual(
      outcome.attempts.map((attempt) => [attempt.userId, attempt.delivered]),
      [
        ["user-2", true],
        ["user-3", false],
      ],
    );
    assert.equal(outcome.attempts[1]?.reason, "BadDeviceToken");
    assert.equal(
      JSON.stringify(outcome).includes("aa".repeat(32)),
      false,
      "a device token must never reach the event log",
    );
  });
});
