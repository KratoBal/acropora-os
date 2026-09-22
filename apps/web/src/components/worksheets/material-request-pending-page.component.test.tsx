import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PendingMaterialRequest, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { MaterialRequestPendingPage } from "./material-request-pending-page";

const api = vi.hoisted(() => ({
  listPending: vi.fn(),
  receive: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/material-requests", () => ({ materialRequestsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-beszerzo",
    email: "beszerzo@acropora.local",
    displayName: "Beszerző Béla",
    nickname: null,
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

function pending(
  over: Partial<PendingMaterialRequest> = {},
): PendingMaterialRequest {
  return {
    id: "mr-1",
    worksheetId: "w-1",
    status: "OPEN",
    requestedByName: "Szerelő Sándor",
    createdAt: "2026-09-22T20:00:00.000Z",
    submittedAt: "2026-09-22T20:05:00.000Z",
    receivedAt: null,
    receivedByName: null,
    items: [{ id: "item-1", name: "40mm könyök", quantity: "2", unit: "db" }],
    worksheetNumber: "BIO-2026-001",
    customerDisplayName: "Kovács Kft.",
    departmentName: "Biodom",
    ...over,
  };
}

beforeEach(() => {
  auth.session = session;
  api.listPending.mockReset();
  api.receive.mockReset();
});

describe("a beszerző saját listája, a weben", () => {
  it("megjeleníti a rá váró igényeket", async () => {
    api.listPending.mockResolvedValue({ items: [pending()] });
    render(<MaterialRequestPendingPage />);
    await waitFor(() => screen.getByText(/Kovács Kft\./));
    expect(screen.getByText(/40mm könyök/)).toBeTruthy();
  });

  it("üres listánál a hiánytalan üzenetet mutatja", async () => {
    api.listPending.mockResolvedValue({ items: [] });
    render(<MaterialRequestPendingPage />);
    await waitFor(() => screen.getByText("Nincs rád váró anyagigény"));
  });

  it("403-nál a JOGOSULTSÁG hiányát mondja ki, NEM általános hibát", async () => {
    /*
      A kliens a 403-at altalanos szoveggel csereli (lasd `client.ts`), tehat
      a komponensnek a STATUS KODBOL kell felismernie ezt az esetet, nem a
      hibauzenet szovegebol.
    */
    api.listPending.mockRejectedValue(
      new ApiError("Nincs jogosultságod ehhez a művelethez.", 403),
    );
    render(<MaterialRequestPendingPage />);
    await waitFor(() =>
      screen.getByText("Ehhez a listához nincs jogosultságod"),
    );
  });

  it("a Beérkezett gomb meghívja a receive-t, és frissíti a listát", async () => {
    api.listPending.mockResolvedValue({ items: [pending()] });
    api.receive.mockResolvedValue({ items: [] });
    render(<MaterialRequestPendingPage />);
    await waitFor(() => screen.getByText(/Kovács Kft\./));

    fireEvent.click(screen.getByRole("button", { name: "Anyag beérkezett" }));
    await waitFor(() =>
      expect(api.receive).toHaveBeenCalledWith("token-1", "mr-1"),
    );
    await waitFor(() => screen.getByText("Nincs rád váró anyagigény"));
  });
});
