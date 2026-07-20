import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, UnasConnectionView } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UnasConnectionSettingsPage } from "./unas-connection-settings-page";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  replaceCredential: vi.fn(),
  test: vi.fn(),
  disable: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/unas-connection", () => ({ unasConnectionApi: api }));

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

const configuredView: UnasConnectionView = {
  configured: true,
  masked: "••••••••",
  modifiedAt: "2026-07-20T10:00:00.000Z",
  verification: {
    status: "SUCCESS",
    checkedAt: "2026-07-20T10:00:00.000Z",
    code: null,
  },
};

const notConfiguredView: UnasConnectionView = {
  configured: false,
  masked: null,
  modifiedAt: null,
  verification: { status: "NEVER", checkedAt: null, code: null },
};

describe("UnasConnectionSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session("OWNER");
    api.get.mockResolvedValue(configuredView);
  });

  it("loads and renders the connection status", async () => {
    render(<UnasConnectionSettingsPage />);
    expect(await screen.findByText("Beállítva")).toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(screen.getByText("Sikeres")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("token-OWNER", expect.anything());
  });

  it("saves a new API key and shows the updated status", async () => {
    api.get.mockResolvedValue(notConfiguredView);
    api.replaceCredential.mockResolvedValue(configuredView);
    render(<UnasConnectionSettingsPage />);
    await screen.findByText("Nincs beállítva");

    fireEvent.change(screen.getByLabelText("UNAS API-kulcs"), {
      target: { value: "secret-key-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await screen.findByText("Az API-kulcs sikeresen elmentve és ellenőrizve.");
    expect(api.replaceCredential).toHaveBeenCalledWith(
      "token-OWNER",
      "secret-key-123",
    );
    expect(screen.getByLabelText("UNAS API-kulcs")).toHaveValue("");
  });

  it("tests the stored credential", async () => {
    api.test.mockResolvedValue(configuredView);
    render(<UnasConnectionSettingsPage />);
    await screen.findByText("Beállítva");

    fireEvent.click(
      screen.getByRole("button", { name: "Kapcsolat tesztelése" }),
    );

    await waitFor(() => expect(api.test).toHaveBeenCalledWith("token-OWNER"));
  });

  it("disables the connection after confirmation", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    api.disable.mockResolvedValue(notConfiguredView);
    render(<UnasConnectionSettingsPage />);
    await screen.findByText("Beállítva");

    fireEvent.click(
      screen.getByRole("button", { name: "Kapcsolat letiltása" }),
    );

    await screen.findByText("Nincs beállítva");
    expect(api.disable).toHaveBeenCalledWith("token-OWNER");
  });

  it("does not disable the connection if the confirmation is declined", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => false),
    );
    render(<UnasConnectionSettingsPage />);
    await screen.findByText("Beállítva");

    fireEvent.click(
      screen.getByRole("button", { name: "Kapcsolat letiltása" }),
    );

    expect(api.disable).not.toHaveBeenCalled();
  });

  it("blocks access without settings.manage permission", async () => {
    auth.session = session("VIEWER");
    render(<UnasConnectionSettingsPage />);
    expect(
      await screen.findByText(
        "Nincs hozzáférésed az UNAS kapcsolat beállításaihoz",
      ),
    ).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
