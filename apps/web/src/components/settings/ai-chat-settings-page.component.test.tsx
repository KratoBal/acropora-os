import { fireEvent, render, screen } from "@testing-library/react";
import { AI_CHAT_SETTINGS_DEFAULTS } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiChatSettingsPage } from "./ai-chat-settings-page";

/*
  AZ AI CSEVEGÉS BEÁLLÍTÁSAI (kártya f5b8f7ba, 4a). MI PIROSÍT: a lap saját határt tud (a közös szabály helyett); egy határon kívüli
  érték menthető; a mentés nem a közös szabály értékét küldi (nem vágott, nem kerekített); jog nélkül betöltődik vagy szerkeszthető;
  a lap azt állítja, hogy az érték azonnal hat.
*/
const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
const auth = vi.hoisted(() => ({
  role: "OWNER" as "OWNER" | "ADMIN" | "MANAGER",
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: {
      token: "token",
      user: {
        id: "u",
        email: "u@acropora.local",
        role: auth.role,
        customerId: null,
        supplierId: null,
      },
    },
    isLoading: false,
  }),
}));
vi.mock("@/lib/api/ai-chat-settings", () => ({ aiChatSettingsApi: api }));
// the page also holds the contact request list (its own spec); here it is an empty list
vi.mock("@/lib/api/ai-contact-requests", () => ({
  aiContactRequestsApi: {
    list: vi.fn().mockResolvedValue([]),
    handled: vi.fn(),
  },
}));

const DAYS = "Üzenetek megőrzése (nap)";
const HANDLED = "Kezelt kérés megőrzése (nap)";
const UNHANDLED = "Kezeletlen kérés megőrzése (nap)";

beforeEach(() => {
  auth.role = "OWNER";
  api.get.mockReset();
  api.save.mockReset();
  api.get.mockResolvedValue({ ...AI_CHAT_SETTINGS_DEFAULTS });
});

const mentes = () => screen.getByRole("button", { name: "Mentés" });

describe("AiChatSettingsPage", () => {
  it("shows the saved settings, and the notice that the AI service does not read them yet", async () => {
    render(createElement(AiChatSettingsPage));
    expect(
      ((await screen.findByLabelText(DAYS)) as HTMLInputElement).value,
    ).toBe("180");
    expect((screen.getByLabelText(HANDLED) as HTMLInputElement).value).toBe(
      "30",
    );
    expect((screen.getByLabelText(UNHANDLED) as HTMLInputElement).value).toBe(
      "90",
    );
    expect(
      (screen.getByLabelText("Kapcsolat-kérés") as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByLabelText("Kollégai felajánlás") as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(screen.getByText(/még nem olvassa/)).toBeTruthy();
    expect(screen.getByText(/nem azonnali hatás/)).toBeTruthy();
  });

  it("saving sends the checked value: a trimmed recipient, the edited days, nothing the form did not show", async () => {
    api.save.mockImplementation(async (_token, settings) => settings);
    render(createElement(AiChatSettingsPage));
    await screen.findByLabelText(DAYS);
    fireEvent.change(screen.getByLabelText("Címzett e-mail címe"), {
      target: { value: "  ugyfel@acropora.hu " },
    });
    // The defaults have both switches OFF: the offer is switched on here by hand, so a `true` in the saved body is the user's.
    fireEvent.click(screen.getByLabelText("Kollégai felajánlás"));
    fireEvent.click(screen.getByLabelText("Kapcsolat-kérés"));
    fireEvent.change(screen.getByLabelText(DAYS), { target: { value: "120" } });
    fireEvent.click(mentes());
    expect(await screen.findByText("Mentve.")).toBeTruthy();
    expect(api.save).toHaveBeenCalledWith("token", {
      offerEnabled: true,
      contactRequestEnabled: true,
      contactRecipientEmail: "ugyfel@acropora.hu",
      messageRetentionDays: 120,
      contactHandledRetentionDays: 30,
      contactUnhandledRetentionDays: 90,
    });
  });

  it("a value outside the limits shows the shared rule's sentence and cannot be saved (nothing is clamped)", async () => {
    render(createElement(AiChatSettingsPage));
    const days = await screen.findByLabelText(DAYS);
    for (const value of ["6", "366", "", "30.5"]) {
      fireEvent.change(days, { target: { value } });
      expect(screen.getByRole("alert").textContent).toMatch(
        /nap közötti egész szám/,
      );
      expect((mentes() as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(mentes());
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.change(days, { target: { value: "7" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((mentes() as HTMLButtonElement).disabled).toBe(false);
  });

  it("an unhandled time shorter than the handled one, and a contact request without a recipient, are refused with their sentences", async () => {
    render(createElement(AiChatSettingsPage));
    await screen.findByLabelText(DAYS);
    fireEvent.change(screen.getByLabelText(UNHANDLED), {
      target: { value: "20" },
    });
    expect(screen.getByRole("alert").textContent).toMatch(/nem lehet rövidebb/);
    fireEvent.change(screen.getByLabelText(UNHANDLED), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByLabelText("Kapcsolat-kérés"));
    expect(screen.getByRole("alert").textContent).toMatch(/címzett kell/);
    expect((mentes() as HTMLButtonElement).disabled).toBe(true);
  });

  it("a refused save shows the server's sentence and keeps the form", async () => {
    api.save.mockRejectedValue(
      new Error("Az üzenetek megőrzése 7 és 365 nap közötti egész szám lehet."),
    );
    render(createElement(AiChatSettingsPage));
    await screen.findByLabelText(DAYS);
    fireEvent.click(mentes());
    expect(await screen.findByText(/7 és 365 nap közötti/)).toBeTruthy();
    expect((screen.getByLabelText(DAYS) as HTMLInputElement).value).toBe("180");
  });

  it("without the manage right nothing is loaded and no form is shown (a MANAGER does not have it)", async () => {
    auth.role = "MANAGER";
    render(createElement(AiChatSettingsPage));
    expect(await screen.findByText(/Nincs jogosultságod/)).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(DAYS)).toBeNull();
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
  });

  it("an ADMIN has the right", async () => {
    auth.role = "ADMIN";
    render(createElement(AiChatSettingsPage));
    expect(await screen.findByLabelText(DAYS)).toBeTruthy();
  });
});
