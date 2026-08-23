import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationHistoryProvider, useReturnTo } from "./navigation-history";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: "/partnerek",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
}));

/** A screen that offers a way back, the way the editor pages do. */
function BackButton() {
  const back = useReturnTo("/partnerek");
  return (
    <button type="button" data-href={back.href} onClick={back.goBack}>
      {back.fromWithinApp ? "Vissza" : "Vissza a listához"}
    </button>
  );
}

function renderAt(pathname: string) {
  navigation.pathname = pathname;
  return render(
    <NavigationHistoryProvider>
      <BackButton />
    </NavigationHistoryProvider>,
  );
}

beforeEach(() => {
  navigation.push.mockReset();
  navigation.pathname = "/partnerek";
});

describe("navigation history", () => {
  /**
   * Opening a record straight from a link or a bookmark: there is no page to
   * go back to, so the screen keeps the destination it always had, and says
   * so on the button.
   */
  it("falls back to the caller's own target on the first screen", () => {
    renderAt("/partnerek/1");

    const button = screen.getByRole("button", { name: "Vissza a listához" });
    expect(button.getAttribute("data-href")).toBe("/partnerek");

    fireEvent.click(button);
    expect(navigation.push).toHaveBeenCalledWith("/partnerek");
  });

  /**
   * The case the fixed link gets wrong: a partner can be opened from a
   * worksheet, and from there the partner list is not "back" but a third
   * place.
   */
  it("returns to the page the reader actually came from", () => {
    const { rerender } = renderAt("/szerviz/munkalapok/42");

    navigation.pathname = "/partnerek/1";
    rerender(
      <NavigationHistoryProvider>
        <BackButton />
      </NavigationHistoryProvider>,
    );

    const button = screen.getByRole("button", { name: "Vissza" });
    expect(button.getAttribute("data-href")).toBe("/szerviz/munkalapok/42");

    fireEvent.click(button);
    expect(navigation.push).toHaveBeenCalledWith("/szerviz/munkalapok/42");
  });
});
