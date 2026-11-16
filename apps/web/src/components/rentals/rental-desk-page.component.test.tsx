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
import {
  emptyRentalReturnForm,
  rentalReturnRequest,
} from "./rental-return-form";

/*
  WHAT TURNS THIS RED. A new renter sent without phone, e-mail or address; the desk's wall-clock time sent as UTC; a chosen
  existing customer sent as a new one (the register would get a duplicate); the device's deposit not offered when the device
  is picked; a viewer (rentals.view only) shown the recording form; an overdue rental not marked; the contract not opened
  for printing right after the rental is recorded (S3), or a blocked tab passing in silence. The return (S4): a kept deposit sent
  without its reason or over the deposit; a reason sent with nothing kept; a missing multiplier shown as a number instead of
  said; the return offered to a viewer; a cut list shown as if whole.
*/
const api = vi.hoisted(() => ({
  list: vi.fn(),
  availableEquipment: vi.fn(),
  customerMatches: vi.fn(),
  create: vi.fn(),
  contractPdf: vi.fn(),
  returnPreview: vi.fn(),
  returnRental: vi.fn(),
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
  lateFeeMultiplier: null,
  replacementAfterDays: null,
  accessories: null,
  expectedFeeHuf: 2000,
  note: null,
  returnedAt: null,
  settlement: null,
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

describe("the return request", () => {
  it("sends the Budapest wall-clock time as an instant, and nothing kept by default", () => {
    expect(rentalReturnRequest(emptyRentalReturnForm(NOW), 10000)).toEqual({
      ok: true,
      input: { returnedAt: "2026-11-06T09:00:00.000Z", depositKeptHuf: 0 },
    });
  });

  it("needs a reason for a kept amount, never more than the deposit, and drops a reason with nothing kept", () => {
    const form = emptyRentalReturnForm(NOW);
    expect(
      rentalReturnRequest({ ...form, depositKeptHuf: "500" }, 10000).ok,
    ).toBe(false);
    expect(
      rentalReturnRequest(
        { ...form, depositKeptHuf: "10001", depositKeptReason: "sérült" },
        10000,
      ).ok,
    ).toBe(false);
    expect(
      rentalReturnRequest({ ...form, depositKeptHuf: "2,5" }, 10000).ok,
    ).toBe(false);
    expect(
      rentalReturnRequest({ ...form, depositKeptReason: "semmi" }, 10000),
    ).toEqual({
      ok: true,
      input: { returnedAt: "2026-11-06T09:00:00.000Z", depositKeptHuf: 0 },
    });
    expect(
      rentalReturnRequest(
        {
          ...form,
          depositKeptHuf: "2 000",
          depositKeptReason: " törött fedél ",
        },
        10000,
      ),
    ).toEqual({
      ok: true,
      input: {
        returnedAt: "2026-11-06T09:00:00.000Z",
        depositKeptHuf: 2000,
        depositKeptReason: "törött fedél",
      },
    });
  });
});

const printed: string[] = [];

// the desk reads the list twice, by status: the devices out (OPEN) and the returned ones (RETURNED)
type ListAnswer = { items: Rental[]; truncated: boolean };
let openAnswer: ListAnswer = { items: [], truncated: false };
let returnedAnswer: ListAnswer = { items: [], truncated: false };
const openListIs = (answer: ListAnswer) => void (openAnswer = answer);
const openCalls = () =>
  api.list.mock.calls.filter((call) => call[1] === "OPEN").length;

describe("RentalDeskPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.session = session("SALES");
    openAnswer = { items: [], truncated: false };
    returnedAnswer = { items: [], truncated: false };
    api.list.mockImplementation(async (_token: string, status?: string) =>
      status === "RETURNED" ? returnedAnswer : openAnswer,
    );
    api.availableEquipment.mockResolvedValue({ items: [device] });
    api.customerMatches.mockResolvedValue({ items: [known] });
    api.create.mockResolvedValue(rental("2026-11-07T09:00:00.000Z"));
    api.contractPdf.mockResolvedValue(new Blob(["%PDF"]));
    URL.createObjectURL = vi.fn(() => "blob:contract");
    URL.revokeObjectURL = vi.fn();
    printed.length = 0;
    vi.spyOn(window, "open").mockImplementation(() => {
      const tab = new EventTarget() as EventTarget & { print: () => void };
      tab.print = () => void printed.push("print");
      queueMicrotask(() => tab.dispatchEvent(new Event("load")));
      return tab as unknown as Window;
    });
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
    // S3: the contract of the new rental opens and its print dialog starts, at once
    await waitFor(() => expect(printed).toEqual(["print"]));
    expect(api.contractPdf).toHaveBeenCalledWith("token-1", "r-1");
    expect(window.open).toHaveBeenCalledWith("blob:contract", "_blank");
  });

  it("releases the contract's blob URL a minute after opening it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      openListIs({
        items: [rental("2026-11-09T09:00:00.000Z")],
        truncated: false,
      });
      render(<RentalDeskPage now={() => NOW} />);
      fireEvent.click(await screen.findByRole("button", { name: "Szerződés" }));
      await waitFor(() => expect(window.open).toHaveBeenCalled());
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60_000);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:contract");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the browser blocks the contract tab", async () => {
    vi.mocked(window.open).mockReturnValue(null);
    openListIs({
      items: [rental("2026-11-09T09:00:00.000Z")],
      truncated: false,
    });
    render(<RentalDeskPage now={() => NOW} />);

    fireEvent.click(await screen.findByRole("button", { name: "Szerződés" }));

    expect(await screen.findByText(/nem engedte megnyitni/)).toBeTruthy();
    expect(api.contractPdf).toHaveBeenCalledWith("token-1", "r-1");
  });

  it("marks an overdue rental", async () => {
    openListIs({
      items: [rental("2026-11-05T09:00:00.000Z")],
      truncated: false,
    });
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

  it("does not offer the return to a viewer", async () => {
    auth.session = session("VIEWER");
    openListIs({
      items: [rental("2026-11-05T09:00:00.000Z")],
      truncated: false,
    });
    render(<RentalDeskPage now={() => NOW} />);
    expect(await screen.findByText(/lejárt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Visszavétel" })).toBeNull();
  });

  it("says when the list is cut", async () => {
    openListIs({
      items: [rental("2026-11-09T09:00:00.000Z")],
      truncated: true,
    });
    render(<RentalDeskPage now={() => NOW} />);
    expect(await screen.findByText(/A lista nem teljes/)).toBeTruthy();
  });

  it("takes a late device back: says the missing multiplier, sends the kept deposit with its reason", async () => {
    const late = rental("2026-11-03T09:00:00.000Z");
    openListIs({ items: [late], truncated: false });
    api.returnPreview.mockResolvedValue({
      returnedAt: "2026-11-06T09:00:00.000Z",
      settlement: {
        periods: 5,
        feeHuf: 5000,
        latePeriods: 3,
        lateSurchargeHuf: null,
        lateFeeMultiplier: null,
        replacementClaimable: false,
      },
      replacementAfterDays: null,
      depositHuf: 10000,
      replacementValueHuf: 50000,
    });
    api.returnRental.mockResolvedValue({
      ...late,
      status: "RETURNED",
      returnedAt: "2026-11-06T09:00:00.000Z",
      settlement: {
        feeHuf: 5000,
        lateSurchargeHuf: null,
        depositKeptHuf: 2000,
        depositKeptReason: "törött fedél",
      },
    });
    render(<RentalDeskPage now={() => NOW} />);

    fireEvent.click(await screen.findByRole("button", { name: "Visszavétel" }));
    expect(
      await screen.findByText(/nem volt késedelmi szorzó megadva/),
    ).toBeTruthy();
    expect(
      screen.getByText(/pótlási érték: a bérléskor nem volt megadva/),
    ).toBeTruthy();
    expect(api.returnPreview).toHaveBeenCalledWith(
      "token-1",
      "r-1",
      "2026-11-06T09:00:00.000Z",
      expect.any(AbortSignal),
    );

    fireEvent.change(screen.getByLabelText("Visszatartott kaució (Ft)"), {
      target: { value: "2000" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Visszavétel rögzítése" }),
    );
    expect(await screen.findByText(/írd meg az okát/)).toBeTruthy();
    expect(api.returnRental).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("A visszatartás oka"), {
      target: { value: "törött fedél" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Visszavétel rögzítése" }),
    );
    await waitFor(() =>
      expect(api.returnRental).toHaveBeenCalledWith("token-1", "r-1", {
        returnedAt: "2026-11-06T09:00:00.000Z",
        depositKeptHuf: 2000,
        depositKeptReason: "törött fedél",
      }),
    );
    expect(await screen.findByText(/Visszavéve: BER-1/)).toBeTruthy();
    // the list is read again: the device is no longer out
    expect(openCalls()).toBe(2);
  });
});
