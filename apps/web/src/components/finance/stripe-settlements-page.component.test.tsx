import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Session,
  StripePayoutDetail,
  StripePayoutListResponse,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { urlNavigation } from "@/test/url-navigation";

import { StripeSettlementsPage } from "./stripe-settlements-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  approveLine: vi.fn(),
  syncStatus: vi.fn(),
  syncNow: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);
// a lap `PilotThemeRoot` alatt áll (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/api/stripe-settlements", () => ({
  stripeSettlementsApi: api,
}));

function session(role: "OWNER" | "SALES" | "WAREHOUSE"): Session {
  return {
    id: `session-${role}`,
    token: `token-${role}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: role,
      email: `${role.toLowerCase()}@acropora.local`,
      displayName: role,
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

// a payout of two payments: the 4 700 Ft one paired (order #72), the 5 150 Ft one without an invoice yet (order #73),
// and the Stripe fee line that is no order's payment
const payouts: StripePayoutListResponse = {
  items: [
    {
      id: "payout-1",
      stripePayoutId: "po_1",
      arrivalDate: "2026-11-20",
      currency: "huf",
      amount: "9400.50",
      grossTotal: "9850",
      refundTotal: "0",
      feeTotal: "449.50",
      netTotal: "9400.50",
      lineCount: 3,
      resolvedLineCount: 2,
      unresolvedLineCount: 1,
      status: "NEEDS_REVIEW",
      ordersTruncated: false,
      createdAt: "2026-11-21T08:00:00.000Z",
    },
  ],
  pagination: { page: 1, pageSize: 50, totalItems: 1, totalPages: 1 },
};

const detail: StripePayoutDetail = {
  ...payouts.items[0]!,
  lines: [
    {
      id: "line-1",
      stripeTransactionId: "txn_1",
      type: "charge",
      stripeCreatedAt: "2026-11-18T20:27:54.000Z",
      currency: "huf",
      amount: "4700",
      fee: "211.50",
      net: "4488.50",
      paymentIntentId: "pi_3UdFQkRizpJu2fi81GJnQSxI",
      chargeId: "ch_1",
      orderNumbers: ["72"],
      orderTotal: "4700",
      invoiceNumbers: ["ACRW-2026/00600"],
      status: "RESOLVED",
      resolutionSource: "PAYMENT_INTENT",
      updatedAt: "2026-11-21T08:00:00.000Z",
    },
    {
      id: "line-2",
      stripeTransactionId: "txn_2",
      type: "charge",
      stripeCreatedAt: "2026-11-18T20:40:00.000Z",
      currency: "huf",
      amount: "5150",
      fee: "238",
      net: "4912",
      paymentIntentId: "pi_2",
      orderNumbers: ["73"],
      orderTotal: "5150",
      invoiceNumbers: [],
      status: "NEEDS_REVIEW",
      errorCode: "ORDER_NOT_INVOICED",
      updatedAt: "2026-11-21T08:00:01.000Z",
    },
    {
      id: "line-3",
      stripeTransactionId: "txn_3",
      type: "stripe_fee",
      stripeCreatedAt: "2026-11-18T21:00:00.000Z",
      currency: "huf",
      amount: "-0",
      fee: "0",
      net: "0",
      orderNumbers: [],
      invoiceNumbers: [],
      status: "NOT_APPLICABLE",
      updatedAt: "2026-11-21T08:00:02.000Z",
    },
  ],
};

beforeEach(() => {
  urlNavigation.reset("/penzugy/elszamolasok/stripe");
  auth.session = session("OWNER");
  api.list.mockReset().mockResolvedValue(payouts);
  api.detail.mockReset().mockResolvedValue(detail);
  api.syncStatus.mockReset().mockResolvedValue({
    state: "DISABLED_NOT_SET",
    intervalMinutes: 360,
  });
  api.syncNow.mockReset().mockResolvedValue({
    status: "APPLIED",
    trigger: "MANUAL",
    startedAt: "2026-11-21T08:00:00.000Z",
    payoutsSeen: 3,
    payoutsNew: 1,
    payoutsReresolved: 1,
    failedCount: 0,
  });
  api.approveLine.mockReset().mockResolvedValue({
    ...detail,
    status: "COMPLETED",
    unresolvedLineCount: 0,
    resolvedLineCount: 3,
    lines: [
      detail.lines[0]!,
      {
        ...detail.lines[1]!,
        status: "RESOLVED",
        resolutionSource: "MANUAL",
        errorCode: undefined,
        invoiceNumbers: ["ACRW-2026/00610"],
      },
      detail.lines[2]!,
    ],
  });
});

/**
 * A STRIPE ELSZÁMOLÁS OLDALA. MI PIROSÍT: ha a lista nem mutatja a kifizetett összeget, a bruttót, a díjat és a párosítást;
 * ha a számla nélküli rendelés nem a saját okával áll; ha a Stripe-díj sor rendelésnek látszik; ha a jóváhagyás nem a sor
 * verziójával megy; ha a kikapcsolt behúzás oka nem látszik; ha olvasó jogosultsággal jóváhagyás vagy ellenőrzés kínálkozik.
 */
describe("StripeSettlementsPage", () => {
  it("lists each payout with what it paid out, the gross, the fee and the pairing", async () => {
    render(createElement(StripeSettlementsPage));
    const [row] = await screen.findAllByTestId("stripe-kifizetes");
    expect(row).toHaveTextContent("2026. 11. 20.");
    expect(row).toHaveTextContent(/9400,50 Ft/);
    expect(row).toHaveTextContent(/9850 Ft/);
    expect(row).toHaveTextContent(/449,50 Ft/);
    expect(row).toHaveTextContent("2 / 3");
    expect(row).toHaveTextContent("Ellenőrzendő");
    expect(
      screen.getByText(/Stripe-behúzás kapcsolója nincs beállítva/),
    ).toBeInTheDocument();
  });

  it("says the reason on a payout that has one of its own", async () => {
    api.list.mockResolvedValue({
      ...payouts,
      items: [{ ...payouts.items[0]!, errorCode: "TOTAL_MISMATCH" }],
    });
    render(createElement(StripeSettlementsPage));
    const [row] = await screen.findAllByTestId("stripe-kifizetes");
    expect(row).toHaveTextContent(
      "A sorok nettója nem egyezik a kifizetett összeggel",
    );
  });

  it("a manual payout is shown under its own name, not as 'to check'", async () => {
    api.list.mockResolvedValue({
      ...payouts,
      items: [
        {
          ...payouts.items[0]!,
          errorCode: "MANUAL_PAYOUT",
          lineCount: 0,
          resolvedLineCount: 0,
          unresolvedLineCount: 0,
        },
      ],
    });
    render(createElement(StripeSettlementsPage));
    const [row] = await screen.findAllByTestId("stripe-kifizetes");
    expect(row).toHaveTextContent("Kézi kifizetés");
    expect(row).not.toHaveTextContent("Ellenőrzendő");
    expect(row).toHaveTextContent("a Stripe ehhez nem listáz tételeket");
  });

  it("shows each line's order and invoice, why one waits, and a fee as no order's payment", async () => {
    render(createElement(StripeSettlementsPage));
    fireEvent.click((await screen.findAllByTestId("stripe-kifizetes"))[0]!);
    const lines = await screen.findAllByTestId("stripe-sor");
    expect(lines[0]).toHaveTextContent("Fizetés");
    expect(lines[0]).toHaveTextContent("pi_3UdFQkRizpJu2fi81GJnQSxI");
    expect(lines[0]).toHaveTextContent("#72");
    expect(lines[0]).toHaveTextContent("ACRW-2026/00600");
    expect(lines[0]).toHaveTextContent("Párosítva rendelésből");
    expect(lines[1]).toHaveTextContent("#73");
    expect(lines[1]).toHaveTextContent("A rendelésnek még nincs számlája");
    expect(lines[2]).toHaveTextContent("Stripe-díj");
    expect(lines[2]).toHaveTextContent("Nem rendelés");
    expect(
      screen.getByText("1 tétel kézi ellenőrzést kér"),
    ).toBeInTheDocument();
  });

  it("an amount that is not the order's total shows the order's total beside it", async () => {
    api.detail.mockResolvedValue({
      ...detail,
      lines: [
        {
          ...detail.lines[1]!,
          errorCode: "AMOUNT_MISMATCH",
          orderTotal: "5000",
        },
      ],
    });
    render(createElement(StripeSettlementsPage));
    fireEvent.click((await screen.findAllByTestId("stripe-kifizetes"))[0]!);
    const [line] = await screen.findAllByTestId("stripe-sor");
    expect(line).toHaveTextContent("A rendelés végösszege más");
    expect(line).toHaveTextContent(/végösszege 5000 Ft/);
  });

  it("approves a waiting line with the line's version", async () => {
    render(createElement(StripeSettlementsPage));
    fireEvent.click((await screen.findAllByTestId("stripe-kifizetes"))[0]!);
    const input = await screen.findByLabelText("Számlaszám – txn_2");
    fireEvent.change(input, { target: { value: " ACRW-2026/00610 " } });
    fireEvent.click(screen.getByRole("button", { name: "Jóváhagyás" }));
    await waitFor(() =>
      expect(api.approveLine).toHaveBeenCalledWith(
        "token-OWNER",
        "payout-1",
        "line-2",
        {
          invoiceNumber: "ACRW-2026/00610",
          expectedUpdatedAt: "2026-11-21T08:00:01.000Z",
        },
      ),
    );
    expect(
      await screen.findByText(
        "A tétel jóváhagyva, a kifizetés minden sora párosítva.",
      ),
    ).toBeInTheDocument();
  });

  it("an approval cannot be sent without an invoice number: the button waits for one", async () => {
    render(createElement(StripeSettlementsPage));
    fireEvent.click((await screen.findAllByTestId("stripe-kifizetes"))[0]!);
    const input = await screen.findByLabelText("Számlaszám – txn_2");
    const button = screen.getByRole("button", { name: "Jóváhagyás" });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(api.approveLine).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "ACRW-2026/00610" } });
    expect(button).toBeEnabled();
  });

  it("checks Stripe now, and says what the run found", async () => {
    render(createElement(StripeSettlementsPage));
    await screen.findAllByTestId("stripe-kifizetes");
    fireEvent.click(
      screen.getByRole("button", { name: "Stripe ellenőrzése most" }),
    );
    expect(
      await screen.findByText(
        "Stripe ellenőrzés kész: 3 kifizetés, 1 új, 1 újrapárosítva, 0 nem sikerült.",
      ),
    ).toBeInTheDocument();
    expect(api.syncNow).toHaveBeenCalledWith("token-OWNER");
  });

  it("says when the automatic pull runs, and when it last did", async () => {
    api.syncStatus.mockResolvedValue({
      state: "ENABLED",
      intervalMinutes: 360,
      lastScheduledRun: {
        status: "FAILED",
        trigger: "SCHEDULED",
        startedAt: "2026-11-21T08:00:00.000Z",
        payoutsSeen: 0,
        payoutsNew: 0,
        payoutsReresolved: 0,
        failedCount: 0,
        errorCode: "STRIPE_FEED_HTTP_502",
      },
    });
    render(createElement(StripeSettlementsPage));
    expect(
      await screen.findByText(/Automatikus Stripe-behúzás: 360 percenként/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/sikertelen \(STRIPE_FEED_HTTP_502\)/),
    ).toBeInTheDocument();
  });

  // SALES has finance.view and not finance.manage (packages/types auth.ts)
  it("offers no approval and no check to a viewer without finance.manage", async () => {
    auth.session = session("SALES");
    render(createElement(StripeSettlementsPage));
    expect(
      screen.queryByRole("button", { name: "Stripe ellenőrzése most" }),
    ).toBeNull();
    fireEvent.click((await screen.findAllByTestId("stripe-kifizetes"))[0]!);
    await screen.findAllByTestId("stripe-sor");
    expect(screen.queryByRole("button", { name: "Jóváhagyás" })).toBeNull();
  });

  it("tells a user without finance.view that the page is closed", async () => {
    auth.session = session("WAREHOUSE");
    render(createElement(StripeSettlementsPage));
    expect(
      await screen.findByText("Nincs hozzáférésed a Stripe elszámolásokhoz"),
    ).toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });

  it("an empty list says how the first payout arrives", async () => {
    api.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 },
    });
    render(createElement(StripeSettlementsPage));
    expect(
      await screen.findByText("Még nincs Stripe-kifizetés"),
    ).toBeInTheDocument();
  });
  it("sorts by a header: ascending, descending, back to the default, each one a server query", async () => {
    render(createElement(StripeSettlementsPage));
    await screen.findAllByTestId("stripe-kifizetes");
    const lastQuery = () => api.list.mock.calls.at(-1)![1];
    expect(lastQuery()).not.toHaveProperty("sort");

    fireEvent.click(screen.getByRole("button", { name: /Bruttó/ }));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        sort: "grossTotal",
        direction: "asc",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Bruttó/ }));
    await waitFor(() =>
      expect(lastQuery()).toMatchObject({
        sort: "grossTotal",
        direction: "desc",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Bruttó/ }));
    await waitFor(() => expect(lastQuery()).not.toHaveProperty("sort"));
  });

  it("sends the right server field for each sortable header", async () => {
    render(createElement(StripeSettlementsPage));
    await screen.findAllByTestId("stripe-kifizetes");
    for (const [name, field] of [
      ["Kifizetés napja", "arrivalDate"],
      ["Kifizetve", "amount"],
      ["Visszatérítés", "refundTotal"],
      ["Díj", "feeTotal"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() =>
        expect(api.list.mock.calls.at(-1)![1]).toMatchObject({
          sort: field,
          direction: "asc",
        }),
      );
      // a következő oszlop új rendezése növekvőben indul: előbb vissza az alapra két kattintással
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() =>
        expect(api.list.mock.calls.at(-1)![1]).not.toHaveProperty("sort"),
      );
    }
  });

  it("a new sort goes back to the first page", async () => {
    api.list.mockResolvedValue({
      ...payouts,
      pagination: { page: 1, pageSize: 50, totalItems: 120, totalPages: 3 },
    });
    render(createElement(StripeSettlementsPage));
    await screen.findAllByTestId("stripe-kifizetes");
    fireEvent.click(screen.getAllByRole("button", { name: "Következő" })[0]!);
    await waitFor(() =>
      expect(api.list.mock.calls.at(-1)![1]).toMatchObject({ page: 2 }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Díj/ }));
    await waitFor(() =>
      expect(api.list.mock.calls.at(-1)![1]).toMatchObject({
        page: 1,
        sort: "feeTotal",
      }),
    );
  });

  it("the pairing and the state have no sort button", async () => {
    render(createElement(StripeSettlementsPage));
    await screen.findAllByTestId("stripe-kifizetes");
    expect(screen.queryByRole("button", { name: /Párosítva/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Állapot/ })).toBeNull();
  });
});
