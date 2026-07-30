import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  NavConnectionCredentialInput,
  NavConnectionView,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NavConnectionSettingsPage } from "./nav-connection-settings-page";

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
vi.mock("@/lib/api/nav-connection", () => ({ navConnectionApi: api }));

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

const configuredView: NavConnectionView = {
  configured: true,
  masked: "••••••••",
  modifiedAt: "2026-07-30T10:00:00.000Z",
  verification: {
    status: "SUCCESS",
    checkedAt: "2026-07-30T10:00:00.000Z",
    code: null,
  },
};

const input: NavConnectionCredentialInput = {
  technicalUserLogin: "technical-user",
  technicalUserPassword: "password",
  technicalUserTaxNumber: "23916229",
  technicalUserSignKey: "sign-key",
  softwareId: "ACROPORAOS00000001",
  softwareDevName: "Acropora Kft.",
  softwareDevContact: "info@acropora.hu",
  softwareDevTaxNumber: "23916229",
};

describe("NavConnectionSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session("OWNER");
    api.get.mockResolvedValue(configuredView);
  });

  it("loads the masked connection status", async () => {
    render(<NavConnectionSettingsPage />);
    expect(await screen.findByText("Beállítva")).toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("token-OWNER", expect.anything());
  });

  it("saves the full credential set and clears every field", async () => {
    api.replaceCredential.mockResolvedValue(configuredView);
    render(<NavConnectionSettingsPage />);
    await screen.findByText("Beállítva");

    const labels: Record<keyof NavConnectionCredentialInput, string> = {
      technicalUserLogin: "Technikai felhasználó login",
      technicalUserPassword: "Technikai felhasználó jelszó",
      technicalUserTaxNumber: "Saját adószám törzsszáma",
      technicalUserSignKey: "Aláírókulcs",
      softwareId: "Szoftverazonosító",
      softwareDevName: "Szoftver fejlesztőjének neve",
      softwareDevContact: "Fejlesztő kapcsolattartója",
      softwareDevTaxNumber: "Fejlesztő adószámának törzsszáma",
    };
    for (const key of Object.keys(input) as Array<
      keyof NavConnectionCredentialInput
    >) {
      fireEvent.change(screen.getByLabelText(labels[key]), {
        target: { value: input[key] },
      });
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Mentés és ellenőrzés" }),
    );

    await screen.findByText(
      "A NAV technikai felhasználó adatai sikeresen elmentve és a bejövő számla lekérdezéssel ellenőrizve.",
    );
    expect(api.replaceCredential).toHaveBeenCalledWith("token-OWNER", input);
    for (const label of Object.values(labels))
      expect(screen.getByLabelText(label)).toHaveValue("");
  });

  it("tests the stored credential", async () => {
    api.test.mockResolvedValue(configuredView);
    render(<NavConnectionSettingsPage />);
    await screen.findByText("Beállítva");

    fireEvent.click(
      screen.getByRole("button", { name: "Kapcsolat tesztelése" }),
    );

    await waitFor(() => expect(api.test).toHaveBeenCalledWith("token-OWNER"));
    expect(
      await screen.findByText(
        "A NAV kapcsolat és a bejövő számla lekérdezési jogosultság működik.",
      ),
    ).toBeInTheDocument();
  });

  it("blocks access without settings.manage permission", async () => {
    auth.session = session("VIEWER");
    render(<NavConnectionSettingsPage />);
    expect(
      await screen.findByText(
        "Nincs hozzáférésed a NAV kapcsolat beállításaihoz",
      ),
    ).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
