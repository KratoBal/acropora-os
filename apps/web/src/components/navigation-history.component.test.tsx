import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NavigationHistoryProvider,
  useListHref,
  useReturnTo,
  useStepTo,
} from "./navigation-history";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  pathname: "/partnerek",
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
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

/** The detail page's Előző/Következő, reduced to one button. */
function StepButton({ to }: { to: string }) {
  const step = useStepTo();
  return (
    <button type="button" onClick={() => step(to)}>
      Következő
    </button>
  );
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

  /*
    AZ ELŐZŐ/KÖVETKEZŐ TESTVÉR-LÉPÉS: három lépés után a "Vissza" a szűrt
    listára visz, nem a korábbi eszközre. MI PIROSÍT: ha a lépés rendes
    navigációként kerül a nyomba (a "Vissza" az előző eszköz lesz), vagy ha a
    lépés-jelölés egy MÁSIK útra érkező navigációt is elnyel.
  */
  it("a sibling step replaces the detail in the trail, so back still goes to the list", () => {
    const tree = (to: string) => (
      <NavigationHistoryProvider>
        <BackButton />
        <StepButton to={to} />
      </NavigationHistoryProvider>
    );
    navigation.pathname = "/szerviz/eszkozok";
    navigation.search = "status=ALL&page=2";
    const { rerender } = render(tree("/szerviz/eszkozok/a2"));
    const at = (pathname: string, to: string) => {
      navigation.pathname = pathname;
      navigation.search = "";
      rerender(tree(to));
    };
    at("/szerviz/eszkozok/a1", "/szerviz/eszkozok/a2");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));
    expect(navigation.replace).toHaveBeenCalledWith("/szerviz/eszkozok/a2");
    at("/szerviz/eszkozok/a2", "/szerviz/eszkozok/a3");
    fireEvent.click(screen.getByRole("button", { name: "Következő" }));
    at("/szerviz/eszkozok/a3", "/szerviz/eszkozok/a4");

    expect(
      screen.getByRole("button", { name: "Vissza" }).getAttribute("data-href"),
    ).toBe("/szerviz/eszkozok?status=ALL&page=2");
  });

  it("a step marked for one page does not swallow a navigation elsewhere", () => {
    const tree = () => (
      <NavigationHistoryProvider>
        <BackButton />
        <StepButton to="/szerviz/eszkozok/a2" />
      </NavigationHistoryProvider>
    );
    navigation.pathname = "/szerviz/eszkozok";
    const { rerender } = render(tree());
    navigation.pathname = "/szerviz/eszkozok/a1";
    rerender(tree());

    // the step is marked, but the reader goes to a worksheet instead
    fireEvent.click(screen.getByRole("button", { name: "Következő" }));
    navigation.pathname = "/szerviz/munkalapok/42";
    rerender(tree());

    expect(
      screen.getByRole("button", { name: "Vissza" }).getAttribute("data-href"),
    ).toBe("/szerviz/eszkozok/a1");
  });
});
