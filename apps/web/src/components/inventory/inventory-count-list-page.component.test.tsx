import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InventoryCountListResponse, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { urlNavigation } from "@/test/url-navigation";

import { InventoryCountListPage } from "./inventory-count-list-page";

/*
  A LELTÁR-LISTA ÁLLAPOTA AZ URL-BEN (Balázs kérése, 2026-09-30): egy
  leltárból visszalépve a lista ugyanazon a szűrőn és lapon áll. MI PIROSÍT:
  ha a szűrő vagy a lap megint helyi állapot lenne, vagy ha a szűrő-váltás a
  lapot nem nullázná (egy harmadik lapról egy rövidebb szűrt listára váltva
  üres oldal jönne).
*/
vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/api/inventory", () => ({ inventoryApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "raktar@acropora.local",
    displayName: "Raktáros",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session }),
}));

const response: InventoryCountListResponse = {
  items: [
    {
      id: "count-1",
      countNumber: "LELT-2026-001",
      status: "DRAFT",
      warehouseName: "Bolt",
      lineCount: 3,
      startedByName: "Raktáros",
      createdAt: "2026-09-30T10:00:00.000Z",
      uploadedAt: null,
      correctedAt: null,
    },
  ],
  pagination: { page: 3, pageSize: 20, totalItems: 41, totalPages: 3 },
};

beforeEach(() => {
  api.list.mockReset().mockResolvedValue(response);
});

describe("InventoryCountListPage -- állapot az URL-ben", () => {
  it("az URL szűrőjéből és lapjáról kérdez", async () => {
    urlNavigation.reset("/raktar", "status=DRAFT&page=3");
    render(<InventoryCountListPage />);
    await screen.findAllByText("LELT-2026-001");
    expect(api.list).toHaveBeenLastCalledWith("token-1", {
      page: 3,
      pageSize: 20,
      status: "DRAFT",
    });
    expect(
      (screen.getByLabelText("Állapot szűrő") as HTMLSelectElement).value,
    ).toBe("DRAFT");
  });

  it("a szűrő-váltás az URL-be íródik, és a lapot is nullázza", async () => {
    urlNavigation.reset("/raktar", "status=DRAFT&page=3");
    render(<InventoryCountListPage />);
    await screen.findAllByText("LELT-2026-001");

    fireEvent.change(screen.getByLabelText("Állapot szűrő"), {
      target: { value: "UPLOADED" },
    });
    await waitFor(() => expect(urlNavigation.search).toBe("status=UPLOADED"));
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith("token-1", {
        page: 1,
        pageSize: 20,
        status: "UPLOADED",
      }),
    );
  });

  it("KONTROLL: ismeretlen szűrő-érték az alapnézetet adja", async () => {
    urlNavigation.reset("/raktar", "status=BOGUS");
    render(<InventoryCountListPage />);
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith("token-1", {
        page: 1,
        pageSize: 20,
        status: undefined,
      }),
    );
  });
});
