import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  MaterialRequestHistoryEntry,
  PendingMaterialRequest,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { MaterialRequestPendingPage } from "./material-request-pending-page";

const api = vi.hoisted(() => ({
  listPending: vi.fn(),
  receive: vi.fn(),
  listHistory: vi.fn(),
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

function history(
  over: Partial<MaterialRequestHistoryEntry> = {},
): MaterialRequestHistoryEntry {
  return {
    id: "mr-2",
    worksheetId: "w-2",
    status: "RECEIVED",
    requestedByName: "Szerelő Sándor",
    createdAt: "2026-09-20T08:00:00.000Z",
    submittedAt: "2026-09-21T10:00:00.000Z",
    receivedAt: "2026-09-22T14:00:00.000Z",
    receivedByName: "Beszerző Béla",
    items: [{ id: "item-2", name: "PVC cső", quantity: "10 méter", unit: "" }],
    worksheetNumber: "BIO-2026-002",
    customerDisplayName: "Nagy Bt.",
    departmentName: "LSS",
    ...over,
  };
}

beforeEach(() => {
  auth.session = session;
  api.listPending.mockReset();
  api.receive.mockReset();
  api.listHistory.mockReset();
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

describe("az anyagigények előzményei, a weben", () => {
  function switchToHistory() {
    fireEvent.change(screen.getByLabelText("Anyagigények nézete"), {
      target: { value: "history" },
    });
  }

  it("megjeleníti az előzményeket, és a SUBMITTEDAT dátumot mutatja, nem a createdAt-et", async () => {
    /*
      A rossz iranyt kell allitani (acrobot kikotese, 2026-09-23 20:10:49
      UTC): ha a komponens tevedesbol a createdAt-et jelenitene meg, ez a
      teszt akkor is zold maradna, ha csak a submittedAt megjeleneset
      allitanank. A createdAt es a submittedAt EGY NAPPAL elter egymastol,
      es mindket iranyt kulon merjuk.
    */
    api.listPending.mockResolvedValue({ items: [] });
    api.listHistory.mockResolvedValue({ items: [history()] });
    render(<MaterialRequestPendingPage />);
    await waitFor(() => screen.getByText("Nincs rád váró anyagigény"));

    switchToHistory();
    await waitFor(() => screen.getByText(/Nagy Bt\./));

    expect(screen.getByText(/09\. 21\./)).toBeTruthy();
    expect(screen.queryByText(/09\. 20\./)).toBeNull();
  });

  it("a DRAFT sor NEM jelenik meg az előzmények között, akkor sem, ha a válasz hordozná", async () => {
    /*
      A szerver MA sosem ad DRAFT sort a `listHistory` valaszaban (lasd a
      repository fejleceit), de ez a teszt a KOMPONENS sajat, VEDEKEZO
      szuresen mer, nem a szerver igeretere hagyatkozva -- lasd a komponens
      "VEDEKEZO SZURES" jegyzetet.
    */
    api.listPending.mockResolvedValue({ items: [] });
    api.listHistory.mockResolvedValue({
      items: [
        history(),
        history({
          id: "mr-3",
          status: "DRAFT",
          submittedAt: null,
          receivedAt: null,
          receivedByName: null,
          items: [
            {
              id: "item-3",
              name: "Rejtett piszkozat tétel",
              quantity: "1",
              unit: "db",
            },
          ],
        }),
      ],
    });
    render(<MaterialRequestPendingPage />);
    await waitFor(() => screen.getByText("Nincs rád váró anyagigény"));

    switchToHistory();
    await waitFor(() => screen.getByText(/Nagy Bt\./));

    expect(screen.queryByText(/Rejtett piszkozat tétel/)).toBeNull();
  });

  it("üres előzménynél a hiánytalan üzenetet mutatja", async () => {
    api.listPending.mockResolvedValue({ items: [] });
    api.listHistory.mockResolvedValue({ items: [] });
    render(<MaterialRequestPendingPage />);
    await waitFor(() => screen.getByText("Nincs rád váró anyagigény"));

    switchToHistory();
    await waitFor(() => screen.getByText("Nincs még elküldött anyagigény"));
  });

  it("403-nál a JOGOSULTSÁG hiányát mondja ki az előzményeknél is", async () => {
    api.listPending.mockResolvedValue({ items: [] });
    api.listHistory.mockRejectedValue(
      new ApiError("Nincs jogosultságod ehhez a művelethez.", 403),
    );
    render(<MaterialRequestPendingPage />);
    await waitFor(() => screen.getByText("Nincs rád váró anyagigény"));

    switchToHistory();
    await waitFor(() =>
      screen.getByText("Ehhez a listához nincs jogosultságod"),
    );
  });
});
