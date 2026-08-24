import { describe, expect, it } from "vitest";

import {
  businessNavigation,
  isNavigationGroup,
  isNavigationItemActive,
  navigationItems,
  primaryNavigation,
  secondaryNavigation,
  settingsNavigation,
  unasSettingsNavigation,
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

  it("puts the orders, the buyers and the shop's products under one Webshop heading", () => {
    expect(
      group("Webshop").children.map((item) => [item.href, item.label]),
    ).toEqual([
      ["/webshop", "Megrendelések"],
      ["/vevok", "Webshop vásárlók"],
      ["/webshop/termekek", "Webshop termékek"],
    ]);
  });

  /**
   * Two entries, two catalogues. /products is the full internal one with the
   * barcode editor; the webshop entry is the shop's own narrowed view. They
   * are separate destinations and neither replaces the other.
   */
  it("keeps the full catalogue where it was", () => {
    const labels = new Map(
      navigationItems(businessNavigation).map((item) => [
        item.href,
        item.label,
      ]),
    );

    expect(labels.get("/products")).toBe("Termékek");
    expect(labels.get("/webshop/termekek")).toBe("Webshop termékek");
  });

  /**
   * A Pénzügy csoport tartalma SZÁNDÉKOSAN változott: a leltár és a
   * készlet-egyeztetés a felső szintről KÖLTÖZÖTT ide.
   *
   * A régi állítás három gyereket rögzített (beszerzés, NAV számlák, Foxpost),
   * és a költözéskor jogosan bukott el. Az új ötöt rögzít, a beköltözőkkel a
   * végén, tehát a meglévő három sorrendje nem mozdult.
   */
  it("gathers purchasing, the NAV invoices, the Foxpost settlement and the two stock pages under Pénzügy", () => {
    expect(group("Pénzügy").children.map((item) => item.href)).toEqual([
      "/beszerzes",
      "/beszerzes/nav-szamlak",
      "/penzugy/foxpost",
      "/raktar",
      "/keszlet-egyeztetes",
    ]);
  });

  /**
   * A Működés blokk FELSŐ SZINTŰ sorrendjét eddig semmi nem állította.
   *
   * Ez nem elméleti hiány volt: a POS és a Webshop helycseréje enélkül
   * méretlen maradt volna, és a változás után sem lett volna semmi, ami az új
   * sorrendet tartja - bármelyik későbbi szerkesztés csendben visszafordíthatta
   * volna. A csoportok a fejlécük nevén szerepelnek, mert a menüben is az
   * látszik.
   */
  it("keeps the operations block in the order it is meant to be read", () => {
    expect(
      businessNavigation.map((entry) =>
        isNavigationGroup(entry) ? entry.label : entry.label,
      ),
    ).toEqual([
      "POS",
      "Webshop",
      "Termékek",
      "Partnerek",
      "Pénzügy",
      "Akváriumok",
      "ICP",
      "Szerviz",
    ]);
  });

  /**
   * Egy oldal pontosan EGYSZER szerepelhet a menüben.
   *
   * E nélkül a "költözés" és a "másolás" megkülönböztethetetlen: aki a leltárt
   * beteszi a Pénzügy alá, de fentről elfelejti kivenni, két helyen kapja meg
   * ugyanazt az oldalt, és a csoport tartalmát állító teszt ettől még zöld
   * marad. A számot nem soroljuk fel: az útvonalakat számoljuk, és a duplikátum
   * NEVÉT írjuk ki, mert egy szám önmagában nem mondja meg, melyik.
   */
  it("shows every page in exactly one place", () => {
    const hrefs = [
      ...primaryNavigation,
      ...navigationItems(businessNavigation),
      ...secondaryNavigation,
      ...settingsNavigation,
      ...unasSettingsNavigation,
    ].map((item) => item.href);

    const seen = new Set<string>();
    const duplicates = hrefs.filter((href) => {
      if (seen.has(href)) return true;
      seen.add(href);
      return false;
    });

    expect(duplicates).toEqual([]);
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
     * The two live under the same path, and the order list is the one that
     * would have lit up by accident: /webshop/termekek starts with /webshop.
     */
    it("hands /webshop/termekek to the products entry, not to the order list", () => {
      expect(active("/webshop/termekek", "/webshop/termekek")).toBe(true);
      expect(active("/webshop/termekek", "/webshop")).toBe(false);
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
