import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANSWER_LINGER_MS,
  TYPING_PAUSE_MS,
  useSutyerakActivity,
} from "./use-sutyerak-activity";

/*
  SUTYERÁK ÁLLAPOTA (kártya e0780477, Balázs promptja). MI PIROSÍT: a
  jegyzetelés nem áll le 1200 ms után vagy blurkor; a gépelés felülírja a
  keresést vagy a választ; egy üres szöveg-esemény már válasznak számít; hiba
  vagy megszakítás után sikeres találat látszik; egy régi kérés eseménye vagy
  időzítője felülírja az újat; az unmount után időzítő marad.
*/
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = () => renderHook(() => useSutyerakActivity());

describe("useSutyerakActivity", () => {
  it("typing takes notes, and stops 1200 ms after the last input; each input restarts the pause", () => {
    const { result } = setup();
    expect(result.current.figure).toBe("resting");
    act(() => result.current.typed());
    expect(result.current.figure).toBe("takingNotes");
    act(() => vi.advanceTimersByTime(TYPING_PAUSE_MS - 1));
    act(() => result.current.typed());
    act(() => vi.advanceTimersByTime(TYPING_PAUSE_MS - 1));
    expect(result.current.figure).toBe("takingNotes");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.figure).toBe("resting");
  });

  it("blur stops note taking at once, and its timer is gone", () => {
    const { result } = setup();
    act(() => result.current.typed());
    act(() => result.current.blurred());
    expect(result.current.figure).toBe("resting");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a request searches until the first non-empty text, then answers; typing meanwhile changes nothing", () => {
    const { result } = setup();
    act(() => result.current.typed());
    let id = 0;
    act(() => {
      id = result.current.began();
    });
    expect(result.current.figure).toBe("searching");
    act(() => result.current.typed());
    act(() => vi.advanceTimersByTime(TYPING_PAUSE_MS * 2));
    expect(result.current.figure).toBe("searching");
    act(() => result.current.text(id, "  "));
    expect(result.current.figure).toBe("searching");
    act(() => result.current.text(id, "Folyamatban"));
    expect(result.current.figure).toBe("answering");
    act(() => result.current.typed());
    expect(result.current.figure).toBe("answering");
  });

  it("a non-empty answer keeps answering for 4 s, then rests; an empty one rests at once", () => {
    const { result } = setup();
    let id = 0;
    act(() => {
      id = result.current.began();
    });
    act(() => result.current.finished(id, "**Kész**"));
    act(() => vi.advanceTimersByTime(ANSWER_LINGER_MS - 1));
    expect(result.current.figure).toBe("answering");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.figure).toBe("resting");

    act(() => {
      id = result.current.began();
    });
    act(() => result.current.finished(id, " "));
    expect(result.current.figure).toBe("resting");
  });

  it("an error is stuck, never a false find, even after some text", () => {
    const { result } = setup();
    let id = 0;
    act(() => {
      id = result.current.began();
    });
    act(() => result.current.text(id, "Rész"));
    act(() => result.current.failed(id));
    expect(result.current.figure).toBe("stuck");
    act(() => vi.advanceTimersByTime(ANSWER_LINGER_MS * 2));
    expect(result.current.figure).toBe("stuck");
  });

  it("an aborted request's late events and an old request's timer cannot overwrite the new state", () => {
    const { result } = setup();
    let old = 0;
    act(() => {
      old = result.current.began();
    });
    act(() => result.current.reset());
    act(() => result.current.text(old, "késő"));
    act(() => result.current.finished(old, "késő válasz"));
    act(() => result.current.failed(old));
    expect(result.current.figure).toBe("resting");

    // a finished request's 4 s linger must not end the next request's search
    let first = 0;
    act(() => {
      first = result.current.began();
    });
    act(() => result.current.finished(first, "első válasz"));
    act(() => {
      result.current.began();
    });
    act(() => vi.advanceTimersByTime(ANSWER_LINGER_MS * 2));
    expect(result.current.figure).toBe("searching");
  });

  it("unmount leaves no timer behind", () => {
    const { result, unmount } = setup();
    let id = 0;
    act(() => result.current.typed());
    act(() => {
      id = result.current.began();
    });
    act(() => result.current.finished(id, "válasz"));
    act(() => result.current.typed());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
