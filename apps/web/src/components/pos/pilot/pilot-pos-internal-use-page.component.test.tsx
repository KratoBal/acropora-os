import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PosInternalUseSummaryResponse, Session } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PilotPosInternalUsePage,
  monthRange,
} from "./pilot-pos-internal-use-page";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const api = vi.hoisted(() => ({ internalUseSummary: vi.fn() }));
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

function summary(
  from: string,
  to: string,
  over: Partial<PosInternalUseSummaryResponse> = {},
): PosInternalUseSummaryResponse {
  return {
    from,
    to,
    recordCount: 2,
    lineCount: 3,
    knownCost: "3000.00",
    unpricedLineCount: 1,
    records: [
      {
        id: "r-2",
        number: "BFH-2",
        note: "kirakat",
        performedByName: "Bolt",
        occurredAt: "2026-11-20T10:00:00.000Z",
        totalCost: null,
        lineCount: 2,
        unpricedLineCount: 1,
      },
      {
        id: "r-1",
        number: "BFH-1",
        note: "műhely, szivattyú-próba",
        performedByName: "Bolt",
        occurredAt: "2026-11-03T10:00:00.000Z",
        totalCost: "2000.00",
        lineCount: 1,
        unpricedLineCount: 0,
      },
    ],
    unpricedLines: [
      {
        internalUseId: "r-2",
        number: "BFH-2",
        occurredAt: "2026-11-20T10:00:00.000Z",
        sku: "KOR-123",
        productName: "Korallragasztó",
        quantity: "1",
        unit: "db",
      },
    ],
    ...over,
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
  api.internalUseSummary.mockReset();
  api.internalUseSummary.mockImplementation(
    async (_token: string, query: { from: string; to: string }) =>
      summary(query.from, query.to),
  );
});

/*
  card ada14a7c. What turns this red: the page not opening on this month so far, "Előző hónap" asking for another span than
  the whole previous month; the unpriced lines not listed apart, or the known value shown as if it were complete; a record
  with a missing price showing a value; an empty period shown as an error; the page asking without orders.view.
*/
describe("PilotPosInternalUsePage", () => {
  it("monthRange gives the whole month, across the year boundary", () => {
    expect(monthRange("2026-11-20", 0)).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(monthRange("2026-01-15", -1)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(monthRange("2028-03-31", -1)).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("opens on this month so far, and 'Előző hónap' asks for the whole previous month", async () => {
    const user = userEvent.setup();
    render(createElement(PilotPosInternalUsePage));
    const today = budapestToday();
    await waitFor(() =>
      expect(api.internalUseSummary).toHaveBeenCalledWith("token-owner", {
        from: `${today.slice(0, 8)}01`,
        to: today,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Előző hónap" }));
    await waitFor(() =>
      expect(api.internalUseSummary).toHaveBeenLastCalledWith(
        "token-owner",
        monthRange(today, -1),
      ),
    );
  });

  it("lists the unpriced lines apart and says the value is without them", async () => {
    render(createElement(PilotPosInternalUsePage));
    expect(
      await screen.findByText("1 tételnek nincs beszerzési ára"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Beszerzési érték (az ár nélküliek nélkül)"),
    ).toBeInTheDocument();
    const unpriced = screen.getByRole("table", {
      name: "Beszerzési ár nélküli tételek",
    });
    expect(within(unpriced).getByText("KOR-123")).toBeInTheDocument();
    expect(within(unpriced).getByText("Korallragasztó")).toBeInTheDocument();
    const records = screen.getByRole("table", { name: "Rögzítések" });
    const kirakat = within(records).getByText("kirakat").closest("tr")!;
    expect(within(kirakat).getByText("1 tétel ár nélkül")).toBeInTheDocument();
    const muhely = within(records)
      .getByText("műhely, szivattyú-próba")
      .closest("tr")!;
    expect(within(muhely).queryByText(/ár nélkül/)).toBeNull();
  });

  it("with every line priced there is no warning and no unpriced table", async () => {
    api.internalUseSummary.mockImplementation(
      async (_token: string, query: { from: string; to: string }) =>
        summary(query.from, query.to, {
          unpricedLineCount: 0,
          unpricedLines: [],
          records: summary(query.from, query.to).records.slice(1),
        }),
    );
    render(createElement(PilotPosInternalUsePage));
    expect(await screen.findByText("Beszerzési érték")).toBeInTheDocument();
    expect(screen.queryByText(/nincs beszerzési ára/)).toBeNull();
    expect(
      screen.queryByRole("table", { name: "Beszerzési ár nélküli tételek" }),
    ).toBeNull();
  });

  it("an empty period says so, not an error", async () => {
    api.internalUseSummary.mockImplementation(
      async (_token: string, query: { from: string; to: string }) =>
        summary(query.from, query.to, {
          recordCount: 0,
          lineCount: 0,
          knownCost: "0.00",
          unpricedLineCount: 0,
          records: [],
          unpricedLines: [],
        }),
    );
    render(createElement(PilotPosInternalUsePage));
    expect(
      await screen.findByText(
        "Ebben az időszakban nem volt belső felhasználás.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Hiba történt")).toBeNull();
  });

  it("shows the API error", async () => {
    api.internalUseSummary.mockRejectedValue(
      new Error("Legfeljebb 93 nap kérdezhető le egyszerre."),
    );
    render(createElement(PilotPosInternalUsePage));
    expect(
      await screen.findByText("Legfeljebb 93 nap kérdezhető le egyszerre."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("refuses without orders.view and makes no API call", () => {
    auth.session = null;
    render(createElement(PilotPosInternalUsePage));
    expect(
      screen.getByText("Nincs hozzáférésed a belső felhasználáshoz"),
    ).toBeInTheDocument();
    expect(api.internalUseSummary).not.toHaveBeenCalled();
  });
});
