import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NavigationHistoryProvider,
  useListHref,
  useReturnTo,
} from "./navigation-history";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: "/partnerek",
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
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

/** A breadcrumb link to a list, the way the service-job detail has one. */
function ListCrumb() {
  const href = useListHref("/szerviz/hibajegyek");
  return <a href={href}>Hibajegyek</a>;
}

function renderAt(pathname: string, search = "") {
  navigation.pathname = pathname;
  navigation.search = search;
  return render(
    <NavigationHistoryProvider>
      <BackButton />
      <ListCrumb />
    </NavigationHistoryProvider>,
  );
}

beforeEach(() => {
  navigation.push.mockReset();
  navigation.pathname = "/partnerek";
  navigation.search = "";
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

  /*
    BALÁZS KÉRÉSE (2026-09-30 12:29 UTC): a szűrt listáról az adatlapra,
    majd vissza, a szűrés és az oldal maradjon meg. MI PIROSÍT: ha a nyom
    megint csak az útvonalat tartja (a "vissza" a szűretlen listára visz),
    vagy ha a lista szűrő-váltásai külön lapnak számítanak (akkor a "vissza"
    az adatlapról egy korábbi szűrésre, vagy magára a listára pattogna).
  */
  it("returns to the filtered list, with its query, after the filter changed on the list", () => {
    const { rerender } = renderAt("/szerviz/eszkozok", "status=INSTALLED");
    const again = () =>
      rerender(
        <NavigationHistoryProvider>
          <BackButton />
        </NavigationHistoryProvider>,
      );
    // a filter change and a page change on the same list
    navigation.search = "status=INSTALLED&page=3";
    again();

    navigation.pathname = "/szerviz/eszkozok/asset-7";
    navigation.search = "";
    again();

    const button = screen.getByRole("button", { name: "Vissza" });
    expect(button.getAttribute("data-href")).toBe(
      "/szerviz/eszkozok?status=INSTALLED&page=3",
    );
  });

  /*
    A MORZSA NEM AZ ELŐZŐ LAP: a hibajegyről a munkalapra, onnan vissza a
    hibajegyre, és a "Hibajegyek" link akkor is a szűrt listára visz.
    MI PIROSÍT: ha a morzsa fix útvonalra mutat, vagy ha az előző lapot adja.
  */
  it("points a list breadcrumb to the list's latest query, not to the previous page", () => {
    const { rerender } = renderAt(
      "/szerviz/hibajegyek",
      "tab=closed&partner=p1",
    );
    const at = (pathname: string, search = "") => {
      navigation.pathname = pathname;
      navigation.search = search;
      rerender(
        <NavigationHistoryProvider>
          <BackButton />
          <ListCrumb />
        </NavigationHistoryProvider>,
      );
    };
    at("/szerviz/hibajegyek/job-1");
    at("/szerviz/munkalapok/42");
    at("/szerviz/hibajegyek/job-2");

    expect(
      screen.getByRole("link", { name: "Hibajegyek" }).getAttribute("href"),
    ).toBe("/szerviz/hibajegyek?tab=closed&partner=p1");
  });

  it("points a list breadcrumb to the bare list when the list was never visited", () => {
    renderAt("/szerviz/hibajegyek/job-1");
    expect(
      screen.getByRole("link", { name: "Hibajegyek" }).getAttribute("href"),
    ).toBe("/szerviz/hibajegyek");
  });
});
