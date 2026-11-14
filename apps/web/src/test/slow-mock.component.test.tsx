import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answered } from "./answered";

/**
 * THE GUARD OVER THE LATE MOCK ANSWER (src/test/setup.ts, card e91dc528). Without it a broken setup, a renamed `vi`
 * method or a vitest upgrade that rebuilds `vi.fn` would quietly bring the instant answer back, and every test would stay
 * green while the flaky shape came back unseen.
 */
const off = process.env.LASSU_MOCK === "0";

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

const tick = () => new Promise((done) => setTimeout(done, 0));

describe.skipIf(off)("a mockolt válasz késve érkezik", () => {
  afterEach(() => vi.useRealTimers());

  it("a resolved, a rejected and a spied answer all wait past a tick", async () => {
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
    await tick();
    expect(settled).toEqual([]);
    await vi.waitFor(() =>
      expect(settled.sort()).toEqual(["fails", "ok", "once", "spied"]),
    );
  });

  /**
   * THE SHAPE ITSELF, as the positive control: waiting for the CALL leaves the button disabled, so a second click at that
   * moment is lost, and only waiting for the ANSWER gives the second call. With the instant answer the button is enabled
   * again by the time the waitFor returns (calibrated 2026-11-14 with the delay switched off: this test and the one above
   * went red, at `toBeDisabled` and at the empty list).
   */
  it("waiting for the call is not waiting for the answer", async () => {
    const save = vi.fn().mockResolvedValue("ok");
    render(<SaveButton save={save} />);
    const button = screen.getByText("Mentés");
    fireEvent.click(button);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
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
