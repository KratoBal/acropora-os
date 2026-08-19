import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, WorksheetListResponse } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetListPage } from "./worksheet-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/munkalapok",
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
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-sanyi",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
  },
};

function response(
  overrides: Partial<WorksheetListResponse> = {},
): WorksheetListResponse {
  return {
    items: [
      {
        id: "worksheet-1",
        number: "FANK-BIO-2026-001",
        label: "FANK-BIO-2026-001",
        customerName: "Fővárosi Állat- És Növénykert",
        departmentCode: "BIO",
        subject: "Cápasuli kompresszorok bevizsgálása",
        status: "AWAITING_SIGNATURE",
        version: 1,
        versionCount: 1,
        grossAmount: "38100",
        assigneeNames: ["Sanyi", "Kiss Péter"],
        updatedAt: "2026-08-19T10:00:00.000Z",
      },
      {
        id: "worksheet-2",
        number: null,
        label: null,
        customerName: "Fővárosi Állat- És Növénykert",
        departmentCode: "PPU",
        subject: "Szivattyú csere",
        status: "DRAFT",
        version: 1,
        versionCount: 1,
        grossAmount: "0",
        assigneeNames: [],
        updatedAt: "2026-08-19T11:00:00.000Z",
      },
    ],
    pagination: { page: 1, pageSize: 25, totalItems: 40, totalPages: 2 },
    ...overrides,
  };
}

describe("WorksheetListPage", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response());
  });

  it("names the people a worksheet is on, and says so when it is nobody's", async () => {
    render(<WorksheetListPage />);

    expect(await screen.findByText("Sanyi, Kiss Péter")).toBeTruthy();
    // Az üres cella hibának látszana; a "nincs kiosztva" szabály.
    expect(screen.getByText("Nincs kiosztva")).toBeTruthy();
  });

  // A piszkozatnak nincs száma, mert a sorszám a lezáráskor keletkezik. Ha
  // ezt üresen hagynánk, a felhasználó elveszett adatot feltételezne.
  it("says a draft has no number yet instead of showing an empty cell", async () => {
    render(<WorksheetListPage />);
    expect(await screen.findByText("Még nincs száma")).toBeTruthy();
  });

  // A lapozas nem mehet a szuro-agon: az mindig page=1-et ir, tehat a
  // "Kovetkezo" gomb csendben az elso oldalra vinne vissza.
  it("moves to the next page instead of quietly returning to the first", async () => {
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("page")).toBe("2");
  });

  it("filters down to the worksheets handed to the person looking", async () => {
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    fireEvent.click(
      screen.getByRole("button", { name: "Csak amit rám osztottak" }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("assigneeId")).toBe(
      "user-sanyi",
    );
  });
});
