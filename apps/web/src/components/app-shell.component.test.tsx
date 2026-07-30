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
