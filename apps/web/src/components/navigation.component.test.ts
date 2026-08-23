import { describe, expect, it } from "vitest";

import {
  businessNavigation,
  isNavigationGroup,
  isNavigationItemActive,
  navigationItems,
  type AppNavigationGroup,
  type AppNavigationItem,
} from "./navigation";

function group(label: string): AppNavigationGroup {
  const found = businessNavigation.find(
    (entry) => isNavigationGroup(entry) && entry.label === label,
  );
  if (!found || !isNavigationGroup(found))
    throw new Error(`nincs "${label}" nevű menücsoport`);
  return found;
}

describe("navigation", () => {
  /**
   * The screen at /vevok holds webshop buyers, and the partners we work for
   * live under /partnerek. The menu is where that distinction is first made,
   * so it has to name them apart.
   *
   * Asserted here rather than only on the page, because the two are separate
   * strings in separate files: renaming the page heading and leaving the menu
   * saying "Vevők" is the half-finished state, and nothing else would report
   * it. The page's own heading is asserted in its own spec.
   */
  it("calls the webshop buyers what they are, apart from the partners", () => {
    const labels = new Map(
      navigationItems(businessNavigation).map((item) => [
        item.href,
        item.label,
      ]),
    );

    expect(labels.get("/vevok")).toBe("Webshop vásárlók");
    expect(labels.get("/partnerek")).toBe("Partnerek");
  });

  it("puts the orders and the buyers under one Webshop heading", () => {
    expect(
      group("Webshop").children.map((item) => [item.href, item.label]),
    ).toEqual([
      ["/webshop", "Megrendelések"],
      ["/vevok", "Webshop vásárlók"],
    ]);
  });

  it("gathers purchasing, the NAV invoices and the Foxpost settlement under Pénzügy", () => {
    expect(group("Pénzügy").children.map((item) => item.href)).toEqual([
      "/beszerzes",
      "/beszerzes/nav-szamlak",
      "/penzugy/foxpost",
    ]);
  });

  /**
   * /penzugy is not a page of its own: the route falls through to the shared
   * "modul előkészítve" placeholder. It was a menu entry before this heading
   * existed; keeping it would put a heading and a link with the same name next
   * to each other, one of which leads nowhere.
   */
  it("no longer offers the placeholder route as a destination", () => {
    expect(
      navigationItems(businessNavigation).map((item) => item.href),
    ).not.toContain("/penzugy");
  });

  /**
   * A heading carries no permission of its own, so anything that reads this
   * list as "the pages" has to open the groups out first. The user editor's
   * permission preview is the caller that would otherwise go quiet: it would
   * simply stop listing the pages that moved under a heading.
   */
  /**
   * Two entries can both sit above the same path. The specific one owns it,
   * and the outer one has to stay dark - otherwise two entries in the same
   * group look equally current, and the reader cannot tell which screen they
   * are on.
   *
   * The pages under an entry still belong to it: a single purchase order is
   * purchasing, and a single webshop order is the order list. That half is
   * asserted too, because the obvious fix for the first half - marking the
   * entry `exact` - would silently break it.
   */
  describe("active entry", () => {
    const items = navigationItems(businessNavigation);
    const item = (href: string): AppNavigationItem => {
      const found = items.find((entry) => entry.href === href);
      if (!found) throw new Error(`nincs "${href}" menüpont`);
      return found;
    };
    const active = (pathname: string, href: string) =>
      isNavigationItemActive(pathname, item(href), items);

    it("gives a nested page to the entry that owns it, not to the one above", () => {
      expect(active("/beszerzes/nav-szamlak", "/beszerzes/nav-szamlak")).toBe(
        true,
      );
      expect(active("/beszerzes/nav-szamlak", "/beszerzes")).toBe(false);
      expect(active("/beszerzes/nav-szamlak/42", "/beszerzes")).toBe(false);
    });

    it("keeps a detail page with its own list", () => {
      expect(active("/beszerzes/uj", "/beszerzes")).toBe(true);
      expect(active("/webshop/order-42", "/webshop")).toBe(true);
      expect(active("/vevok/uj", "/vevok")).toBe(true);
    });

    /**
     * The webshop product list is added by a separate branch. The rule is
     * asserted here on its own, so this branch already carries the behaviour
     * the page will need, and does not wait on it.
     */
    it("will hand /webshop/termekek to the products entry once it exists", () => {
      const products: AppNavigationItem = {
        href: "/webshop/termekek",
        label: "Webshop termékek",
        icon: "package",
        permission: item("/webshop").permission,
      };
      const withProducts = [...items, products];

      expect(
        isNavigationItemActive("/webshop/termekek", products, withProducts),
      ).toBe(true);
      expect(
        isNavigationItemActive(
          "/webshop/termekek",
          item("/webshop"),
          withProducts,
        ),
      ).toBe(false);
    });
  });

  it("opens groups out into their pages, each with a permission", () => {
    const items = navigationItems(businessNavigation);

    expect(items.map((item) => item.href)).toContain("/szerviz/munkalapok");
    for (const item of items) {
      expect(item.permission).toBeTruthy();
      expect(item.href.startsWith("/")).toBe(true);
    }
  });
});
