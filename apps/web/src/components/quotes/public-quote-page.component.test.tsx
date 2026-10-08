import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PublicQuoteDto } from "@acropora/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicQuotePage } from "./public-quote-page";

// the page font is a build-time asset
vi.mock("next/font/local", () => ({
  default: () => ({ className: "font", variable: "font" }),
}));

const page = (over: Partial<PublicQuoteDto> = {}): PublicQuoteDto => ({
  quoteNumber: "AJ-2026-0007",
  title: "Tengeri akvárium",
  versionNumber: 2,
  validUntil: "2099-12-31",
  currency: "HUF",
  priceDisplay: "NET",
  customerName: "Kovács Anna",
  items: [
    {
      id: null,
      name: "Akvárium",
      quantity: "1",
      unit: "db",
      unitNetPrice: "100000.00",
      vatRatePercent: "27",
      netTotal: "100000.00",
      isOptional: false,
    },
    {
      id: "opt-1",
      name: "Fedőlap",
      quantity: "1",
      unit: "db",
      unitNetPrice: "20000.00",
      vatRatePercent: "27",
      netTotal: "20000.00",
      isOptional: true,
    },
  ],
  netTotal: "100000.00",
  optionalNetTotal: "20000.00",
  state: "OPEN",
  acceptedAt: null,
  ...over,
});

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("Az elfogadó link oldala (#1582 P4b)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a kért opcióval, a megadott névvel, egy kérés-azonosítóval fogad el", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, page()))
      .mockResolvedValueOnce(
        reply(200, page({ state: "ACCEPTED", acceptedAt: "2026-10-08" })),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicQuotePage token="tok-123" />);
    expect(await screen.findByText("Tengeri akvárium")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Elfogadom" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Fedőlap/ }));
    fireEvent.change(screen.getByLabelText("A neved"), {
      target: { value: "  Kovács Anna  " },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Elfogadom az ajánlatot/ }),
    );
    fireEvent.click(button);
    expect(await screen.findByText(/az ajánlatot elfogadtad/)).toBeTruthy();
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe("/api/public/quotes/tok-123/accept");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      name: "Kovács Anna",
      selectedOptionalItemIds: ["opt-1"],
    });
    expect(typeof body.requestId).toBe("string");
  });

  it("egy nem működő link a szerver mondatát mutatja", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          reply(404, { message: "Ez az ajánlat-link nem érvényes." }),
        ),
    );
    render(<PublicQuotePage token="nincs" />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Ez az ajánlat-link nem érvényes.",
      ),
    );
  });
});
