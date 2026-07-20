import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, UnasProductSyncRun } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnasProductSyncPage } from "./unas-product-sync-page";

const api = vi.hoisted(() => ({ listRuns: vi.fn(), run: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/unas-product-sync", () => ({ unasProductSyncApi: api }));

const session = (role: "OWNER" | "VIEWER"): Session => ({
  id: `session-${role}`,
  token: `token-${role}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: role,
    email: `${role.toLowerCase()}@acropora.local`,
    displayName: role,
    role,
  },
});

const run: UnasProductSyncRun = {
  id: "run-1",
  kind: "INCREMENTAL",
  status: "APPLIED",
  windowStart: "2026-07-20T10:00:00.000Z",
  windowEnd: "2026-07-20T11:00:00.000Z",
  startedAt: "2026-07-20T11:00:00.000Z",
  completedAt: "2026-07-20T11:01:00.000Z",
  productsSeen: 12,
  createdCount: 2,
  updatedCount: 3,
  unchangedCount: 7,
  conflictCount: 0,
  missingCount: 1,
  errorCode: null,
};

describe("UnasProductSyncPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session("OWNER");
    api.listRuns.mockResolvedValue([run]);
    api.run.mockResolvedValue({
      runId: "run-2",
      status: "APPLIED",
      productsSeen: 10,
      counts: { CREATE: 1, UPDATE: 2, UNCHANGED: 7, CONFLICT: 0 },
      missingCount: 0,
      windowStart: run.windowEnd,
      windowEnd: "2026-07-20T12:00:00.000Z",
    });
  });

  it("loads and renders recent sync runs", async () => {
    render(<UnasProductSyncPage />);
    expect(await screen.findByText("run-1")).toBeInTheDocument();
    expect(screen.getByText("Inkrementális")).toBeInTheDocument();
    expect(screen.getAllByText("12")).toHaveLength(2);
    expect(api.listRuns).toHaveBeenCalledWith(
      "token-OWNER",
      20,
      expect.anything(),
    );
  });

  it("starts a manual sync and refreshes the history", async () => {
    render(<UnasProductSyncPage />);
    await screen.findByText("run-1");
    fireEvent.click(screen.getByRole("button", { name: "Szinkron indítása" }));
    await screen.findByText("A termékszinkron sikeresen befejeződött");
    expect(api.run).toHaveBeenCalledWith("token-OWNER");
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledTimes(2));
  });

  it("keeps the history read-only for a viewer", async () => {
    auth.session = session("VIEWER");
    render(<UnasProductSyncPage />);
    await screen.findByText("run-1");
    expect(
      screen.queryByRole("button", { name: "Szinkron indítása" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Kapcsolat beállításai" }),
    ).not.toBeInTheDocument();
  });

  it("links owners to the connection settings page", async () => {
    render(<UnasProductSyncPage />);
    expect(
      await screen.findByRole("button", { name: "Kapcsolat beállításai" }),
    ).toBeInTheDocument();
  });
});
