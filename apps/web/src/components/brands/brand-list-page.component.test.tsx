import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BrandListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrandListPage } from "./brand-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn(), sync: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/brands",
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        navigation.listeners.add(listener);
        return () => navigation.listeners.delete(listener);
      },
      () => navigation.params,
      () => navigation.params,
    ),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/brands", () => ({ brandsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

function response(page: number): BrandListResponse {
  return {
    items: [
      {
        id: "brand-1",
        name: "Tropic Marin",
        normalizedName: "tropic marin",
        slug: "tropic-marin",
        isActive: true,
        aliases: [],
        externalMappings: [],
        usage: { productCount: 12, reviewReferenceCount: 0 },
        createdAt: "2026-08-19T10:00:00.000Z",
        updatedAt: "2026-08-19T10:00:00.000Z",
      },
    ],
    pagination: { page, pageSize: 25, totalItems: 60, totalPages: 3 },
  };
}

/**
 * Ugyanaz a mérés, mint az eszközlistán: a lapozás nem mehet a szűrő-ágon,
 * mert az a végén mindig `page=1`-et ír. A javítás előtti alakkal ez az
 * eset bukik - a "Következő" a 2. oldalról az elsőre visz vissza.
 */
describe("BrandListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
    api.sync.mockReset().mockResolvedValue({});
  });

  it("moves to the next page instead of returning to the first", async () => {
    render(<BrandListPage />);
    await screen.findByText("Tropic Marin");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("page")).toBe("3");
  });
});
