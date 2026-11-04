import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  BankTransferCreditView,
  Session,
  UserRole,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  check: vi.fn(),
  pair: vi.fn(),
}));
vi.mock("@/lib/api/bank-transfers", () => ({ bankTransfersApi: api }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/penzugy/atutalasok",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));

import { BankTransfersPage } from "./bank-transfers-page";

/*
  A BANKI ÁTUTALÁSOK LAP (kártya aeddb2c3, 3. szelet). MI PIROSÍT: ha egy beírt, egy egyező vagy egy elutasított
  jóváírás nem a saját állapotát mutatja; ha a beírás ellenőrzés nélkül, vagy egy MÁSIK szöveg ellenőrzése után
  indítható; ha elutasított ellenőrzés után indítható; ha nem a beírt szöveget küldi; ha a beírás után nem olvas újra;
  ha kiállítási jog nélkül is van Párosítás gomb.
*/
function as(role: UserRole): Session {
  return {
    id: "s",
    token: "t",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "u",
      email: "u@acropora.local",
      displayName: "U",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

const credit = (
  over: Partial<BankTransferCreditView> = {},
): BankTransferCreditView => ({
  id: "bt-1",
  day: "2026-11-04",
  amount: "100000.00",
  currency: "HUF",
  narrative: "szla 83 84 85 86",
  counterpartyName: "Állatkert",
  decision: {
    markable: false,
    refusal: "NO_REFERENCE",
    reason: "Nem találok saját számlaszámot a megadott szövegben.",
    detail: "",
  },
  written: [],
  ...over,
});

beforeEach(() => {
  auth.session = as("OWNER");
  api.list.mockReset();
  api.check.mockReset();
  api.pair.mockReset();
});

describe("BankTransfersPage", () => {
  it("shows each credit's state: written, matching, or needing a person", async () => {
    api.list.mockResolvedValue([
      credit({ id: "w", written: ["ACRW-2026/00084"] }),
      credit({
        id: "m",
        decision: { markable: true, marks: [], paidBefore: [] },
      }),
      credit({ id: "r" }),
    ]);
    render(<BankTransfersPage />);
    expect(
      await screen.findByText("Beírva: ACRW-2026/00084"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Egyezik: a napi futás beírja"),
    ).toBeInTheDocument();
    expect(screen.getByText("Kézi párosítás kell")).toBeInTheDocument();
    // the written one has no pairing button
    expect(screen.getAllByRole("button", { name: "Párosítás" })).toHaveLength(
      2,
    );
  });

  it("writes only after a matching check of the same text, sends that text, and reads again", async () => {
    api.list.mockResolvedValue([credit()]);
    api.check.mockResolvedValue({
      markable: true,
      marks: [
        { invoiceNumber: "ACRW-2026/00084", amount: "20000.00" },
        { invoiceNumber: "ACRW-2026/00085", amount: "30000.00" },
      ],
      paidBefore: ["ACRW-2026/00083"],
    });
    api.pair.mockResolvedValue({
      lines: [
        { invoiceNumber: "ACRW-2026/00084", outcome: "WRITTEN" },
        { invoiceNumber: "ACRW-2026/00085", outcome: "WRITTEN" },
      ],
    });
    render(<BankTransfersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Párosítás" }));
    const write = screen.getByRole("button", {
      name: "Beírás a Számlázz.hu-ba",
    });
    expect(write).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Számlaszámok/), {
      target: { value: "2026/00083-86" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ellenőrzés" }));
    expect(await screen.findByTestId("bank-transfer-marks")).toHaveTextContent(
      "ACRW-2026/00084",
    );
    expect(
      screen.getByText(/nem írom újra: ACRW-2026\/00083/),
    ).toBeInTheDocument();
    expect(write).toBeEnabled();
    // another text than the one checked: no write until it is checked
    fireEvent.change(screen.getByLabelText(/Számlaszámok/), {
      target: { value: "2026/00083-87" },
    });
    expect(write).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Számlaszámok/), {
      target: { value: "2026/00083-86" },
    });
    expect(write).toBeEnabled();
    fireEvent.click(write);
    fireEvent.click(await screen.findByRole("button", { name: "Lezárom" }));
    await waitFor(() =>
      expect(api.pair).toHaveBeenCalledWith("t", "bt-1", "2026/00083-86"),
    );
    expect(
      await screen.findByText(/Beírva: ACRW-2026\/00084, ACRW-2026\/00085/),
    ).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("a refused check says why, and offers no write", async () => {
    api.list.mockResolvedValue([credit()]);
    api.check.mockResolvedValue({
      markable: false,
      refusal: "AMOUNT_MISMATCH",
      reason:
        "Az összeg nem egyezik a számlák nyitott összegével, ezért nem írom be.",
      detail: "utalt 100000.00, várt 50000.00",
    });
    render(<BankTransfersPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Párosítás" }));
    fireEvent.click(screen.getByRole("button", { name: "Ellenőrzés" }));
    expect(
      await screen.findByText(/utalt 100000\.00, várt 50000\.00/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Beírás a Számlázz.hu-ba" }),
    ).toBeDisabled();
  });

  it("without the issue right there is no pairing button", async () => {
    auth.session = as("VIEWER");
    api.list.mockResolvedValue([credit()]);
    render(<BankTransfersPage />);
    await screen.findByText("Kézi párosítás kell");
    expect(screen.queryByRole("button", { name: "Párosítás" })).toBeNull();
  });
});
