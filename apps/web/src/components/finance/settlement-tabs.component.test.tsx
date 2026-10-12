import { render, screen, waitFor } from "@testing-library/react";
import type { Session, UserRole } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettlementTabs } from "./settlement-tabs";
import { SettlementsRedirect } from "./settlements-redirect";

/**
 * AZ ELSZÁMOLÁSOK FÜLSORA ÉS GYŰJTŐ-ÚTVONALA (Balázs, 2026-09-30).
 */
const navigation = vi.hoisted(() => ({
  pathname: "/penzugy/gls",
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
}));

const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

function as(role: UserRole): Session {
  return {
    id: "s",
    token: "t",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u",
      email: "u@acropora.local",
      displayName: "U",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

beforeEach(() => {
  navigation.pathname = "/penzugy/gls";
  navigation.replace.mockReset();
  auth.session = as("OWNER");
});

describe("SettlementTabs", () => {
  it("shows the three tabs, pointing to their own paths, the current one marked", () => {
    render(<SettlementTabs />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/penzugy/foxpost",
      "/penzugy/gls",
      "/penzugy/simplepay",
    ]);
    expect(screen.getByRole("link", { name: "GLS" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Foxpost" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("SETTLE-CARDS: each provider card says what it settles", () => {
    render(<SettlementTabs />);
    expect(
      screen.getByText("Heti utánvét + díjszámla egy levélben"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Utánvét, díjszámla és kompenzáció"),
    ).toBeInTheDocument();
    expect(screen.getByText("Kártyás forgalmi kimutatás")).toBeInTheDocument();
  });

  it("shows no tab to a role without the finance view", () => {
    auth.session = as("SERVICE");
    render(<SettlementTabs />);
    expect(
      screen.queryByRole("navigation", { name: "Elszámolások" }),
    ).toBeNull();
  });
});

describe("SettlementsRedirect", () => {
  it("goes to the first tab the reader may open", async () => {
    render(<SettlementsRedirect />);
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/penzugy/foxpost"),
    );
  });

  it("says so when no tab is open to the reader, and goes nowhere", () => {
    auth.session = as("SERVICE");
    render(<SettlementsRedirect />);
    expect(
      screen.getByText("Nincs hozzáférésed az elszámolásokhoz"),
    ).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
