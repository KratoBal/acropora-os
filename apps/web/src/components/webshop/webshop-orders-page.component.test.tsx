import { render, screen } from "@testing-library/react";
import type { Session, UnasOrderListResponse } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopOrdersPage } from "./webshop-orders-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  triggerSync: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/unas-orders", () => ({ unasOrdersApi: api }));

const ownerSession: Session = {
  id: "session-owner",
  token: "token-owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
  },
};

beforeEach(() => {
  auth.session = ownerSession;
  api.list.mockReset();
  api.triggerSync.mockReset();
});

describe("WebshopOrdersPage", () => {
  it("a fizikai UNAS-törlést mutatja az utolsó ismert aktív státusz helyett", async () => {
    const response: UnasOrderListResponse = {
      items: [
        {
          id: "order-deleted",
          orderNumber: "UNAS-47679-234831",
          status: "CANCELLED",
          unasStatusLabel: "Feldolgozásra vár",
          buyerName: "Teszt Vevő",
          paymentName: "Bankkártya",
          shippingName: "GLS",
          totalGross: "12700",
          currency: "HUF",
          lineCount: 1,
          createdAt: "2026-08-08T14:06:00.000Z",
          orderedAt: "2026-08-08T14:05:00.000Z",
          unasDeletedAt: "2026-08-09T09:00:00.000Z",
        },
      ],
      pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
    };
    api.list.mockResolvedValue(response);

    render(createElement(WebshopOrdersPage));

    expect(await screen.findByText("Törölve a UNAS-ban")).toBeInTheDocument();
    expect(screen.queryByText("Feldolgozásra vár")).not.toBeInTheDocument();
    expect(screen.getByText("1 tétel")).toBeInTheDocument();
  });
});
