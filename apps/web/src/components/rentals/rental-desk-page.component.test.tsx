import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Rental,
  RentalCustomerSummary,
  RentalEquipment,
  Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RentalDeskPage } from "./rental-desk-page";
import { emptyRentalForm, rentalRequest, type RentalForm } from "./rental-form";

/*
  WHAT TURNS THIS RED. A new renter sent without phone, e-mail or address; the desk's wall-clock time sent as UTC; a chosen
  existing customer sent as a new one (the register would get a duplicate); the device's deposit not offered when the device
  is picked; a viewer (rentals.view only) shown the recording form; an overdue rental not marked.
*/
const api = vi.hoisted(() => ({
  list: vi.fn(),
  availableEquipment: vi.fn(),
  customerMatches: vi.fn(),
  create: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/rentals", () => ({ rentalsApi: api }));

const session = (role: "SALES" | "VIEWER"): Session => ({
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "pult@acropora.local",
    displayName: "Pult",
    role,
    customerId: null,
    supplierId: null,
  },
});

const device: RentalEquipment = {
  id: "eq-1",
  name: "Ozmózis víztisztító",
  serialNumber: "SN-1",
  dailyFeeHuf: 2500,
  depositHuf: 30000,
  replacementValueHuf: 120000,
  accessories: null,
  note: null,
  isActive: true,
};

const known: RentalCustomerSummary = {
  id: "c-1",
  customerNumber: "VEVO-1",
  displayName: "Kiss Anna",
  phone: "+36 30 123 4567",
  email: "anna@example.com",
  address: "1111 Budapest, Fő utca 1.",
};

const rental = (plannedReturnAt: string): Rental => ({
  id: "r-1",
  rentalNumber: "BER-1",
  status: "OPEN",
  equipment: { id: "eq-9", name: "Párásító", serialNumber: null },
  customer: known,
  startsAt: "2026-11-01T09:00:00.000Z",
  plannedReturnAt,
  dailyFeeHuf: 1000,
  depositHuf: 10000,
  replacementValueHuf: 50000,
  accessories: null,
  expectedFeeHuf: 2000,
  note: null,
  returnedAt: null,
  createdAt: "2026-11-01T09:00:00.000Z",
});

// 2026-11-06 10:00 Budapest (winter time, UTC+1)
const NOW = new Date("2026-11-06T09:00:00.000Z");

const typed: RentalForm = {
  ...emptyRentalForm(NOW),
  equipmentId: "eq-1",
  name: " Kiss Béla ",
  phone: "06 30 555 1234",
  email: "bela@example.com",
  postalCode: "1111",
  city: "Budapest",
  line1: "Fő utca 2.",
};

describe("the rental request", () => {
  it("starts now on the Budapest clock and ends 24 hours later", () => {
    const form = emptyRentalForm(NOW);
    expect(form.startsAt).toBe("2026-11-06T10:00");
    expect(form.plannedReturnAt).toBe("2026-11-07T10:00");
  });

  it("sends a complete new renter and the times as instants", () => {
    expect(rentalRequest(typed, null)).toEqual({
      ok: true,
      input: {
        equipmentId: "eq-1",
        newCustomer: {
          type: "PERSON",
          displayName: "Kiss Béla",
          email: "bela@example.com",
          phone: "06 30 555 1234",
          address: {
            postalCode: "1111",
            city: "Budapest",
            line1: "Fő utca 2.",
          },
        },
        startsAt: "2026-11-06T09:00:00.000Z",
        plannedReturnAt: "2026-11-07T09:00:00.000Z",
      },
    });
  });

  it("names the missing renter field, and refuses a return before the start", () => {
    for (const key of [
      "phone",
      "email",
      "postalCode",
      "city",
      "line1",
    ] as const)
      expect(rentalRequest({ ...typed, [key]: " " }, null).ok, key).toBe(false);
    expect(
      rentalRequest({ ...typed, plannedReturnAt: typed.startsAt }, null).ok,
    ).toBe(false);
  });

  it("sends only the id of a chosen customer, whatever is typed", () => {
    const request = rentalRequest({ ...typed, phone: "" }, known);
    expect(request.ok && request.input.customerId).toBe("c-1");
    expect(request.ok && request.input.newCustomer).toBeUndefined();
  });
});

describe("RentalDeskPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session("SALES");
    api.list.mockResolvedValue({ items: [] });
    api.availableEquipment.mockResolvedValue({ items: [device] });
    api.customerMatches.mockResolvedValue({ items: [known] });
    api.create.mockResolvedValue(rental("2026-11-07T09:00:00.000Z"));
  });

  it("offers the device's deposit and the fee, and records with a chosen customer", async () => {
    render(<RentalDeskPage now={() => NOW} />);

    await screen.findByRole("option", { name: /Ozmózis víztisztító/ });
    fireEvent.change(screen.getByLabelText("Eszköz"), {
      target: { value: "eq-1" },
    });
    expect(
      (screen.getByLabelText("Kaució (Ft)") as HTMLInputElement).value,
    ).toBe("30000");
    expect(screen.getByText(/1 × 2\s?500 Ft = 2\s?500 Ft/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Telefon"), {
      target: { value: "+36 30 123 4567" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Ezt választom" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Bérlés rögzítése" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith("token-1", {
      equipmentId: "eq-1",
      customerId: "c-1",
      startsAt: "2026-11-06T09:00:00.000Z",
      plannedReturnAt: "2026-11-07T09:00:00.000Z",
      depositHuf: 30000,
    });
    expect(await screen.findByText(/Bérlés rögzítve: BER-1/)).toBeTruthy();
  });

  it("marks an overdue rental", async () => {
    api.list.mockResolvedValue({ items: [rental("2026-11-05T09:00:00.000Z")] });
    render(<RentalDeskPage now={() => NOW} />);
    expect(await screen.findByText(/lejárt/)).toBeTruthy();
  });

  it("shows a viewer the list but not the form", async () => {
    auth.session = session("VIEWER");
    render(<RentalDeskPage now={() => NOW} />);
    expect(await screen.findByText("Kint lévő eszközök")).toBeTruthy();
    expect(screen.queryByText("Új bérlés")).toBeNull();
    expect(api.availableEquipment).not.toHaveBeenCalled();
  });
});
