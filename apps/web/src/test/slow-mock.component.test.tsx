import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answered } from "./answered";
import { SLOW_MOCK_MS } from "./slow-mock-ms";

/**
 * THE GUARD OVER THE LATE MOCK ANSWER (src/test/setup.ts, card e91dc528). Without it a broken setup, a renamed `vi`
 * method or a vitest upgrade that rebuilds `vi.fn` would quietly bring the instant answer back, and every test would stay
 * green while the flaky shape came back unseen.
 */
const off = SLOW_MOCK_MS === 0;

function SaveButton({ save }: { save: () => Promise<unknown> }) {
  const [running, setRunning] = useState(false);
  return (
    <button
      disabled={running}
      onClick={async () => {
        setRunning(true);
        try {
          await save();
        } finally {
          setRunning(false);
        }
      }}
    >
      Mentés
    </button>
  );
}

/**
 * Many microtask turns and NO macrotask: an instant answer settles within them, a timer-held one cannot (a timer never
 * fires between microtasks). The earlier `setTimeout(0)` tick and Testing Library's `waitFor` both raced the delay's
 * own timer, and on a loaded CI runner the delay lost (#2552, two of three runs red; reproduced locally under CPU
 * load, 3 of 4 runs).
 */
const microtasks = async () => {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve();
};

describe.skipIf(off)("a mockolt válasz késve érkezik", () => {
  afterEach(() => vi.useRealTimers());

  it("a resolved, a rejected and a spied answer all wait past the microtasks", async () => {
    const settled: string[] = [];
    const ok = vi.fn().mockResolvedValue("ok");
    const once = vi.fn().mockResolvedValueOnce("once");
    const fails = vi.fn().mockRejectedValue(new Error("nem"));
    const target = { read: async () => "valódi" };
    const spied = vi.spyOn(target, "read").mockResolvedValue("kém");
    void ok().then(() => settled.push("ok"));
    void once().then(() => settled.push("once"));
    void fails().catch(() => settled.push("fails"));
    void spied().then(() => settled.push("spied"));
    await microtasks();
    expect(settled).toEqual([]);
    await vi.waitFor(() =>
      expect(settled.sort()).toEqual(["fails", "ok", "once", "spied"]),
    );
  });

  /**
   * THE SHAPE ITSELF: once the CALL is made the button stays disabled, so a second click at that moment is lost, and
   * only waiting for the ANSWER gives the second call. The checks before `answered` run with no macrotask in between
   * (not inside `act`: React 19's async act always ends with a setImmediate, which a loaded runner can let the delay's
   * timer overtake, barracuda on #2553), so they cannot race the delay. That also means this test does NOT go red with
   * the delay switched off (the instant answer's render waits outside act); the calibration is the test above, which
   * goes red at the empty list.
   */
  it("waiting for the call is not waiting for the answer", async () => {
    const save = vi.fn().mockResolvedValue("ok");
    render(<SaveButton save={save} />);
    const button = screen.getByText("Mentés");
    fireEvent.click(button);
    await microtasks();
    expect(save).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(save).toHaveBeenCalledTimes(1);

    await answered(save);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it("under fake timers the answer is not held back (the test drives the time)", async () => {
    vi.useFakeTimers();
    const settled: string[] = [];
    const ok = vi.fn().mockResolvedValue("ok");
    void ok().then(() => settled.push("ok"));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toEqual(["ok"]);
  });
});
