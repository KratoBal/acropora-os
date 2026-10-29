import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PosPaymentSummaryResponse, Session } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PilotPosSummaryPage } from "./pilot-pos-summary-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const api = vi.hoisted(() => ({ paymentSummary: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/api/pos", () => ({ posApi: api }));

const ownerSession: Session = {
  id: "session-owner",
  token: "token-owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Acropora Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

const zero = { count: 0, totalGross: "0.00" };

function summary(from: string, to: string): PosPaymentSummaryResponse {
  return {
    from,
    to,
    methods: ["CARD", "CASH", "CASH_DESK"],
    days: [
      {
        date: to,
        byMethod: {
          CARD: { count: 2, totalGross: "30000.00" },
          CASH: zero,
          CASH_DESK: { count: 3, totalGross: "12500.00" },
        },
        total: { count: 5, totalGross: "42500.00" },
      },
    ],
    totals: {
      byMethod: {
        CARD: { count: 2, totalGross: "30000.00" },
        CASH: zero,
        CASH_DESK: { count: 3, totalGross: "12500.00" },
      },
      total: { count: 5, totalGross: "42500.00" },
    },
  };
}

const budapestToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

beforeEach(() => {
  auth.session = ownerSession;
  api.paymentSummary.mockReset();
  api.paymentSummary.mockImplementation(
    async (_token: string, query: { from: string; to: string }) =>
      summary(query.from, query.to),
  );
});

/*
  What turns this red: the default range not being today, the "Utolsó 7 nap"
  button asking for a different span, the Kassza column folded into another
  column or missing, or the table showing no total row.
*/
describe("PilotPosSummaryPage", () => {
  it("opens on today and shows Kassza as its own column with the total row", async () => {
    render(createElement(PilotPosSummaryPage));

    const today = budapestToday();
    await waitFor(() =>
      expect(api.paymentSummary).toHaveBeenCalledWith("token-owner", {
        from: today,
        to: today,
      }),
    );
    const table = await screen.findByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Nap",
      "Kártya",
      "Pénztárgép",
      "Kassza",
      "Összesen",
    ]);
    const totalRow = within(table).getByRole("row", { name: /^Összesen/ });
    expect(totalRow).toHaveTextContent("12 500 Ft");
    expect(totalRow).toHaveTextContent("3 db");
    expect(totalRow).toHaveTextContent("42 500 Ft");
  });

  it("the 7-day button asks for the last seven days ending today", async () => {
    const user = userEvent.setup();
    render(createElement(PilotPosSummaryPage));
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Utolsó 7 nap" }));

    const end = budapestToday();
    const start = new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await waitFor(() =>
      expect(api.paymentSummary).toHaveBeenLastCalledWith("token-owner", {
        from: start,
        to: end,
      }),
    );
  });

  it("shows the API error instead of an empty table", async () => {
    api.paymentSummary.mockRejectedValue(
      new Error("Legfeljebb 93 nap kérdezhető le egyszerre."),
    );
    render(createElement(PilotPosSummaryPage));

    expect(
      await screen.findByText("Legfeljebb 93 nap kérdezhető le egyszerre."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("refuses without orders.view and makes no API call", () => {
    auth.session = null;
    render(createElement(PilotPosSummaryPage));

    expect(
      screen.getByText("Nincs hozzáférésed az összesítőhöz"),
    ).toBeInTheDocument();
    expect(api.paymentSummary).not.toHaveBeenCalled();
  });
});
