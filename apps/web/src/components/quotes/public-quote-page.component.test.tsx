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
      replacesName: null,
      alternativeOf: null,
      replaced: false,
      chosen: false,
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
      replacesName: null,
      alternativeOf: null,
      replaced: false,
      chosen: false,
    },
  ],
  netTotal: "100000.00",
  optionalNetTotal: "20000.00",
  netTotalWithOptionals: "120000.00",
  hasAlternatives: false,
  acceptedNetTotal: null,
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

  it("a nettó összeg mellett ott áll, hogy + ÁFA", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(200, page())));
    render(<PublicQuotePage token="tok-123" />);
    expect(
      await screen.findByText(/Nettó összesen:\s*100\s000 Ft \+ ÁFA/),
    ).toBeTruthy();
  });

  /*
    AZ OPCIONÁLIS TÉTELEK KÜLÖN (kártya 2540d9d4, Luca 2026-11-26). MI PIROSÍT: az opcionális tétel a kínált tételek között áll
    (a régi lista), a csoport nem mondja ki, hogy nem része a végösszegnek, a tétel nem viseli a címkét, vagy a végösszeg alatt nincs
    ott az opcionálisokkal együtt számolt összeg (vagy opció nélküli ajánlaton mégis ott van).
  */
  it("az opcionális tétel külön csoportban, címkével, és a végösszeg alatt az opcionálisokkal együtt", async () => {
    // the option FIRST in the list: the group must still come after the offered item
    const [offered, option] = page().items;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          reply(200, page({ items: [option!, offered!] })),
        ),
    );
    render(<PublicQuotePage token="tok-123" />);
    const group = await screen.findByRole("heading", {
      name: "Opcionális tételek",
    });
    const rows = screen.getAllByTestId("quote-item-row");
    expect(rows.map((row) => row.textContent?.includes("Fedőlap"))).toEqual([
      false,
      true,
    ]);
    // the heading stands between the offered row and the option
    expect(
      rows[0]!.compareDocumentPosition(group) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      group.compareDocumentPosition(rows[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/Nem részei a végösszegnek\./)).toBeTruthy();
    expect(rows[1]!.textContent).toContain("Opcionális · kiegészítés");
    expect(rows[0]!.textContent).not.toContain("Opcionális");
    expect(
      screen.getByText(
        /Az opcionális tételekkel együtt:\s*120\s000 Ft\s*\+ ÁFA/,
      ),
    ).toBeTruthy();
  });

  it("opció nélkül nincs opcionális csoport és nincs együttes összeg", async () => {
    const [offered] = page().items;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          reply(200, page({ items: [offered!], optionalNetTotal: "0.00" })),
        ),
    );
    render(<PublicQuotePage token="tok-123" />);
    await screen.findByText(/Nettó összesen:/);
    expect(screen.queryByText("Opcionális tételek")).toBeNull();
    expect(screen.queryByText(/opcionális tételekkel együtt/)).toBeNull();
  });

  it("a kért opcióval, a megadott névvel, egy kérés-azonosítóval fogad el", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, page()))
      // bejelöléskor a lap a szervertől kéri a végösszeget
      .mockResolvedValueOnce(
        reply(200, { netTotal: "120000.00", replacedItems: [] }),
      )
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
    const [path, init] = fetchMock.mock.calls[2]!;
    expect(path).toBe("/api/public/quotes/tok-123/accept");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      name: "Kovács Anna",
      selectedOptionalItemIds: ["opt-1"],
    });
    expect(typeof body.requestId).toBe("string");
  });

  /*
    KIVÁLTOTT TÉTEL (kártya 2540d9d4, Luca 2026-11-26): az opcionális tétel a megnevezett tétel HELYÉRE léphet. A végösszeget a SZERVER számolja
    a kiválasztásra, a lap csak mutatja. MI PIROSÍT: ha a lap maga számolja az összeget; ha a kiváltott tétel nincs áthúzva és "Kiváltva" jelölve;
    ha a címke nem a kiváltott tétel nevét írja; ha az "opcionális tételekkel együtt" összeg a szerver értéke helyett az összeadás; ha az elfogadott
    összefoglaló a kiváltott tételt nem húzza át, vagy nem az elfogadott összeget mutatja.
  */
  const replacing = (over: Partial<PublicQuoteDto> = {}) =>
    page({
      items: [
        ...page().items.slice(0, 1),
        {
          id: "opt-1",
          name: "Fedőlap",
          quantity: "1",
          unit: "db",
          unitNetPrice: "20000.00",
          vatRatePercent: "27",
          netTotal: "20000.00",
          isOptional: true,
          replacesName: "Akvárium",
          alternativeOf: null,
          replaced: false,
          chosen: false,
        },
      ],
      netTotalWithOptionals: "20000.00",
      ...over,
    });

  it("a bejelölt kiváltó tétel esetén a szerver végösszegét mutatja, és a kiváltott tételt áthúzza", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, replacing()))
      .mockResolvedValueOnce(
        reply(200, { netTotal: "20000.00", replacedItems: [0] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicQuotePage token="tok-123" />);
    await screen.findByText("Tengeri akvárium");
    const rows = screen.getAllByTestId("quote-item-row");
    expect(rows[1]!.textContent).toContain("„Akvárium” helyett");
    expect(rows[0]!.textContent).not.toContain("Kiváltva");
    fireEvent.click(screen.getByRole("checkbox", { name: /Fedőlap/ }));
    expect(await screen.findByText(/A kiválasztott tételekkel:/)).toBeTruthy();
    expect(
      screen.getByText(/A kiválasztott tételekkel:\s*20\s000 Ft\s*\+ ÁFA/),
    ).toBeTruthy();
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toBe("/api/public/quotes/tok-123/total");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      selectedOptionalItemIds: ["opt-1"],
    });
    expect(screen.getAllByTestId("quote-item-row")[0]!.textContent).toContain(
      "Kiváltva",
    );
    expect(document.querySelector(".line-through")).toBeTruthy();
    // a bejelölés visszavétele: a kiváltás is megszűnik
    fireEvent.click(screen.getByRole("checkbox", { name: /Fedőlap/ }));
    await waitFor(() =>
      expect(screen.queryByText(/A kiválasztott tételekkel:/)).toBeNull(),
    );
    expect(
      screen.getAllByTestId("quote-item-row")[0]!.textContent,
    ).not.toContain("Kiváltva");
  });

  it("az opcionális tételekkel együtt összeg a szerver értéke, nem az összeadás", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(reply(200, replacing())),
    );
    render(<PublicQuotePage token="tok-123" />);
    // 100 000 + 20 000 volna az összeadás: a kiváltás miatt 20 000
    expect(
      await screen.findByText(
        /Az opcionális tételekkel együtt:\s*20\s000 Ft\s*\+ ÁFA/,
      ),
    ).toBeTruthy();
  });

  it("elfogadás után a kiváltott tétel áthúzva és Kiváltva jelölve áll, az elfogadott összeggel", async () => {
    const items = replacing().items.map((item, index) => ({
      ...item,
      replaced: index === 0,
      chosen: index === 1,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        reply(
          200,
          replacing({
            items,
            state: "ACCEPTED",
            acceptedAt: "2026-11-26",
            acceptedNetTotal: "20000.00",
          }),
        ),
      ),
    );
    render(<PublicQuotePage token="tok-123" />);
    expect(
      await screen.findByText(/Elfogadott nettó összeg:\s*20\s000 Ft\s*\+ ÁFA/),
    ).toBeTruthy();
    expect(screen.getAllByTestId("quote-item-row")[0]!.textContent).toContain(
      "Kiváltva",
    );
    expect(screen.queryByText(/opcionális tételekkel együtt/)).toBeNull();
  });

  /*
    ALTERNATÍVÁK (kártya 2540d9d4, Luca 2026-11-27): egy tételt több opció is kiválthat, de egyet választhat az ügyfél: amit bejelöl, az számít, a
    többi nem. MI PIROSÍT: ha a második opció bejelölése az elsőt bejelölve hagyja (a kérés két opciót küld); ha a bejelölés más tétel opcióját is leveszi;
    ha a címke nem mondja, hogy egyet kell választani; ha az „együtt” összeg nem jelzi, hogy a legdrágább alternatívával számol.
  */
  const alternatives = () =>
    page({
      items: [
        ...page().items.slice(0, 1),
        ...["Fedőlap A", "Fedőlap B"].map((name, index) => ({
          id: `opt-${index + 1}`,
          name,
          quantity: "1",
          unit: "db",
          unitNetPrice: index ? "30000.00" : "20000.00",
          vatRatePercent: "27",
          netTotal: index ? "30000.00" : "20000.00",
          isOptional: true,
          replacesName: "Akvárium",
          alternativeOf: 0,
          replaced: false,
          chosen: false,
        })),
        {
          id: "opt-3",
          name: "Világítás",
          quantity: "1",
          unit: "db",
          unitNetPrice: "5000.00",
          vatRatePercent: "27",
          netTotal: "5000.00",
          isOptional: true,
          replacesName: null,
          alternativeOf: null,
          replaced: false,
          chosen: false,
        },
      ],
      netTotalWithOptionals: "35000.00",
      hasAlternatives: true,
    });

  it("a második alternatíva bejelölése leveszi az elsőt, és egy opciót küld a szervernek; más tétel opcióját nem érinti", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, alternatives()))
      .mockResolvedValue(
        reply(200, { netTotal: "30000.00", replacedItems: [0] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<PublicQuotePage token="tok-123" />);
    await screen.findByText("Tengeri akvárium");
    fireEvent.click(screen.getByRole("checkbox", { name: /Világítás/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Fedőlap A/ }));
    expect(
      (screen.getByRole("checkbox", { name: /Fedőlap A/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Fedőlap B/ }));
    expect(
      (screen.getByRole("checkbox", { name: /Fedőlap A/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: /Fedőlap B/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    // a másik tétel opciója megmaradt
    expect(
      (screen.getByRole("checkbox", { name: /Világítás/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await waitFor(() => {
      const last = fetchMock.mock.calls.at(-1)!;
      expect(
        JSON.parse((last[1] as RequestInit).body as string)
          .selectedOptionalItemIds.slice()
          .sort(),
      ).toEqual(["opt-2", "opt-3"]);
    });
  });

  it("a címke kimondja, hogy egyet kell választani, és az együtt összeg jelzi a legdrágább alternatívát", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(reply(200, alternatives())),
    );
    render(<PublicQuotePage token="tok-123" />);
    await screen.findByText("Tengeri akvárium");
    const rows = screen.getAllByTestId("quote-item-row");
    expect(rows[1]!.textContent).toContain(
      "„Akvárium” helyett · válassz egyet",
    );
    expect(rows[2]!.textContent).toContain("válassz egyet");
    expect(rows[3]!.textContent).not.toContain("válassz egyet");
    expect(
      screen.getByText(
        /Az opcionális tételekkel együtt \(a legdrágább alternatívával\):\s*35\s000 Ft\s*\+ ÁFA/,
      ),
    ).toBeTruthy();
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
