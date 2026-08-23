import { fireEvent, render, screen } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock("./auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("./auth/user-menu", () => ({
  UserMenu: () => <div>Felhasználói menü</div>,
}));

const ownerSession: Session = {
  id: "owner-session",
  token: "owner-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Owner",
    role: "OWNER",
  },
};

describe("AppShell settings navigation", () => {
  beforeEach(() => {
    auth.session = ownerSession;
    navigation.pathname = "/";
  });

  it("nests UNAS, NAV and users below settings", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.queryByRole("link", { name: "Kapcsolat" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Beállítások" }));

    expect(screen.getByRole("link", { name: "NAV" })).toHaveAttribute(
      "href",
      "/admin/integrations/nav",
    );
    expect(screen.getByRole("link", { name: "Felhasználók" })).toHaveAttribute(
      "href",
      "/admin/users",
    );

    fireEvent.click(screen.getByRole("button", { name: "UNAS" }));

    expect(screen.getByRole("link", { name: "Kapcsolat" })).toHaveAttribute(
      "href",
      "/admin/integrations/unas/connection",
    );
    expect(screen.getByRole("link", { name: "Szinkron" })).toHaveAttribute(
      "href",
      "/admin/integrations/unas",
    );
  });

  it("automatically expands the active settings hierarchy", () => {
    navigation.pathname = "/admin/integrations/unas/connection";

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.getByRole("button", { name: "Beállítások" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "UNAS" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Kapcsolat" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Szinkron" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("AppShell business navigation groups", () => {
  beforeEach(() => {
    auth.session = ownerSession;
    navigation.pathname = "/";
  });

  it("keeps a group's pages behind its heading until it is opened", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.queryByRole("link", { name: "Megrendelések" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Webshop" }));

    expect(screen.getByRole("link", { name: "Megrendelések" })).toHaveAttribute(
      "href",
      "/webshop",
    );
    expect(
      screen.getByRole("link", { name: "Webshop vásárlók" }),
    ).toHaveAttribute("href", "/vevok");
  });

  it("gathers purchasing, the NAV invoices and the Foxpost settlement under Pénzügy", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Pénzügy" }));

    expect(screen.getByRole("link", { name: "Beszerzés" })).toHaveAttribute(
      "href",
      "/beszerzes",
    );
    expect(
      screen.getByRole("link", { name: "NAV számla lekérés" }),
    ).toHaveAttribute("href", "/beszerzes/nav-szamlak");
    expect(
      screen.getByRole("link", { name: "Foxpost elszámolás" }),
    ).toHaveAttribute("href", "/penzugy/foxpost");
  });

  /**
   * Opening the app on a page inside a group has to show where you are. A
   * closed group on the page it contains looks like the menu forgot the
   * screen you are reading.
   */
  it("opens the group that holds the current page, and marks it", () => {
    navigation.pathname = "/beszerzes/nav-szamlak";

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.getByRole("button", { name: "Pénzügy" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("link", { name: "NAV számla lekérés" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Webshop" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  /**
   * The heading disappears with its pages, and narrows to the ones that are
   * left. A technician may see the webshop buyers but not the orders, and may
   * see nothing at all under Pénzügy: the first heading stays with one page
   * under it, the second is not drawn.
   *
   * Both halves are asserted together on purpose. Checking only the missing
   * heading would also pass on a menu that hid everything.
   */
  it("narrows a heading to the pages in reach, and drops it when none are", () => {
    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "SERVICE" },
    };

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.queryByRole("button", { name: "Pénzügy" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Webshop" }));

    expect(
      screen.getByRole("link", { name: "Webshop vásárlók" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Megrendelések" }),
    ).not.toBeInTheDocument();
  });
});
