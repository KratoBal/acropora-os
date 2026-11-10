import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Rental } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RentalReturnedList,
  rentalMatches,
  settlementLine,
} from "./rental-returned-list";

/*
  WHAT TURNS THIS RED (Balázs, 2026-11-10 14:16 UTC, msg 1569717440554860576: the returned rentals vanished after the return).
  The returned list not read by its own status; a row without its dates, fee or deposit settlement; a surcharge or a kept deposit
  left out of the line, or the kept deposit's reason; a rental returned before the settlement existed shown with invented numbers;
  the search missing the contract number, the device or the renter; the contract not printable from the list; the list not
  read again after a return.
*/
const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/lib/api/rentals", () => ({ rentalsApi: api }));

const returned = (over: Partial<Rental> = {}): Rental => ({
  id: "r-1",
  rentalNumber: "BER-7",
  status: "RETURNED",
  equipment: { id: "eq-1", name: "Ozmózis víztisztító", serialNumber: "SN-9" },
  customer: {
    id: "c-1",
    customerNumber: "VEVO-1",
    displayName: "Kiss Anna",
    phone: "+36 30 123 4567",
    email: "anna@example.com",
    address: null,
  },
  startsAt: "2026-11-01T09:00:00.000Z",
  plannedReturnAt: "2026-11-03T09:00:00.000Z",
  dailyFeeHuf: 2000,
  depositHuf: 30000,
  replacementValueHuf: 120000,
  lateFeeMultiplier: 1.5,
  replacementAfterDays: null,
  accessories: null,
  expectedFeeHuf: 4000,
  note: null,
  returnedAt: "2026-11-05T10:00:00.000Z",
  settlement: {
    feeHuf: 10000,
    lateSurchargeHuf: 3000,
    depositKeptHuf: 5000,
    depositKeptReason: "hiányzó tömlő",
  },
  createdAt: "2026-11-01T09:00:00.000Z",
  ...over,
});

describe("the returned rental's line", () => {
  it("names the fee with its surcharge, and the kept deposit with its reason and what went back", () => {
    const line = settlementLine(returned());
    expect(line).toMatch(
      /Díj: 13\s?000 Ft \(ebből késedelmi pótdíj 3\s?000 Ft\)/,
    );
    expect(line).toMatch(
      /kaucióból visszatartva 5\s?000 Ft \(hiányzó tömlő\), visszajárt 25\s?000 Ft/,
    );
  });

  it("says the whole deposit went back when nothing was kept, and invents nothing for an old return", () => {
    expect(
      settlementLine(
        returned({
          settlement: {
            feeHuf: 4000,
            lateSurchargeHuf: 0,
            depositKeptHuf: 0,
            depositKeptReason: null,
          },
        }),
      ),
    ).toMatch(
      /^Díj: 4\s?000 Ft · kaució teljes egészében visszajárt \(30\s?000 Ft\)$/,
    );
    expect(settlementLine(returned({ settlement: null }))).toMatch(
      /Elszámolás nincs rögzítve/,
    );
  });

  it("the search matches the contract number, the device and the renter, case ignored", () => {
    for (const q of ["ber-7", "ozmózis", "SN-9", "kiss", "30 123", "ANNA@"])
      expect(rentalMatches(returned(), q), q).toBe(true);
    expect(rentalMatches(returned(), "párásító")).toBe(false);
    expect(rentalMatches(returned(), "  ")).toBe(true);
  });
});

describe("RentalReturnedList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({
      items: [
        returned(),
        returned({
          id: "r-2",
          rentalNumber: "BER-8",
          equipment: { id: "eq-2", name: "Párásító", serialNumber: null },
        }),
      ],
      truncated: false,
    });
  });

  it("reads the RETURNED rentals and prints a contract again from a row", async () => {
    const printed: string[] = [];
    render(
      <RentalReturnedList
        token="t"
        reloadKey={0}
        onPrint={(r) => void printed.push(r.id)}
      />,
    );
    expect(await screen.findByText(/BER-7 · Ozmózis víztisztító/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith(
      "t",
      "RETURNED",
      expect.any(AbortSignal),
    );
    expect(screen.getAllByText(/visszahozva:/)).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Szerződés" })[0]!);
    expect(printed).toEqual(["r-1"]);
  });

  it("filters by the search, and says when nothing matches", async () => {
    render(
      <RentalReturnedList token="t" reloadKey={0} onPrint={() => undefined} />,
    );
    await screen.findByText(/BER-8/);
    fireEvent.change(
      screen.getByLabelText("Keresés a visszahozott bérlések között"),
      { target: { value: "párásító" } },
    );
    expect(screen.queryByText(/BER-7/)).toBeNull();
    expect(screen.getByText(/BER-8/)).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText("Keresés a visszahozott bérlések között"),
      { target: { value: "nincs ilyen" } },
    );
    expect(
      screen.getByText("Nincs a keresésnek megfelelő bérlés."),
    ).toBeTruthy();
  });

  it("reads the list again when a return bumps the key, and says when it is cut", async () => {
    api.list.mockResolvedValue({ items: [returned()], truncated: true });
    const view = render(
      <RentalReturnedList token="t" reloadKey={0} onPrint={() => undefined} />,
    );
    expect(await screen.findByText(/A lista nem teljes/)).toBeTruthy();
    view.rerender(
      <RentalReturnedList token="t" reloadKey={1} onPrint={() => undefined} />,
    );
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
});
