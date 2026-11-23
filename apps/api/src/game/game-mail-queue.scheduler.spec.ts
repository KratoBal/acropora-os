import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GameMailQueueScheduler,
  gameMailQueueAuto,
} from "./game-mail-queue.scheduler.js";

/*
  THE SCHEDULED MAIL QUEUE DRAIN (card 31445d0f). WHAT TURNS THIS RED: the switch defaulting to off, or "off" not stopping it;
  a send when nothing waits; the send not being the shared one (`sendQueued`, without a user); an error escaping the run, or
  its message (it can quote an address) reaching the log.
*/

const scheduler = (admin: Record<string, unknown>) => {
  const s = new GameMailQueueScheduler(admin as never);
  const logged: string[] = [];
  (s as unknown as { logger: unknown }).logger = {
    log: (m: string) => logged.push(m),
    error: (m: string) => logged.push(m),
  };
  return { s, logged };
};

describe("the giveaway's mail queue drain", () => {
  it("is on by default; only 'off' stops it", () => {
    assert.deepEqual(
      [
        gameMailQueueAuto({}),
        gameMailQueueAuto({ JATEK_MAIL_QUEUE_AUTO: "on" }),
        gameMailQueueAuto({ JATEK_MAIL_QUEUE_AUTO: " OFF " }),
      ],
      [true, true, false],
    );
  });

  it("does nothing when nothing waits", async () => {
    let sends = 0;
    const { s } = scheduler({
      mailQueue: async () => ({ pending: 0 }),
      sendQueued: async () => {
        sends++;
        return {};
      },
    });
    assert.equal(await s.runOnce(), "IDLE");
    assert.equal(sends, 0);
  });

  it("sends the waiting mails through the shared send, without a user, and logs counts only", async () => {
    const users: unknown[] = [];
    const { s, logged } = scheduler({
      mailQueue: async () => ({ pending: 3 }),
      sendQueued: async (userId: unknown) => {
        users.push(userId);
        return {
          sent: 2,
          busy: false,
          pending: 1,
          sentToday: 3000,
          dailyCap: 3000,
        };
      },
    });
    assert.equal(await s.runOnce(), "SENT");
    assert.deepEqual(users, [null]);
    assert.deepEqual(logged, [
      "Game mail queue: 2 sent, 1 still waiting (today 3000/3000)",
    ]);
  });

  it("a busy send (the admin button) is no failure; an error is logged by kind and code, never its message", async () => {
    const busy = scheduler({
      mailQueue: async () => ({ pending: 1 }),
      sendQueued: async () => ({ sent: 0, busy: true }),
    });
    assert.equal(await busy.s.runOnce(), "BUSY");
    const failing = scheduler({
      mailQueue: async () => ({ pending: 1 }),
      sendQueued: async () => {
        throw Object.assign(new Error("rejected a@x.hu"), { code: "EAUTH" });
      },
    });
    assert.equal(await failing.s.runOnce(), "FAILED");
    assert.deepEqual(failing.logged, [
      "Game mail queue drain failed: Error EAUTH",
    ]);
  });
});
