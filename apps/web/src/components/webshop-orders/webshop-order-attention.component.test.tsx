import { render, screen, waitFor, within } from "@testing-library/react";
import type { WebshopOrderAttentionResponse } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebshopOrderAttention, waitingText } from "./webshop-order-attention";

/*
  A FIGYELMET KÉRŐ RENDELÉSEK PANELJE (commerce-audit-p1, P1/6). MI PIROSÍT: ha
  a hiányzó bolti rendelés nem jelenik meg a sorok között; ha a sor nem a
  rendelésre mutat; ha a webshop 404-et ad (a végpont még nincs), és mégis megjelenik valami; ha hibát
  ad, és a panel hallgat (egy néma panel "nincs teendő"-nek látszik); ha nincs teendő, és mégis panel áll a lapon; ha a hiba
  elviszi a panelt vagy a listát; ha a perc/óra/nap felirat felcserélődik.
*/
const api = vi.hoisted(() => ({ attention: vi.fn() }));
vi.mock("@/lib/api/webshop-orders", () => ({ webshopOrdersApi: api }));

const RESPONSE: WebshopOrderAttentionResponse = {
  available: true,
  count: 2,
  items: [
    {
      kind: "pickup_missing",
      orderId: "order_1",
      displayId: 57,
      since: "2026-10-27T15:00:00.000Z",
      waiting: 60,
    },
    {
      kind: "pickup_missing",
      orderId: null,
      displayId: null,
      since: "2026-10-27T14:00:00.000Z",
      waiting: 120,
    },
  ],
};

beforeEach(() => {
  api.attention.mockReset();
});

describe("WebshopOrderAttention", () => {
  it("lists each order with its reason and how long it waits, linked to the order when there is one", async () => {
    api.attention.mockResolvedValue(RESPONSE);
    render(<WebshopOrderAttention token="t" />);
    const panel = await screen.findByTestId("figyelem-panel");
    expect(within(panel).getByText(/Figyelmet kér: 2 rendelés/)).toBeTruthy();
    const rows = within(panel).getAllByTestId("figyelem-sor");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("data-kind")).toBe("pickup_missing");
    expect(rows[0]!.textContent).toContain(
      "hiányzik a bolti (élő állatos) rendelés",
    );
    expect(rows[0]!.textContent).toContain("1 órája");
    const link = within(rows[0]!).getByRole("link", { name: "#57" });
    expect(link.getAttribute("href")).toBe("/webshop/rendelesek/order_1");
    // a rendelés nélküli sor is ott van, link nélkül
    expect(rows[1]!.textContent).toContain("2 órája");
    expect(within(rows[1]!).queryByRole("link")).toBeNull();
  });

  it("shows nothing when nothing needs attention", async () => {
    api.attention.mockResolvedValue({ available: true, count: 0, items: [] });
    const { container } = render(<WebshopOrderAttention token="t" />);
    await waitFor(() => expect(api.attention).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("shows nothing at all, not even a grey line, when the webshop does not know the endpoint yet (404)", async () => {
    api.attention.mockResolvedValue({
      available: false,
      reason: "not_found",
      count: 0,
      items: [],
    });
    const { container } = render(<WebshopOrderAttention token="t" />);
    await waitFor(() => expect(api.attention).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("figyelem-nem-elerheto")).toBeNull();
    expect(screen.queryByTestId("figyelem-panel")).toBeNull();
  });

  it("says it cannot read the list when the webshop errors or has no connection, and does not pretend there is nothing to do", async () => {
    api.attention.mockResolvedValue({
      available: false,
      reason: "error",
      count: 0,
      items: [],
    });
    render(<WebshopOrderAttention token="t" />);
    const note = await screen.findByTestId("figyelem-nem-elerheto");
    expect(note.textContent).toContain("Ez nem azt jelenti, hogy nincs teendő");
    expect(screen.queryByTestId("figyelem-panel")).toBeNull();
  });

  it("a failing request to the OS itself becomes the same note, not an error that breaks the page", async () => {
    api.attention.mockRejectedValue(new Error("502"));
    render(<WebshopOrderAttention token="t" />);
    expect(await screen.findByTestId("figyelem-nem-elerheto")).toBeTruthy();
  });

  it("does not ask without a token", async () => {
    render(<WebshopOrderAttention token="" />);
    expect(api.attention).not.toHaveBeenCalled();
  });

  it("writes the wait in minutes, hours or days", () => {
    const pickup = (waiting: number) =>
      waitingText({
        kind: "pickup_missing",
        orderId: null,
        displayId: null,
        since: "x",
        waiting,
      });
    expect(pickup(45)).toBe("45 perce");
    expect(pickup(60)).toBe("1 órája");
    expect(pickup(47 * 60)).toBe("47 órája");
    expect(pickup(72 * 60)).toBe("3 napja");
  });
});
