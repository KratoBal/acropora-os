import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RentalSettings, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { answered } from "@/test/answered";
import {
  parseDays,
  parseMultiplier,
  RentalContractPage,
} from "./rental-contract-page";

/*
  WHAT TURNS THIS RED. An empty number field sent as 0 instead of null ("not set yet"); a comma decimal refused, or a value
  out of range sent; a template with an unknown place saveable; the reset sending anything but a null template.
*/
const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/rental-settings", () => ({ rentalSettingsApi: api }));

const loaded: RentalSettings = {
  contractTemplate: "Bérlő: {{berlo_nev}}",
  contractTemplateIsDefault: true,
  lateFeeMultiplier: null,
  replacementAfterDays: null,
};

describe("the number fields", () => {
  it("read a comma decimal, empty as null, and refuse the rest", () => {
    expect(parseMultiplier("1,5")).toBe(1.5);
    expect(parseMultiplier(" ")).toBeNull();
    for (const bad of ["0", "1,255", "11", "abc"])
      expect(parseMultiplier(bad), bad).toBeUndefined();
    expect(parseDays("14")).toBe(14);
    expect(parseDays("")).toBeNull();
    for (const bad of ["0", "2,5", "400"])
      expect(parseDays(bad), bad).toBeUndefined();
  });
});

describe("RentalContractPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = {
      id: "s",
      token: "token-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u",
        email: "balazs@acropora.local",
        displayName: "Balázs",
        role: "OWNER",
        customerId: null,
        supplierId: null,
      },
    };
    api.get.mockResolvedValue(loaded);
    api.save.mockImplementation(async (_token, input) => ({
      ...loaded,
      ...input,
      contractTemplate: input.contractTemplate ?? loaded.contractTemplate,
    }));
  });

  it("saves the text with nulls for the empty numbers", async () => {
    render(<RentalContractPage />);
    const text = await screen.findByLabelText("A szerződés szövege");
    await waitFor(() =>
      expect((text as HTMLTextAreaElement).value).toBe("Bérlő: {{berlo_nev}}"),
    );

    fireEvent.change(screen.getByLabelText("Késedelmi szorzó"), {
      target: { value: "1,5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith("token-1", {
        contractTemplate: "Bérlő: {{berlo_nev}}",
        lateFeeMultiplier: 1.5,
        replacementAfterDays: null,
      }),
    );
  });

  it("blocks saving a text with an unknown place, and resets with a null text", async () => {
    render(<RentalContractPage />);
    const text = await screen.findByLabelText("A szerződés szövege");
    // the field is there before the saved text is: typing first would be overwritten by the late answer
    await answered(api.get);
    fireEvent.change(text, { target: { value: "Hely: {{kelt_hely}}" } });

    expect(
      await screen.findByText(/nem ismeri: \{\{kelt_hely\}\}/),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Mentés" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Alapszöveg visszaállítása" }),
    );
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith("token-1", {
        contractTemplate: null,
        lateFeeMultiplier: null,
        replacementAfterDays: null,
      }),
    );
  });
});
