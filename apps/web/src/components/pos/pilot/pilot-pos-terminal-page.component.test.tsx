import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  PosProductSearchResult,
  PosSaleListResponse,
  PosSaleResult,
  Session,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CART_ADD_HIGHLIGHT_MS,
  PilotPosTerminalPage,
  getCartStockWarnings,
} from "./pilot-pos-terminal-page";

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest alatt,
 * Next build nélkül nem futtatható, `TypeError: default is not a
 * function`-nal bukik. Tranzitíven kerül ide (`pilot-ui.tsx` ->
 * `pilot-font.ts`), lásd ugyanezt a mockot a
 * `pilot-service-job-detail-page.component.test.tsx`-ben.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

/**
 * A `pilot-pos-terminal-page.tsx` LOGIKÁJA SZÓ SZERINT A RÉGI
 * `pos-terminal-page.tsx`-BŐL JÖN (lásd annak fejlécét) -- ez a fájl ezért
 * a régi `pos-terminal-page.component.test.tsx` szűkített, a Figma-kör
 * brief-je szerint kért állításait ismétli a PILOT komponensre: a
 * "Fizetés" gomb csak `orders.manage` joggal látszik, és a kosár összege a
 * tételek és a kedvezmények szerint számol. Nem duplikálja a régi fájl
 * TELJES lefedettségét (pl. cookie-session ág), mert az az ÉRINTETLEN régi
 * komponenst teszteli, nem ezt.
 */

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  searchProducts: vi.fn(),
  createSale: vi.fn(),
  listSales: vi.fn(),
  getSale: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/pos", () => ({ posApi: api }));

function sessionWithRole(role: "OWNER" | "WAREHOUSE"): Session {
  return {
    id: `session-${role}`,
    token: `token-${role}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: role,
      email: `${role.toLowerCase()}@acropora.local`,
      displayName: "Teszt Felhasználó",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

const emptySalesResponse: PosSaleListResponse = {
  items: [],
  pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
};

const searchResult: PosProductSearchResult = {
  variantId: "variant-1",
  sku: "RS-RM500",
  productName: "Red Sea ReefMat 500",
  unit: "db",
  vatRate: "27",
  grossPrice: "24900",
  currentStock: "12",
  isPackageProduct: false,
};

function saleResult(): PosSaleResult {
  return {
    detail: {
      id: "sale-1",
      orderNumber: "POS-0001",
      status: "COMPLETED",
      paymentMethod: "CASH",
      customerName: null,
      soldByName: "Teszt Felhasználó",
      currency: "HUF",
      totalNet: "19606",
      totalTax: "5294",
      totalGross: "24900",
      discountPercent: null,
      createdAt: "2026-07-25T10:00:00.000Z",
      completedAt: "2026-07-25T10:00:01.000Z",
      lines: [],
    },
    stockWarnings: [],
    successCount: 1,
    failedCount: 0,
  };
}

beforeEach(() => {
  auth.session = sessionWithRole("OWNER");
  navigation.push.mockReset();
  api.searchProducts.mockReset().mockResolvedValue([]);
  api.createSale.mockReset();
  api.listSales.mockReset().mockResolvedValue(emptySalesResponse);
  api.getSale.mockReset();
});

describe("PilotPosTerminalPage", () => {
  it("orders.view jogosultság nélkül megtagadja a hozzáférést", () => {
    auth.session = null;

    render(createElement(PilotPosTerminalPage));

    expect(
      screen.getByText("Nincs hozzáférésed a pénztárhoz"),
    ).toBeInTheDocument();
    expect(api.listSales).not.toHaveBeenCalled();
  });

  /**
   * A WAREHOUSE SZEREPNEK VAN `orders.view`-JA, DE NINCS `orders.manage`-JE
   * (packages/types/src/auth.ts) -- ez a fixture ezt a szétválasztást
   * használja ki: a lap MEGNYÍLIK (látja a keresést, a kosarat), de a
   * "Fizetés" gomb NEM jelenik meg. MI PIROSÍT: ha a gomb feltétel nélkül
   * renderelne.
   */
  it("orders.manage jog nélkül a lap megnyílik, de a Fizetés gomb nem jelenik meg", async () => {
    auth.session = sessionWithRole("WAREHOUSE");

    render(createElement(PilotPosTerminalPage));

    await waitFor(() => expect(api.listSales).toHaveBeenCalled());
    expect(
      screen.getByRole("textbox", { name: "Termék keresése" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Fizetés/ }),
    ).not.toBeInTheDocument();
  });

  it("orders.manage joggal a Fizetés gomb megjelenik, és rögzíti az eladást", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockResolvedValue(saleResult());

    render(createElement(PilotPosTerminalPage));
    await waitFor(() => expect(api.listSales).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("button", { name: /^Fizetés/ })).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    expect(screen.getByRole("button", { name: /^Fizetés/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /^Fizetés/ }));

    await waitFor(() =>
      expect(api.createSale).toHaveBeenCalledWith(
        "token-OWNER",
        expect.objectContaining({
          paymentMethod: "CASH",
          lines: [
            expect.objectContaining({ variantId: "variant-1", quantity: 1 }),
          ],
        }),
      ),
    );
    expect(
      await screen.findByText("Eladás rögzítve: POS-0001"),
    ).toBeInTheDocument();
  });

  /**
   * A MAI KÉPLET: soronként `unitGross * quantity * (1 - lineDiscount/100)`,
   * összegezve, majd a teljes összegre `* (1 - overallDiscount/100)` --
   * lásd a régi komponens `subtotalGross`/`totalGross`-át. 24900 Ft egy
   * darabon 10%-os tételkedvezménnyel 22410, majd 20%-os végösszeg-
   * kedvezménnyel 17928 -- ugyanaz a szám, amit a régi teszt is ellenőriz.
   */
  it("a tétel- és a végösszeg-kedvezményt is a mai képlet szerint számítja, és mindkettőt elküldi", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockResolvedValue(saleResult());

    render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "Red Sea ReefMat 500 kedvezmény",
      }),
      { target: { value: "10" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Végösszeg kedvezmény" }),
      { target: { value: "20" } },
    );

    expect(screen.getAllByText(/17.928\s?Ft/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /^Fizetés/ }));

    await waitFor(() =>
      expect(api.createSale).toHaveBeenCalledWith("token-OWNER", {
        paymentMethod: "CASH",
        discountPercent: 20,
        lines: [
          {
            variantId: "variant-1",
            quantity: 1,
            unitGross: 24900,
            discountPercent: 10,
          },
        ],
      }),
    );
  });

  it("a fizetési mód nagy gombjai a helyes CASH/CARD/TRANSFER értéket küldik", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockResolvedValue(saleResult());

    render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    fireEvent.click(screen.getByRole("button", { name: "Utalás" }));
    fireEvent.click(screen.getByRole("button", { name: /^Fizetés/ }));

    await waitFor(() =>
      expect(api.createSale).toHaveBeenCalledWith(
        "token-OWNER",
        expect.objectContaining({ paymentMethod: "TRANSFER" }),
      ),
    );
  });

  /**
   * KALIBRÁCIÓ (kártya 5bf263a2, Balázs képe, 2026-09-25 16:21): az ELSŐ
   * verzió `PilotSegmentedControl`-t használt (kis, tömör pill-váltó,
   * `bg-pilot-grey-100 p-0.5` burok, `px-3 py-1` gombok) a terv három NAGY
   * gombja helyett. Ez az állítás a JAVÍTOTT alakra megy: három önálló
   * gomb egy `grid-cols-3` rácsban, `py-2.5` (nem `py-1`) magassággal, a
   * kiválasztott aqua háttérrel. Visszaállítva a régi kódra (git stash) ez
   * az assertion PIROSRA VÁLT: a burok-osztály jelen van, a gomb-osztály
   * `py-1`.
   */
  it("a fizetési mód VÁLASZTÓJA három nagy gomb, nem a kis szegmentált pill-váltó", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);

    const { container } = render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    expect(
      container.querySelector(".bg-pilot-grey-100.p-0\\.5"),
    ).not.toBeInTheDocument();

    const cashButton = screen.getByRole("button", { name: "Készpénz" });
    expect(cashButton.className).toContain("py-2.5");
    expect(cashButton.className).toContain("bg-pilot-aqua-600");

    const cardButton = screen.getByRole("button", { name: "Kártya" });
    expect(cardButton.className).toContain("py-2.5");
    expect(cardButton.className).not.toContain("bg-pilot-aqua-600");

    const paymentGrid = cashButton.parentElement;
    expect(paymentGrid?.className).toContain("grid-cols-3");
  });

  /**
   * KÁRTYA 18c5f3a3 (Balázs, 2026-10-02): több tételnél az új sor a lista
   * ALJÁRA került, nem látszott, hogy a kattintás hatott, és a kolléga újra
   * kattintott. Ez az állítás a látható visszajelzést méri: azonos termék
   * kétszer -> EGY sor 2 darabbal, a kereső alatti állapotsor kiírja a
   * darabszámot, a sor kiemelt, és a fókusz a keresőn marad. MI PIROSÍT:
   * ha a hozzáadás csendben menne (nincs állapotsor, nincs kiemelés), vagy a
   * fókusz a találat-gombon maradna.
   */
  it("azonos termék kétszer: egy sor 2 db, látható visszajelzés, kiemelt sor, fókusz a keresőn", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);

    const { container } = render(createElement(PilotPosTerminalPage));
    const search = screen.getByRole("textbox", { name: "Termék keresése" });
    fireEvent.change(search, { target: { value: "reef" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    const result = await screen.findByText("Red Sea ReefMat 500");
    fireEvent.click(result);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Hozzáadva: Red Sea ReefMat 500. A kosárban: 1 db",
    );

    // A real click moves focus to the clicked button; `fireEvent.click`
    // does not, so without this the search box would keep its autoFocus
    // and the focus assertion below could not fail.
    const resultButton = screen
      .getAllByText("Red Sea ReefMat 500")[0]!
      .closest("button")!;
    resultButton.focus();
    expect(document.activeElement).toBe(resultButton);
    fireEvent.click(resultButton);

    const rows = container.querySelectorAll("[data-variant-id]");
    expect(rows).toHaveLength(1);
    expect(
      screen.getByRole("spinbutton", { name: "Mennyiség (db)" }),
    ).toHaveValue(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Hozzáadva: Red Sea ReefMat 500. A kosárban: 2 db",
    );
    expect(rows[0]).toHaveAttribute("data-just-added", "true");
    expect(document.activeElement).toBe(search);
  });

  /**
   * A kiemelés és az állapotsor RÖVID ideig áll, utána eltűnik -- különben
   * a következő hozzáadás nem lenne megkülönböztethető az előzőtől. A
   * kattintás ELŐTT kapcsolunk ál-időzítőre, hogy a hatás által indított
   * `setTimeout` már az ál-órára kerüljön. MI PIROSÍT: ha a kiemelés
   * örökre a soron maradna.
   */
  it("a kiemelés és a visszajelzés a megadott idő után eltűnik", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);

    const { container } = render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const result = await screen.findByText("Red Sea ReefMat 500");

    vi.useFakeTimers();
    try {
      fireEvent.click(result);
      const row = container.querySelector("[data-variant-id]");
      expect(row).toHaveAttribute("data-just-added", "true");

      act(() => {
        vi.advanceTimersByTime(CART_ADD_HIGHLIGHT_MS - 1);
      });
      expect(row).toHaveAttribute("data-just-added", "true");

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(row).not.toHaveAttribute("data-just-added");
      expect(screen.getByRole("status")).toHaveTextContent("");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * A FIX HELYŰ LÁBRÉSZ: a görgetés a tétel-listán van, a Fizetés gomb és a
   * végösszeg a listán KÍVÜL, külön, nem zsugorodó blokkban. Az állítás a
   * szerkezetet és az `lg` felett érvényes osztályokat méri; magát a
   * görgetést happy-dom nem rajzolja ki (nincs elrendezés), az a kézi
   * próba dolga. MI PIROSÍT: ha a Fizetés gomb a görgetett listába
   * kerülne, vagy a lista nem kapna saját görgetést, vagy a kártya nem
   * lenne a látótér magasságára korlátozva.
   */
  it("a tétel-lista külön görget, az összesítő és a Fizetés gomb a listán kívül, fix helyen áll", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);

    render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    fireEvent.click(await screen.findByText("Red Sea ReefMat 500"));

    const lines = screen.getByTestId("pos-cart-lines");
    const footer = screen.getByTestId("pos-cart-footer");
    const payButton = screen.getByRole("button", { name: /^Fizetés/ });

    expect(lines.className).toContain("lg:overflow-y-auto");
    expect(lines.className).toContain("lg:min-h-0");
    expect(lines.className).toContain("lg:flex-1");
    expect(lines.contains(payButton)).toBe(false);
    expect(footer.contains(payButton)).toBe(true);
    expect(footer.className).toContain("shrink-0");
    expect(lines.parentElement).toBe(footer.parentElement);
    expect(lines.parentElement?.className).toContain(
      "lg:h-[min(830px,calc(100dvh-12.5rem))]",
    );
    // Below lg the list must not become a second scroll area inside the
    // scrolling page: no unprefixed overflow or height cap on it.
    expect(lines.className).not.toMatch(/(^|\s)overflow-y-auto/);
    expect(lines.className).not.toMatch(/(^|\s)max-h-/);
  });
  it("összeadja az azonos változat ÖSSZES darabját; nem hasonlít más változatot és kihagyja a csomagot", () => {
    const line = { ...searchResult, quantity: 0.6, currentStock: "1" };
    const warnings = getCartStockWarnings([
      line,
      line,
      { ...line, variantId: "other", quantity: 0.8 },
      { ...line, variantId: "package", quantity: 99, isPackageProduct: true },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      variantId: "variant-1",
      quantity: 1.2,
    });
    expect(getCartStockWarnings([{ ...line, quantity: 1 }])).toHaveLength(0);
    expect(
      getCartStockWarnings([{ ...line, currentStock: "-1" }]),
    ).toHaveLength(1);
  });

  it("készlettúllépés előtt figyelmeztet, mennyiségcsökkentéskor eltűnik, és nem tiltja az eladást", async () => {
    api.searchProducts.mockResolvedValue([
      { ...searchResult, currentStock: "1" },
    ]);
    api.createSale.mockResolvedValue({
      ...saleResult(),
      stockWarnings: [
        {
          sku: searchResult.sku,
          productName: searchResult.productName,
          resultingQty: "-1",
        },
      ],
    });
    render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "RS-RM500" },
    });
    const result = (await screen.findByText(searchResult.productName)).closest(
      "button",
    )!;
    fireEvent.click(result);
    expect(screen.queryByTestId("pos-stock-warning")).not.toBeInTheDocument();
    fireEvent.click(result);
    expect(screen.getByTestId("pos-stock-warning")).toHaveTextContent(
      "kosár 2 db, készlet 1 db",
    );
    expect(screen.getByRole("button", { name: /^Fizetés/ })).toBeEnabled();
    const quantity = screen.getByRole("spinbutton", { name: "Mennyiség (db)" });
    fireEvent.change(quantity, { target: { value: "1" } });
    expect(screen.queryByTestId("pos-stock-warning")).not.toBeInTheDocument();
    fireEvent.change(quantity, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Fizetés/ }));
    expect(
      await screen.findByText(/Figyelem, negatívba fordult/),
    ).toBeInTheDocument();
    expect(api.createSale).toHaveBeenCalledWith(
      "token-OWNER",
      expect.objectContaining({
        lines: [expect.objectContaining({ quantity: 2 })],
      }),
    );
  });

  it("csomagra nincs előzetes warning; a hiányzó ÁFA a footerben látható és tilt", async () => {
    api.searchProducts.mockResolvedValue([
      {
        ...searchResult,
        currentStock: "0",
        isPackageProduct: true,
        vatRate: null,
      },
    ]);
    render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "csomag" },
    });
    fireEvent.click(await screen.findByText(searchResult.productName));
    expect(screen.queryByTestId("pos-stock-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("pos-cart-footer")).toHaveTextContent(
      "Nincs beállítva ÁFA kulcs ehhez a termékhez: RS-RM500",
    );
    expect(screen.getByRole("button", { name: /^Fizetés/ })).toBeDisabled();
    expect(api.createSale).not.toHaveBeenCalled();
  });

  it("a mai napot és 10 sort kér le; a listából a részletre navigál", async () => {
    api.listSales.mockResolvedValue({
      ...emptySalesResponse,
      items: [
        {
          id: "today",
          orderNumber: "POS-TODAY",
          createdAt: new Date().toISOString(),
          paymentMethod: "CARD",
          totalGross: "100",
          lineCount: 1,
        },
      ],
    });
    render(createElement(PilotPosTerminalPage));
    fireEvent.click(await screen.findByText("POS-TODAY"));
    expect(navigation.push).toHaveBeenCalledWith("/pos/today");
    const query = api.listSales.mock.calls[0]![1];
    const now = new Date();
    expect(query).toEqual({
      page: 1,
      pageSize: 10,
      createdFrom: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).toISOString(),
      createdTo: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      ).toISOString(),
    });
  });

  it("mentési hiba a footerben marad, a kosár megmarad és újrapróbálható", async () => {
    api.searchProducts.mockResolvedValue([searchResult]);
    api.createSale.mockRejectedValue(new Error("Teszt mentési hiba"));
    render(createElement(PilotPosTerminalPage));
    fireEvent.change(screen.getByRole("textbox", { name: "Termék keresése" }), {
      target: { value: "reef" },
    });
    fireEvent.click(await screen.findByText(searchResult.productName));
    fireEvent.click(screen.getByRole("button", { name: /^Fizetés/ }));
    expect(await screen.findByText("Teszt mentési hiba")).toBeInTheDocument();
    expect(screen.getByTestId("pos-cart-footer")).toHaveTextContent(
      "Teszt mentési hiba",
    );
    expect(
      screen.getByRole("spinbutton", { name: "Mennyiség (db)" }),
    ).toHaveValue(1);
    expect(screen.getByRole("button", { name: /^Fizetés/ })).toBeEnabled();
  });
  it("éjfélkor törli a tegnapi listát és az új nap 10 eladását kéri", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 23, 59, 59));
    try {
      api.listSales.mockResolvedValueOnce({
        ...emptySalesResponse,
        items: [
          {
            id: "yesterday",
            orderNumber: "POS-YESTERDAY",
            createdAt: new Date().toISOString(),
            paymentMethod: "CARD",
            totalGross: "100",
            lineCount: 1,
          },
        ],
      });
      api.listSales.mockImplementationOnce(() => new Promise(() => {}));
      await act(async () => {
        render(createElement(PilotPosTerminalPage));
      });
      expect(screen.getByText("POS-YESTERDAY")).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByText("POS-YESTERDAY")).not.toBeInTheDocument();
      expect(api.listSales).toHaveBeenCalledTimes(2);
      expect(api.listSales.mock.calls[1]![1]).toEqual({
        page: 1,
        pageSize: 10,
        createdFrom: new Date(2026, 9, 5).toISOString(),
        createdTo: new Date(2026, 9, 6).toISOString(),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
