import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SupplierListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupplierListPage } from "./supplier-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn(), sync: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/partnerek",
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
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
  },
};

function response(page: number): SupplierListResponse {
  return {
    items: [
      {
        id: "supplier-1",
        code: "BESZ-1",
        name: "Aqua Kereskedés Kft.",
        isSupplier: true,
        isService: false,
        country: "HU",
        isActive: true,
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
describe("SupplierListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
    api.sync.mockReset().mockResolvedValue({});
  });

  /** The Partners menu holds service partners too, not only suppliers, so the
   * button that starts a new record must not name one of the two kinds. The
   * editor screen carries the same label and is asserted in its own spec. */
  it("offers a neutral label for a new record", async () => {
    render(<SupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");

    expect(screen.getByRole("button", { name: "Új felvitele" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Új beszállító" })).toBeNull();
  });

  /** The list holds two kinds now, and which one a row is has to be readable
   * without opening it. Both labels are asserted on one row that carries both,
   * because that is the case a single-label design would get wrong. */
  it("labels each partner with the kinds it actually is", async () => {
    api.list.mockResolvedValue({
      items: [
        {
          ...response(1).items[0]!,
          name: "Kettős Kft.",
          isSupplier: true,
          isService: true,
        },
      ],
      pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    });

    render(<SupplierListPage />);
    await screen.findByText("Kettős Kft.");

    // Scoped to the row on purpose: the filter above the table offers the same
    // two words as options, so an unscoped search would pass on the filter
    // alone and say nothing about the row.
    const row = within(screen.getByRole("row", { name: /Kettős Kft\./ }));
    expect(row.getByText("Beszállító")).toBeTruthy();
    expect(row.getByText("Szerviz")).toBeTruthy();
  });

  /** The filter has to reach the endpoint, because filtering an already-paged
   * result would leave the page count describing a different list than the one
   * on screen. */
  it("asks the endpoint for one kind instead of narrowing the page", async () => {
    render(<SupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");

    fireEvent.change(screen.getByLabelText("Partner típusa"), {
      target: { value: "SERVICE" },
    });

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    const sent = new URLSearchParams(target.split("?")[1]);
    expect(sent.get("kind")).toBe("SERVICE");
    expect(sent.get("page")).toBe("1");
  });

  it("moves to the next page instead of returning to the first", async () => {
    render(<SupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("page")).toBe("3");
  });
});
