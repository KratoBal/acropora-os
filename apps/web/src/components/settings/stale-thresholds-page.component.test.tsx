import { fireEvent, render, screen } from "@testing-library/react";
import { WEBSHOP_STALE_THRESHOLD_DEFAULTS } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StaleThresholdsPage } from "./stale-thresholds-page";

/*
  AZ ELAVULÁSI KÜSZÖBÖK OLDALA (a prompt 17. pontja). MI PIROSÍT: a
  kikapcsolás elveszi az értéket; nulla menthető; a mentés nem a szerkesztett
  sorokat küldi; csak olvasási joggal szerkeszthető vagy menthető.
*/
const api = vi.hoisted(() => ({
  staleThresholds: vi.fn(),
  saveStaleThresholds: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "WAREHOUSE" }));
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
vi.mock("@/lib/api/webshop-orders", () => ({ webshopOrdersApi: api }));

beforeEach(() => {
  auth.role = "OWNER";
  api.staleThresholds.mockReset();
  api.saveStaleThresholds.mockReset();
  api.staleThresholds.mockResolvedValue(
    WEBSHOP_STALE_THRESHOLD_DEFAULTS.map((row) => ({ ...row })),
  );
});

describe("StaleThresholdsPage", () => {
  it("switching a status off keeps its value; saving sends the edited rows", async () => {
    api.saveStaleThresholds.mockImplementation(async (_token, rows) => rows);
    render(createElement(StaleThresholdsPage));
    const off = await screen.findByLabelText("Készletezés alatt: figyelés");
    fireEvent.click(off);
    expect(
      (screen.getByLabelText("Készletezés alatt: érték") as HTMLInputElement)
        .value,
    ).toBe("8");
    fireEvent.change(screen.getByLabelText("Kiszállítás: érték"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));
    expect(await screen.findByText("Mentve.")).toBeTruthy();
    expect(api.saveStaleThresholds).toHaveBeenCalledWith("token", [
      { status: "pending_processing", value: 4, unit: "HOUR", enabled: true },
      { status: "stocking", value: 8, unit: "HOUR", enabled: false },
      { status: "out_for_delivery", value: 2, unit: "DAY", enabled: true },
      { status: "ready_for_pickup", value: 5, unit: "DAY", enabled: true },
    ]);
  });

  it("zero is not a value: the save waits, and says the switch is for that", async () => {
    render(createElement(StaleThresholdsPage));
    fireEvent.change(await screen.findByLabelText("Feldolgozásra vár: érték"), {
      target: { value: "0" },
    });
    expect(screen.getByText(/legalább 1/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Mentés" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("with orders.view only, it reads but does not edit or save", async () => {
    auth.role = "WAREHOUSE";
    render(createElement(StaleThresholdsPage));
    expect(
      (
        (await screen.findByLabelText(
          "Feldolgozásra vár: érték",
        )) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Mentés" })).toBeNull();
  });
});
