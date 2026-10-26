import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomepagePreview } from "./homepage-preview";
import { PREVIEW_MESSAGE } from "./homepage-preview-protocol";

/*
  THE PREVIEW FRAME POINTS AT THE TEST STOREFRONT: the test must not load it
  over the network. happy-dom's own switch, set for this file only.
*/
(
  window as unknown as {
    happyDOM?: {
      settings: { navigation: { disableChildFrameNavigation: boolean } };
    };
  }
).happyDOM!.settings.navigation.disableChildFrameNavigation = true;

/*
  THE PREVIEW FRAME, OS SIDE. What turns these red: content posted before the
  frame said "ready"; a "ready" from another origin, or from another window of
  the right origin, accepted; content posted with `*` instead of the
  storefront's origin; a click in the frame on an unknown block selecting
  anything; a silent frame left blank without a word.
*/
const ORIGIN = "https://teszt.invalid";
const record = { texts: {}, slides: null, blocks: null, footer: null };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const onSelect = vi.fn();
  render(
    <HomepagePreview
      storefrontUrl={ORIGIN}
      record={record}
      selected="hero"
      onSelect={onSelect}
    />,
  );
  const frame = screen.getByTitle(
    "A teszt kirakat kezdőlapjának élő előnézete",
  ) as HTMLIFrameElement;
  const win = frame.contentWindow as Window;
  const post = vi.spyOn(win, "postMessage").mockImplementation(() => {});
  const from = (data: unknown, origin = ORIGIN, source: unknown = win) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          origin,
          source: source as MessageEventSource,
        }),
      );
    });
  return { onSelect, post, from, win };
}

describe("HomepagePreview", () => {
  it("sends nothing until the frame of the storefront's origin says ready, then the content to that origin", () => {
    const { post, from } = setup();
    act(() => vi.advanceTimersByTime(1000));
    expect(post).not.toHaveBeenCalled();
    from({ type: PREVIEW_MESSAGE.ready, version: 1 }, "https://evil.example");
    from({ type: PREVIEW_MESSAGE.ready, version: 1 }, ORIGIN, window);
    act(() => vi.advanceTimersByTime(1000));
    expect(post).not.toHaveBeenCalled();
    from({ type: PREVIEW_MESSAGE.ready, version: 1 });
    act(() => vi.advanceTimersByTime(1000));
    expect(post).toHaveBeenCalledWith(
      { type: PREVIEW_MESSAGE.content, version: 1, record },
      ORIGIN,
    );
    expect(post).toHaveBeenCalledWith(
      { type: PREVIEW_MESSAGE.select, version: 1, block: "hero" },
      ORIGIN,
    );
    expect(
      post.mock.calls.every((call) => (call as unknown[])[1] === ORIGIN),
    ).toBe(true);
  });

  it("a click in the frame selects a known block only", () => {
    const { onSelect, from } = setup();
    from({ type: PREVIEW_MESSAGE.selected, version: 1, block: "markak" });
    from({ type: PREVIEW_MESSAGE.selected, version: 1, block: "sajat-1" });
    from(
      { type: PREVIEW_MESSAGE.selected, version: 1, block: "boltunk" },
      "https://evil.example",
    );
    expect(onSelect.mock.calls).toEqual([["markak"]]);
  });

  it("a frame that never answers is named, not left blank", () => {
    setup();
    act(() => vi.advanceTimersByTime(8000));
    expect(
      screen.getByText("A teszt kirakat előnézeti oldala nem válaszol."),
    ).toBeTruthy();
  });
});
