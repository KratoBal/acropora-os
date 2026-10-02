import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  MaterialRequestActions,
  MaterialRequestFullDetail,
  MaterialRequestSummary,
  Session,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { MaterialRequestDetail } from "./material-request-detail";
import { MaterialRequestOverviewPage } from "./material-request-overview-page";

const api = vi.hoisted(() => ({
  overview: vi.fn(),
  summary: vi.fn(),
  detail: vi.fn(),
  handlerOptions: vi.fn(),
  claim: vi.fn(),
  order: vi.fn(),
  receiveAll: vi.fn(),
  cancel: vi.fn(),
  receiveItems: vi.fn(),
  reassign: vi.fn(),
  comment: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/material-requests", () => ({ materialRequestsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-beszerzo",
    email: "beszerzo@example.invalid",
    displayName: "Kitalált Beszerző",
    nickname: null,
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

const NO_ACTIONS: MaterialRequestActions = {
  claim: false,
  reassign: false,
  order: false,
  receiveItems: false,
  receive: false,
  cancel: false,
  comment: false,
};

function summary(
  over: Partial<MaterialRequestSummary> = {},
): MaterialRequestSummary {
  return {
    id: "mr-1",
    worksheetId: "w-1",
    status: "OPEN",
    handlerId: null,
    handlerName: null,
    handlerAssignedAt: null,
    orderedAt: null,
    orderedByName: null,
    cancelledAt: null,
    cancelledByName: null,
    note: null,
    neededBy: null,
    priority: null,
    requestedByName: "Kitalált Szerelő",
    createdAt: "2026-10-01T13:40:00.000Z",
    submittedAt: "2026-10-01T13:48:00.000Z",
    receivedAt: null,
    receivedByName: null,
    items: [
      {
        id: "item-1",
        name: "Kitalált könyök",
        quantity: "14",
        unit: "db",
        quantityValue: "14",
        receivedQuantity: null,
        receivedAt: null,
        arrived: false,
      },
      {
        id: "item-2",
        name: "Kitalált tömítés",
        quantity: "kb 10",
        unit: "m",
        quantityValue: null,
        receivedQuantity: null,
        receivedAt: null,
        arrived: false,
      },
    ],
    worksheetNumber: "TST-2026-001",
    customerDisplayName: "Teszt Ügyfél Kft.",
    departmentName: "Teszt részleg",
    ...over,
  } as MaterialRequestSummary;
}

function detail(
  over: Partial<MaterialRequestFullDetail> = {},
): MaterialRequestFullDetail {
  return {
    ...summary(),
    worksheetHref: "/szerviz/munkalapok/w-1",
    events: [
      {
        id: "e1",
        kind: "SUBMITTED",
        fromStatus: "DRAFT",
        toStatus: "OPEN",
        actorName: "Kitalált Szerelő",
        createdAt: "2026-10-01T13:48:00.000Z",
      },
    ],
    comments: [],
    actions: NO_ACTIONS,
    ...over,
  };
}

const now = new Date("2026-10-02T08:00:00.000Z");

beforeEach(() => {
  auth.session = session;
  for (const fn of Object.values(api)) fn.mockReset();
  navigation.push.mockReset();
  api.handlerOptions.mockResolvedValue({ items: [] });
});
afterEach(() => vi.useRealTimers());

describe("anyagigény részletei", () => {
  it("vállalható igényen ott a gomb, és a vállalás a szerver válaszát mutatja", async () => {
    const onChanged = vi.fn();
    api.detail.mockResolvedValue(
      detail({ actions: { ...NO_ACTIONS, claim: true, comment: true } }),
    );
    api.claim.mockResolvedValue(
      detail({
        status: "IN_PROGRESS",
        handlerId: "user-beszerzo",
        handlerName: "Kitalált Beszerző",
        handlerAssignedAt: "2026-10-02T07:59:00.000Z",
      }),
    );
    render(
      <MaterialRequestDetail
        id="mr-1"
        variant="panel"
        now={now}
        onChanged={onChanged}
      />,
    );
    expect(
      await screen.findByText("Még senki nem vállalta a beszerzést"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Én intézem a beszerzést" }),
    );
    expect(await screen.findByText("Ő INTÉZI")).toBeTruthy();
    expect(api.claim).toHaveBeenCalledWith("token-1", "mr-1");
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText("INTÉZÉS ALATT")).toBeTruthy();
  });

  it("vállalási jog nélkül nincs gomb, csak a magyarázat", async () => {
    api.detail.mockResolvedValue(detail());
    render(<MaterialRequestDetail id="mr-1" variant="panel" now={now} />);
    expect(
      await screen.findByText(
        "A beszerzést a beszerzési joggal rendelkező kollégák vállalhatják.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Én intézem a beszerzést" }),
    ).toBeNull();
    expect(screen.queryByText("Beszerzés állapota")).toBeNull();
  });

  it("megrendelt igényen a beérkezés gombjai; a részleges csak a változott tételt küldi", async () => {
    const ordered = detail({
      status: "ORDERED",
      handlerId: "user-beszerzo",
      handlerName: "Kitalált Beszerző",
      actions: { ...NO_ACTIONS, receiveItems: true, receive: true },
    });
    api.detail.mockResolvedValue(ordered);
    api.receiveItems.mockResolvedValue({
      ...ordered,
      status: "PARTIALLY_RECEIVED",
      items: [
        { ...ordered.items[0]!, receivedQuantity: "12" },
        ordered.items[1]!,
      ],
    });
    render(<MaterialRequestDetail id="mr-1" variant="page" now={now} />);
    expect(
      await screen.findByRole("button", { name: "Beérkezett" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Megrendeltem" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Részben beérkezett" }));
    const form = screen.getByRole("form", { name: "Részben beérkezett" });
    const submit = within(form).getByRole("button", { name: "Rögzítés" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(
      within(form).getByLabelText("Kitalált könyök: beérkezett összesen"),
      { target: { value: "12" } },
    );
    fireEvent.click(submit);
    await waitFor(() =>
      expect(api.receiveItems).toHaveBeenCalledWith("token-1", "mr-1", {
        items: [{ itemId: "item-1", receivedQuantity: "12" }],
      }),
    );
    expect(await screen.findByText("12/14 db")).toBeTruthy();
    // the text item stays as written, never a ratio
    expect(screen.getByText("kb 10 m")).toBeTruthy();
  });

  it("a szöveges tétel jelölése 'arrived', szám nélkül", async () => {
    const ordered = detail({
      status: "ORDERED",
      actions: { ...NO_ACTIONS, receiveItems: true },
    });
    api.detail.mockResolvedValue(ordered);
    api.receiveItems.mockResolvedValue(ordered);
    render(<MaterialRequestDetail id="mr-1" variant="page" now={now} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Részben beérkezett" }),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Rögzítés" }));
    await waitFor(() =>
      expect(api.receiveItems).toHaveBeenCalledWith("token-1", "mr-1", {
        items: [{ itemId: "item-2", arrived: true }],
      }),
    );
  });

  it("beérkezett igényen nincs teendő gomb", async () => {
    api.detail.mockResolvedValue(
      detail({
        status: "RECEIVED",
        handlerId: "user-beszerzo",
        handlerName: "Kitalált Beszerző",
      }),
    );
    render(<MaterialRequestDetail id="mr-1" variant="page" now={now} />);
    expect(await screen.findByText("BEÉRKEZETT")).toBeTruthy();
    expect(screen.queryByText("Beszerzés állapota")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Munkalap megnyitása" }),
    ).toBeTruthy();
  });

  it("elvesztett vállalás: az ok látszik, és az igény újra beolvasódik", async () => {
    api.detail
      .mockResolvedValueOnce(
        detail({ actions: { ...NO_ACTIONS, claim: true } }),
      )
      .mockResolvedValueOnce(
        detail({
          status: "IN_PROGRESS",
          handlerId: "user-other",
          handlerName: "Kitalált Kolléga",
        }),
      );
    api.claim.mockRejectedValue(
      new ApiError("Ezt az igényt közben más vállalta.", 409),
    );
    render(<MaterialRequestDetail id="mr-1" variant="panel" now={now} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Én intézem a beszerzést" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Ezt az igényt közben más vállalta.",
    );
    expect(await screen.findByText(/Kitalált Kolléga/)).toBeTruthy();
    expect(api.detail).toHaveBeenCalledTimes(2);
  });

  it("a visszavonás csak megerősítés után megy ki", async () => {
    api.detail.mockResolvedValue(
      detail({ actions: { ...NO_ACTIONS, cancel: true } }),
    );
    api.cancel.mockResolvedValue(detail({ status: "CANCELLED" }));
    render(<MaterialRequestDetail id="mr-1" variant="page" now={now} />);
    fireEvent.click(await screen.findByRole("button", { name: "Visszavonás" }));
    expect(api.cancel).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Visszavonás" }),
    );
    await waitFor(() =>
      expect(api.cancel).toHaveBeenCalledWith("token-1", "mr-1"),
    );
  });

  it("a 404 nem üres oldal, hanem érthető üzenet", async () => {
    api.detail.mockRejectedValue(new ApiError("Not found", 404));
    render(<MaterialRequestDetail id="mr-x" variant="page" now={now} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Az anyagigény nem található, vagy nincs jogosultságod megnézni.",
    );
  });
});

describe("anyagigények áttekintője", () => {
  const counts = {
    open: 3,
    inProgress: 2,
    ordered: 4,
    partiallyReceived: 1,
    receivedLast7Days: 9,
  };

  it("a számlálók és a lista a szerverről jönnek", async () => {
    api.overview.mockResolvedValue({ items: [summary()], nextCursor: null });
    api.summary.mockResolvedValue(counts);
    render(<MaterialRequestOverviewPage />);
    expect(
      await screen.findByText("Teszt Ügyfél Kft. · Teszt részleg"),
    ).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("Nincs felelős")).toBeTruthy();
    expect(api.overview).toHaveBeenCalledWith("token-1", {
      view: "active",
      q: undefined,
    });
  });

  it("hibás számláló '—', nem nulla; hibás lista hiba, nem üres", async () => {
    api.overview.mockRejectedValue(new ApiError("boom", 500));
    api.summary.mockRejectedValue(new ApiError("boom", 500));
    render(<MaterialRequestOverviewPage />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Az anyagigények jelenleg nem tölthetők be.",
    );
    expect(screen.getAllByText("—")).toHaveLength(5);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a szűrők a szerver nézetét kérik, az üres lista a szűrő szövegét mondja", async () => {
    api.overview.mockResolvedValue({ items: [], nextCursor: null });
    api.summary.mockResolvedValue(counts);
    render(<MaterialRequestOverviewPage />);
    expect((await screen.findByRole("status")).textContent).toBe(
      "Nincs aktív anyagigény.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Saját beszerzéseim" }));
    await waitFor(() =>
      expect(api.overview).toHaveBeenLastCalledWith("token-1", {
        view: "mine",
        q: undefined,
      }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "Nincs saját beszerzésed.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Intézés alatt" }));
    await waitFor(() =>
      expect(api.overview).toHaveBeenLastCalledWith("token-1", {
        view: "active",
        status: "IN_PROGRESS",
        q: undefined,
      }),
    );
  });

  it("a keresés rövid szünet után a szerverhez megy", async () => {
    api.overview.mockResolvedValue({ items: [], nextCursor: null });
    api.summary.mockResolvedValue(counts);
    render(<MaterialRequestOverviewPage />);
    await screen.findByRole("status");
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("Keresés"), {
      target: { value: " TST-2026 " },
    });
    expect(api.overview).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    vi.useRealTimers();
    await waitFor(() =>
      expect(api.overview).toHaveBeenLastCalledWith("token-1", {
        view: "active",
        q: "TST-2026",
      }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "Nincs a keresésnek megfelelő anyagigény.",
    );
  });

  it("keskeny képernyőn a kártya a részletek oldalára visz", async () => {
    api.overview.mockResolvedValue({ items: [summary()], nextCursor: null });
    api.summary.mockResolvedValue(counts);
    const real = window.matchMedia.bind(window);
    const spy = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) =>
        query === "(min-width: 1024px)"
          ? ({ ...real(query), matches: false } as MediaQueryList)
          : real(query),
      );
    render(<MaterialRequestOverviewPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Teszt Ügyfél Kft\. · Teszt részleg/,
      }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/szerviz/anyagigenyek/mr-1");
    spy.mockRestore();
  });
});
