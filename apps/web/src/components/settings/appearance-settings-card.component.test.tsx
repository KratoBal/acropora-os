import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppearanceSettingsCard } from "./appearance-settings-card";

const theme = vi.hoisted(() => ({
  preference: "system" as "light" | "dark" | "system",
  setPreference: vi.fn(),
}));

vi.mock("@/lib/theme/use-theme-preference", () => ({
  useThemePreference: () => ({
    preference: theme.preference,
    setPreference: theme.setPreference,
  }),
}));

/**
 * A HÁROM GOMB A HELYES ÉRTÉKKEL HÍVJA A `setPreference`-ET, ÉS A
 * JELENLEGI VÁLASZTÁS LÁTHATÓ (`aria-pressed`) -- Balázs kérése (2026-09-24
 * 18:00 UTC): "legyen Világos / Sötét / Rendszer szerint a Beállításokban."
 */
describe("AppearanceSettingsCard", () => {
  beforeEach(() => {
    theme.preference = "system";
    theme.setPreference.mockReset();
  });

  it("mind a három lehetőség megjelenik, magyarul", () => {
    render(<AppearanceSettingsCard />);
    expect(screen.getByRole("button", { name: "Világos" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sötét" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Rendszer szerint" }),
    ).toBeTruthy();
  });

  it("a jelenlegi választás aria-pressed=true-t visel", () => {
    theme.preference = "dark";
    render(<AppearanceSettingsCard />);
    expect(
      screen
        .getByRole("button", { name: "Sötét" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Világos" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("kattintásra a HELYES értékkel hívja a setPreference-et", () => {
    render(<AppearanceSettingsCard />);
    fireEvent.click(screen.getByRole("button", { name: "Sötét" }));
    expect(theme.setPreference).toHaveBeenCalledWith("dark");

    fireEvent.click(screen.getByRole("button", { name: "Rendszer szerint" }));
    expect(theme.setPreference).toHaveBeenCalledWith("system");
  });
});
