import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, SzamlazzConnectionView } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SzamlazzConnectionSettingsPage } from "./szamlazz-connection-settings-page";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  replaceCredential: vi.fn(),
  disable: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session, isLoading: false }),
}));
vi.mock("@/lib/api/szamlazz-connection", () => ({
  szamlazzConnectionApi: api,
}));

const session = (role: "OWNER" | "VIEWER"): Session => ({
  id: `session-${role}`,
  token: `token-${role}`,
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: role,
    email: `${role.toLowerCase()}@acropora.local`,
    displayName: role,
    role,
    customerId: null,
    supplierId: null,
  },
});

const view = (
  configured: boolean,
  extra: Partial<SzamlazzConnectionView> = {},
): SzamlazzConnectionView => ({
  configured,
  masked: configured ? "••••••••" : null,
  modifiedAt: configured ? "2026-09-24T12:00:00.000Z" : null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.session = session("OWNER");
  api.get.mockResolvedValue(view(true));
});

describe("Számlázz.hu kapcsolat beállító lap", () => {
  it("keeps the settings behind the manage permission", async () => {
    auth.session = session("VIEWER");

    render(<SzamlazzConnectionSettingsPage />);

    expect(
      await screen.findByText(
        "Nincs hozzáférésed a Számlázz.hu kapcsolat beállításaihoz",
      ),
    ).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("shows the stored key as masked, and offers no way to read it", async () => {
    render(<SzamlazzConnectionSettingsPage />);

    expect(await screen.findByText("••••••••")).toBeTruthy();
    const input = screen.getByLabelText("Agent Key") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
  });

  it("never offers a 'test connection' button, unlike the Medusa page", async () => {
    render(<SzamlazzConnectionSettingsPage />);
    await screen.findByText("••••••••");

    expect(screen.queryByText("Kapcsolat ellenőrzése")).toBeNull();
    expect(await screen.findByText("Nincs önálló ellenőrzés")).toBeTruthy();
  });

  it("sends a new key and then forgets it", async () => {
    api.replaceCredential.mockResolvedValue(view(true));

    render(<SzamlazzConnectionSettingsPage />);
    await screen.findByText("••••••••");

    const input = screen.getByLabelText("Agent Key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "uj-agent-key" } });
    fireEvent.click(screen.getByText("Mentés"));

    await waitFor(() =>
      expect(api.replaceCredential).toHaveBeenCalledWith("token-OWNER", {
        agentKey: "uj-agent-key",
      }),
    );
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("shows 'not configured' when there is no stored key", async () => {
    api.get.mockResolvedValue(view(false));

    render(<SzamlazzConnectionSettingsPage />);

    expect(await screen.findByText("nincs")).toBeTruthy();
    expect(screen.getByText("Kulcs beállítása")).toBeTruthy();
  });

  it("disables the connection after confirming", async () => {
    api.disable.mockResolvedValue(view(false));

    render(<SzamlazzConnectionSettingsPage />);
    await screen.findByText("••••••••");

    fireEvent.click(
      screen.getByRole("button", { name: "Kapcsolat letiltása" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(api.disable).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Kapcsolat letiltása" }),
    );

    await waitFor(() =>
      expect(api.disable).toHaveBeenCalledWith("token-OWNER"),
    );
  });
});
