import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { watchForegroundLock } from "./foreground-watcher";

const THRESHOLD = 900_000;

interface Harness {
  emit(state: string): void;
  locks: number;
  clock: { value: number };
  unsubscribed: boolean;
  stop(): void;
}

function harness(thresholdMs = THRESHOLD): Harness {
  let listener: ((state: string) => void) | null = null;
  const clock = { value: 1_700_000_000_000 };
  const result = {
    clock,
    locks: 0,
    unsubscribed: false,
    emit(state: string) {
      assert.ok(listener, "nothing subscribed");
      listener(state);
    },
    stop: () => undefined as void,
  };

  result.stop = watchForegroundLock({
    subscribe(next) {
      listener = next;
      return () => {
        result.unsubscribed = true;
        listener = null;
      };
    },
    now: () => clock.value,
    thresholdMs,
    onLock: () => {
      result.locks += 1;
    },
  });

  return result;
}

describe("watchForegroundLock", () => {
  it("lets a short absence back in silently", () => {
    const h = harness();
    h.emit("background");
    h.clock.value += 60_000;
    h.emit("active");
    assert.equal(h.locks, 0);
  });

  it("closes the gate after a long absence", () => {
    const h = harness();
    h.emit("background");
    h.clock.value += THRESHOLD;
    h.emit("active");
    assert.equal(h.locks, 1);
  });

  it("stays quiet on a foreground event it never saw leave", () => {
    // A cold start: restoreSession has already asked, and asking again
    // here would be two prompts for one launch.
    const h = harness();
    h.emit("active");
    assert.equal(h.locks, 0);
  });

  it("ignores the transitional state the system's own prompt passes through", () => {
    const h = harness();
    h.emit("background");
    h.clock.value += THRESHOLD;
    h.emit("inactive");
    assert.equal(h.locks, 0, "inactive is not a return to the foreground");
    h.emit("active");
    assert.equal(h.locks, 1);
  });

  it("times the absence from when the app left, not from a repeated event", () => {
    const h = harness();
    h.emit("background");
    h.clock.value += THRESHOLD - 1_000;
    h.emit("background");
    h.clock.value += 2_000;
    h.emit("active");
    assert.equal(h.locks, 1);
  });

  it("asks once per absence, not once per foreground event", () => {
    const h = harness();
    h.emit("background");
    h.clock.value += THRESHOLD;
    h.emit("active");
    h.emit("active");
    assert.equal(h.locks, 1);
  });

  it("measures each absence on its own", () => {
    const h = harness();
    h.emit("background");
    h.clock.value += THRESHOLD;
    h.emit("active");
    h.emit("background");
    h.clock.value += 10_000;
    h.emit("active");
    assert.equal(h.locks, 1, "the second absence was short");
  });

  it("locks when the clock moved backwards while the app was away", () => {
    const h = harness();
    h.emit("background");
    h.clock.value -= 60_000;
    h.emit("active");
    assert.equal(h.locks, 1);
  });

  it("stops watching when told to", () => {
    const h = harness();
    h.stop();
    assert.equal(h.unsubscribed, true);
  });
});
