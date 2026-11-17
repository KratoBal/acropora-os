import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DRAIN_TICK_MS, startDrainTriggers } from "./drain-triggers";

/**
 * A SOR KIURITESENEK INDITOI (Balazs 2026-11-17: online lett, a sor csak az app ujranyitasa utan ment fel). MI PIROSIT:
 * online nincs kor eloterbe kerulesre vagy az idozitore; a hatterbe kerules is kort indit; offline indul valami; a
 * leallitas utan az idozito vagy a feliratkozas megmarad.
 */
function fakes() {
  let listener: ((state: string) => void) | null = null;
  const naplo: string[] = [];
  let tick: (() => void) | null = null;
  return {
    naplo,
    foreground: (state: string) => listener?.(state),
    tick: () => tick?.(),
    deps: {
      subscribeForeground: (l: (state: string) => void) => {
        listener = l;
        naplo.push("subscribe");
        return () => {
          listener = null;
          naplo.push("unsubscribe");
        };
      },
      setInterval: (run: () => void, ms: number) => {
        tick = run;
        naplo.push(`interval:${ms}`);
        return "h1";
      },
      clearInterval: (handle: unknown) => {
        tick = null;
        naplo.push(`clear:${String(handle)}`);
      },
    },
  };
}

describe("a kiürítés indítói", () => {
  it("online: egy kör előtérbe kerüléskor és az időzítőre, a háttérbe kerülés nem indít", () => {
    const f = fakes();
    let korok = 0;
    startDrainTriggers(true, () => (korok += 1), f.deps);
    assert.deepEqual(f.naplo, ["subscribe", `interval:${DRAIN_TICK_MS}`]);
    f.foreground("background");
    assert.equal(korok, 0);
    f.foreground("active");
    f.tick();
    assert.equal(korok, 2);
  });

  it("offline: semmi nem indul", () => {
    const f = fakes();
    let korok = 0;
    startDrainTriggers(false, () => (korok += 1), f.deps)();
    f.foreground("active");
    f.tick();
    assert.equal(korok, 0);
    assert.deepEqual(f.naplo, []);
  });

  it("a leállítás után nem marad sem időzítő, sem feliratkozás", () => {
    const f = fakes();
    let korok = 0;
    const stop = startDrainTriggers(true, () => (korok += 1), f.deps);
    stop();
    f.foreground("active");
    f.tick();
    assert.equal(korok, 0);
    assert.deepEqual(f.naplo, [
      "subscribe",
      `interval:${DRAIN_TICK_MS}`,
      "unsubscribe",
      "clear:h1",
    ]);
  });
});
