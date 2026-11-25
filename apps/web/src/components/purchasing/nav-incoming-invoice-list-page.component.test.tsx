import { fireEvent, render, screen, within } from "@testing-library/react";
import type { NavIncomingInvoiceListResponse, Session } from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  NavIncomingInvoiceListPage,
  navInvoiceListQuery,
} from "./nav-incoming-invoice-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  sync: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  session: null as Session | null,
}));

// a lap a Figma 613:887 óta `PilotThemeRoot` alatt áll (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/beszerzes/nav-szamlak",
  useRouter: () => navigation,
  useSearchParams: () => navigation.params,
}));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/api/nav-incoming-invoices", () => ({
  navIncomingInvoicesApi: api,
}));

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

const firstPage: NavIncomingInvoiceListResponse = {
  items: [
    {
      id: "nav-invoice-1",
      navInvoiceNumber: "INV-2026-1",
      supplierTaxNumber: "12345678-2-42",
      supplierName: "Teszt Beszállító Kft.",
      invoiceIssueDate: "2026-07-30T00:00:00.000Z",
      currency: "HUF",
      invoiceNetAmount: "10000",
      insDate: "2026-07-30T00:00:00.000Z",
      invoiceOperation: "CREATE",
      status: "NEW",
    },
  ],
  pagination: {
    page: 1,
    pageSize: 25,
    totalItems: 26,
    totalPages: 2,
  },
};

beforeEach(() => {
  auth.session = ownerSession;
  navigation.params = new URLSearchParams();
  navigation.replace.mockReset();
  navigation.push.mockReset();
  api.list.mockReset().mockResolvedValue(firstPage);
  api.sync.mockReset();
});

describe("NavIncomingInvoiceListPage", () => {
  it("a Következő gomb megtartja a kért oldalszámot", async () => {
    render(createElement(NavIncomingInvoiceListPage));

    fireEvent.click(
      within(
        await screen.findByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );

    expect(navigation.replace).toHaveBeenCalledWith(
      "/beszerzes/nav-szamlak?page=2",
    );
  });

  it("a jóváírót (módosító okirat) megjelöli, az eredeti számla számával", async () => {
    api.list.mockResolvedValue({
      ...firstPage,
      items: [
        ...firstPage.items,
        {
          ...firstPage.items[0]!,
          id: "nav-invoice-2",
          navInvoiceNumber: "KS26/05898",
          invoiceNetAmount: "-59918",
          invoiceOperation: "MODIFY",
          originalInvoiceNumber: "KS26/05101",
        },
      ],
    });

    render(createElement(NavIncomingInvoiceListPage));

    const row = (await screen.findByText("KS26/05898")).closest("tr")!;
    expect(within(row).getByText("Módosító")).toBeTruthy();
    expect(within(row).getByText("eredeti: KS26/05101")).toBeTruthy();
    const plain = screen.getByText("INV-2026-1").closest("tr")!;
    expect(within(plain).queryByText("Módosító")).toBeNull();
  });

  it("állapotszűréskor visszaáll az első oldalra", async () => {
    navigation.params = new URLSearchParams("page=2");
    api.list.mockResolvedValue({
      ...firstPage,
      pagination: { ...firstPage.pagination, page: 2 },
    });

    render(createElement(NavIncomingInvoiceListPage));

    fireEvent.change(
      await screen.findByRole("combobox", { name: "OS állapot" }),
      { target: { value: "NEW" } },
    );

    expect(navigation.replace).toHaveBeenCalledWith(
      "/beszerzes/nav-szamlak?page=1&status=NEW",
    );
  });
});

/*
  A LISTA RENDEZÉSE AZ OSZLOPFEJEN (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha egy fejléc nem a saját szerver-mezőjét írja az
  URL-be; ha a ciklus (növekvő, csökkenő, alap) elakad; ha a rendezés nem nullázza a lapot, vagy elveszíti az állapotszűrőt; ha az URL
  rendezése nem jut a kérésbe, vagy egy ismeretlen mező (régi vagy kézzel írt link) igen (az API 400-at adna, és az egész lista
  eltörne); ha a bruttó, a NAV és az OS oszlop rendezhetőnek látszik.
*/
describe("NavIncomingInvoiceListPage sorting", () => {
  const urlOfLastReplace = () =>
    new URLSearchParams(
      String(navigation.replace.mock.calls.at(-1)?.[0]).split("?")[1],
    );

  it("a header writes its own server field, ascending first, drops the page and keeps the status filter", async () => {
    navigation.params = new URLSearchParams("page=2&status=NEW");
    render(createElement(NavIncomingInvoiceListPage));
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Szállító/ }));
    const url = urlOfLastReplace();
    expect(url.get("sort")).toBe("supplierName");
    expect(url.get("direction")).toBe("asc");
    expect(url.has("page")).toBe(false);
    expect(url.get("status")).toBe("NEW");
  });

  it("each sortable header sends its own field", async () => {
    render(createElement(NavIncomingInvoiceListPage));
    await screen.findByRole("table");
    for (const [name, field] of [
      ["Számlaszám", "navInvoiceNumber"],
      ["Kelte", "invoiceIssueDate"],
      ["Teljesítés", "invoiceDeliveryDate"],
    ] as const) {
      navigation.replace.mockReset();
      fireEvent.click(screen.getByRole("button", { name }));
      expect(urlOfLastReplace().get("sort")).toBe(field);
    }
  });

  it("the second click is descending, the third clears the sort", async () => {
    navigation.params = new URLSearchParams(
      "sort=invoiceIssueDate&direction=asc",
    );
    const { unmount } = render(createElement(NavIncomingInvoiceListPage));
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Kelte/ }));
    expect(urlOfLastReplace().get("direction")).toBe("desc");
    unmount();

    navigation.params = new URLSearchParams(
      "sort=invoiceIssueDate&direction=desc",
    );
    navigation.replace.mockReset();
    render(createElement(NavIncomingInvoiceListPage));
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: /Kelte/ }));
    expect(urlOfLastReplace().has("sort")).toBe(false);
    expect(urlOfLastReplace().has("direction")).toBe(false);
  });

  it("the URL's sort reaches the request, and an unknown or incomplete one does not", async () => {
    navigation.params = new URLSearchParams("sort=supplierName&direction=desc");
    render(createElement(NavIncomingInvoiceListPage));
    await screen.findByRole("table");
    const sent = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(sent.get("sort")).toBe("supplierName");
    expect(sent.get("direction")).toBe("desc");

    for (const bad of [
      "sort=invoiceNetAmount&direction=asc",
      "sort=supplierName",
      "sort=supplierName&direction=up",
      "direction=asc",
    ]) {
      const query = navInvoiceListQuery(new URLSearchParams(bad));
      expect(query.has("sort"), bad).toBe(false);
      expect(query.has("direction"), bad).toBe(false);
    }
    // a többi paraméter és az alapértékek érintetlenek
    const plain = navInvoiceListQuery(new URLSearchParams("status=NEW"));
    expect(Object.fromEntries(plain)).toEqual({
      status: "NEW",
      page: "1",
      pageSize: "25",
    });
  });

  it("the gross, the NAV operation and the OS state have no sort button", async () => {
    render(createElement(NavIncomingInvoiceListPage));
    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    const sortable = headers
      .filter((header) => within(header).queryByRole("button"))
      .map((header) => header.textContent?.replace(/[⇅↑↓]/g, ""));
    expect(sortable).toEqual(["Számlaszám", "Szállító", "Kelte", "Teljesítés"]);
  });
});
