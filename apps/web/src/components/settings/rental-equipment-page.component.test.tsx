import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { RentalEquipment, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseHufInput, rentalEquipmentPayload } from "./rental-equipment-form";
import { RentalEquipmentPage } from "./rental-equipment-page";

/*
  WHAT TURNS THIS RED. An amount typed with a thousands space ("30 000") refused, or a decimal / negative / empty one sent
  (as 0 or NaN); a blank serial sent as "" instead of null (the second device without a serial would collide); the page
  asking for the list without the retired devices (they would look deleted); an edit that POSTs a new device instead of
  PATCHing the one being edited; retiring done with anything but `isActive: false`.
*/
const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/rental-equipment", () => ({ rentalEquipmentApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const device: RentalEquipment = {
  id: "eq-1",
  name: "Ozmózis víztisztító",
  serialNumber: "SN-1",
  dailyFeeHuf: 2500,
  depositHuf: 30000,
  replacementValueHuf: 120000,
  accessories: "tápegység",
  note: null,
  isActive: true,
};

const typed = {
  name: " Ozmózis víztisztító ",
  serialNumber: "  ",
  dailyFeeHuf: "2500",
  depositHuf: "30 000",
  replacementValueHuf: "120000",
  accessories: "",
  note: "",
};

describe("the form helpers", () => {
  it("reads whole forints, grouped or not, and refuses everything else", () => {
    expect(parseHufInput("30 000")).toBe(30000);
    expect(parseHufInput("0")).toBe(0);
    for (const bad of ["", " ", "2,5", "2.5", "-1", "1e3", "abc", "100000001"])
      expect(parseHufInput(bad), bad).toBeNull();
  });

  it("builds the request with trimmed name and null for blank texts", () => {
    expect(rentalEquipmentPayload(typed)).toEqual({
      ok: true,
      input: {
        name: "Ozmózis víztisztító",
        serialNumber: null,
        dailyFeeHuf: 2500,
        depositHuf: 30000,
        replacementValueHuf: 120000,
        accessories: null,
        note: null,
      },
    });
  });

  it("names the wrong field instead of sending it", () => {
    const result = rentalEquipmentPayload({ ...typed, depositHuf: "3,5" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/^Kaució:/);
    expect(rentalEquipmentPayload({ ...typed, name: "  " }).ok).toBe(false);
  });
});

describe("RentalEquipmentPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session;
    api.list.mockResolvedValue({ items: [device] });
    api.create.mockResolvedValue(device);
    api.update.mockResolvedValue(device);
  });

  it("lists the retired devices too, with the amounts formatted", async () => {
    render(<RentalEquipmentPage />);

    expect(await screen.findByText(/Ozmózis víztisztító · SN-1/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith("token-1", true, expect.anything());
    expect(screen.getByText(/30\s000 Ft/)).toBeTruthy();
  });

  it("creates a new device from the form", async () => {
    render(<RentalEquipmentPage />);
    await screen.findByText(/SN-1/);

    for (const [label, value] of [
      ["Név", "Párásító"],
      ["Napi bérleti díj (Ft)", "1000"],
      ["Kaució (Ft)", "10 000"],
      ["Pótlási érték (Ft)", "50000"],
    ] as const)
      fireEvent.change(screen.getByLabelText(label), {
        target: { value },
      });
    fireEvent.click(screen.getByRole("button", { name: "Felvétel" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith("token-1", {
      name: "Párásító",
      serialNumber: null,
      dailyFeeHuf: 1000,
      depositHuf: 10000,
      replacementValueHuf: 50000,
      accessories: null,
      note: null,
    });
    expect(api.update).not.toHaveBeenCalled();
  });

  it("edits the chosen device with a PATCH, and retires with isActive false", async () => {
    render(<RentalEquipmentPage />);
    await screen.findByText(/SN-1/);

    fireEvent.click(screen.getByRole("button", { name: "Szerkesztés" }));
    fireEvent.change(screen.getByLabelText("Napi bérleti díj (Ft)"), {
      target: { value: "3000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(
      "token-1",
      "eq-1",
      expect.objectContaining({ dailyFeeHuf: 3000, accessories: "tápegység" }),
    );
    expect(api.create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Kivezetés" }));
    await waitFor(() =>
      expect(api.update).toHaveBeenLastCalledWith("token-1", "eq-1", {
        isActive: false,
      }),
    );
  });

  it("shows the form's error and sends nothing on a bad amount", async () => {
    render(<RentalEquipmentPage />);
    await screen.findByText(/SN-1/);

    fireEvent.change(screen.getByLabelText("Név"), {
      target: { value: "Párásító" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Felvétel" }));

    expect(await screen.findByText(/^Napi bérleti díj:/)).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });
});
