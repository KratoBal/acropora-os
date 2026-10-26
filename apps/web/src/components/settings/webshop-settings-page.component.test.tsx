import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  hasPermission,
  isNavigationEntryVisible,
  NAVIGATION_FEATURES,
  USER_ROLES,
  type NavigationEntryView,
  type UserRole,
} from "@acropora/types";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WEBSHOP_SETTINGS_AREAS,
  type SettingsLink,
} from "./settings-overview-page";
import { WebshopSettingsPage } from "./webshop-settings-page";

/*
  THE WEBSHOP SETTINGS PAGE (Balázs, 2026-10-26 13:05 UTC, msg
  1564263673932026020; acrobot's decision). WHAT TURNS RED: a card links to a
  page that does not exist; a card shows to someone its own entry or right
  would hide it from; the feature-gated home page card ignores the served
  switch; the menu entry's rule drifts from the union of its cards.
*/
const auth = vi.hoisted(() => ({
  role: "OWNER" as UserRole,
  navigation: [] as Pick<NavigationEntryView, "id">[],
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token-1",
      user: { id: "user-1", email: "b@acropora.local", role: auth.role },
      navigation: auth.navigation,
    },
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const APP = join(process.cwd(), "src", "app", "(shell)");
const oldalFajlja = (href: string) =>
  join(
    APP,
    ...href.replace(/^\//, "").replace(/\?.*$/, "").split("/"),
    "page.tsx",
  );

const links = WEBSHOP_SETTINGS_AREAS.flatMap((area) => area.links);
const ALL_FEATURES = new Set(NAVIGATION_FEATURES);
const linkVisible = (link: SettingsLink, role: UserRole) =>
  "entryId" in link
    ? isNavigationEntryVisible(link.entryId, { role }, ALL_FEATURES)
    : hasPermission({ role }, link.permission);

const hrefsOnScreen = () =>
  screen.queryAllByRole("link").map((elem) => elem.getAttribute("href"));

beforeEach(() => {
  auth.role = "OWNER";
  auth.navigation = [];
});

describe("Webshop beállítások", () => {
  it("holds the cards acrobot listed, each pointing at an existing page", () => {
    expect(links.map((link) => link.href)).toEqual([
      "/admin/integrations/unas/connection",
      "/admin/integrations/unas",
      "/admin/integrations/medusa/connection",
      "/beallitasok/rendeles-elavulas",
      "/beallitasok/levelsablonok?csoport=webshop",
      "/admin/kezdolap",
    ]);
    expect(links.filter((link) => !existsSync(oldalFajlja(link.href)))).toEqual(
      [],
    );
    // control: the existence check can see a missing page
    expect(existsSync(oldalFajlja("/nincs-ilyen-oldal?csoport=x"))).toBe(false);
    expect(existsSync(oldalFajlja("/webshop/beallitasok"))).toBe(true);
  });

  it("shows the owner every card, the home page one only with the served switch", () => {
    render(<WebshopSettingsPage />);
    expect(screen.getByRole("heading", { name: "Webshop beállítások" }));
    const without = hrefsOnScreen();
    expect(without).not.toContain("/admin/kezdolap");
    expect(without).toContain("/admin/integrations/medusa/connection");
  });

  it("the served home page switch brings its card", () => {
    auth.navigation = [{ id: "homepage-content" }];
    render(<WebshopSettingsPage />);
    expect(hrefsOnScreen().sort()).toEqual(
      links.map((link) => link.href).sort(),
    );
  });

  it("shows each role exactly the cards its rights reach", () => {
    auth.navigation = [{ id: "homepage-content" }];
    for (const role of USER_ROLES) {
      auth.role = role;
      const { unmount } = render(<WebshopSettingsPage />);
      expect([role, hrefsOnScreen().sort()]).toEqual([
        role,
        links
          .filter((link) => linkVisible(link, role))
          .map((link) => link.href)
          .sort(),
      ]);
      unmount();
    }
  });

  /*
    THE MENU ENTRY'S RULE IS products.view, AND THAT IS THE UNION OF ITS
    CARDS for every role today (measured: whoever holds settings.manage or
    orders.view also holds products.view). If a role ever gets a card without
    products.view, this turns red, and the entry needs a wider rule.
  */
  it("the menu entry shows exactly when at least one card does, for every role", () => {
    for (const role of USER_ROLES) {
      expect([
        role,
        isNavigationEntryVisible("webshop-settings", { role }, ALL_FEATURES),
      ]).toEqual([role, links.some((link) => linkVisible(link, role))]);
    }
    // control: the loop sees both outcomes
    expect(
      USER_ROLES.some((role) => links.some((l) => linkVisible(l, role))),
    ).toBe(true);
    expect(
      USER_ROLES.some((role) => !links.some((l) => linkVisible(l, role))),
    ).toBe(true);
  });
});
