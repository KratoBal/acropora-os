import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PartnerOrderBacklogSettingsPage } from "./partner-order-backlog-settings-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const api = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("@/lib/api/partner-orders", () => ({ partnerOrdersApi: api }));
const auth = vi.hoisted(() => ({ role: "ADMIN" as string }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "u@acropora.local",
        displayName: "Balázs",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    } as unknown as Session,
  }),
}));

/*
  A HÁTRALÉKOS MEGRENDELÉS HATÁRA A BEÁLLÍTÁSOK ALATT (Picasso 3.8, acrobot 62141): a beállítás a Megrendelések listáról költözött ide, ugyanazzal az API-val és szabállyal.
  MI PIROSÍT: ha a mentett érték nem látszik; ha a nulla nem menthető (kikapcsolás); ha érvénytelen szám menthető, vagy az ok nem látszik; ha a hibás mentés elveszti a begépelt
  értéket; ha olvasó jogú nézőnek mentés gomb vagy szerkeszthető mező jelenik meg.
*/
describe("PartnerOrderBacklogSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.role = "ADMIN";
    api.settings.mockResolvedValue({ backlogDays: 14 });
  });

  it("shows the saved days and saves what is typed, zero too", async () => {
    api.saveSettings.mockResolvedValue({ backlogDays: 0 });
    render(<PartnerOrderBacklogSettingsPage />);
    const field = (await screen.findByLabelText(
      "Hátralék napjai",
    )) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("14"));
    const save = screen.getByRole("button", { name: "Mentés" });
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "0" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith("token-1", 0),
    );
    expect(await screen.findByText("Elmentve.")).toBeInTheDocument();
    expect(field.value).toBe("0");
  });

  it("does not let an invalid number be saved, and says why", async () => {
    render(<PartnerOrderBacklogSettingsPage />);
    const field = (await screen.findByLabelText(
      "Hátralék napjai",
    )) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("14"));
    for (const bad of ["-1", "1.5", "x", "366", "1000"]) {
      fireEvent.change(field, { target: { value: bad } });
      expect(
        screen.getByRole("button", { name: "Mentés" }),
        bad,
      ).toBeDisabled();
      expect(
        screen.getByText(/0 és 365 közötti egész szám kell/),
      ).toBeInTheDocument();
    }
    fireEvent.change(field, { target: { value: "365" } });
    expect(screen.getByRole("button", { name: "Mentés" })).toBeEnabled();
  });

  it("a failed save says so and keeps the typed value", async () => {
    api.saveSettings.mockRejectedValue(new Error("A beállítás nem menthető."));
    render(<PartnerOrderBacklogSettingsPage />);
    const field = (await screen.findByLabelText(
      "Hátralék napjai",
    )) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe("14"));
    fireEvent.change(field, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(
      await screen.findByText("A beállítás nem menthető."),
    ).toBeInTheDocument();
    expect(field.value).toBe("7");
    expect(screen.queryByText("Elmentve.")).toBeNull();
  });

  it("a failed read says so instead of showing an empty setting as if it were zero", async () => {
    api.settings.mockRejectedValue(new Error("A beállítás nem tölthető be."));
    render(<PartnerOrderBacklogSettingsPage />);
    expect(
      await screen.findByText("A beállítás nem tölthető be."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Hátralék napjai")).toBeDisabled();
  });
});
