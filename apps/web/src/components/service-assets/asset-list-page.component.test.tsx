import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetListPage } from "./asset-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok",
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
vi.mock("@/lib/api/assets", () => ({ assetsApi: api }));

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

function response(page: number): AssetListResponse {
  return {
    items: [
      {
        id: "asset-1",
        assetNumber: "ESZ-0001",
        name: "Cápasuli kompresszor",
        kind: "EQUIPMENT",
        status: "ACTIVE",
        criticality: "NORMAL",
        qrToken: "qr-token-1",
        childCount: 0,
        updatedAt: "2026-08-19T10:00:00.000Z",
        owner: {
          type: "CUSTOMER",
          id: "customer-1",
          code: "VEVO-1",
          displayName: "Fővárosi Állat- És Növénykert",
        },
      },
    ],
    pagination: { page, pageSize: 25, totalItems: 60, totalPages: 3 },
  };
}

function lastTarget() {
  const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
  return new URLSearchParams(target.split("?")[1]);
}

describe("AssetListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2&status=ACTIVE");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
  });

  // A lapozás nem mehet a szűrő-ágon: az mindig page=1-et ír a végén, tehát
  // a "Következő" gomb csendben az első oldalra vitt vissza, és az első
  // oldalon túl semmi nem volt elérhető erről a képernyőről.
  it("moves forward instead of bouncing back to the first page", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("3");
  });

  it("steps back one page, not all the way to the start", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Előző" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("1");
  });

  it("keeps the active filters while paging", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("status")).toBe("ACTIVE");
  });

  // A szűrő viszont HELYESEN ugrik vissza az elsőre: egy másik szűrő
  // negyedik oldala jellemzően nem is létezik.
  it("still returns to the first page when a filter changes", async () => {
    render(<AssetListPage />);
    await screen.findByText("Cápasuli kompresszor");

    fireEvent.change(screen.getByLabelText("Státusz"), {
      target: { value: "RETIRED" },
    });

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(lastTarget().get("page")).toBe("1");
    expect(lastTarget().get("status")).toBe("RETIRED");
  });
});
