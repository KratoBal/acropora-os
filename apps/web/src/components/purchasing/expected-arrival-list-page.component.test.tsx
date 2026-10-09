import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  ExpectedArrivalListItem,
  Session,
  SupplierInvoiceMailSyncStatus,
} from "@acropora/types";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { urlNavigation } from "@/test/url-navigation";

import { ExpectedArrivalListPage } from "./expected-arrival-list-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  syncStatus: vi.fn(),
  sync: vi.fn(),
  detail: vi.fn(),
  dismiss: vi.fn(),
  restore: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({
    session: auth.session,
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));
vi.mock("@/lib/api/expected-arrivals", () => ({ expectedArrivalsApi: api }));
// a lap a Figma 611:321 óta `PilotThemeRoot` alatt áll (Inter, `next/font/local`)
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const session = (role: "OWNER" | "VIEWER"): Session => ({
  id: "s",
  token: "token-owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "u",
    email: "u@acropora.local",
    displayName: "U",
    role,
    customerId: null,
    supplierId: null,
  },
});

const item = (
  overrides: Partial<ExpectedArrivalListItem>,
): ExpectedArrivalListItem => ({
  source: "MAIL",
  id: "arr-1",
  supplierName: "Aquarioom",
  supplierId: "sup-1",
  orderReference: "13858",
  invoiceNumber: "FA00009139",
  stage: "INVOICE",
  arrivedAt: "2026-09-30T05:54:00.000Z",
  invoiceDate: "2026-09-30",
  currency: "EUR",
  netTotal: 120.5,
  lineCount: 7,
  suggestedLineCount: 4,
  editorPath: "/beszerzes/uj?beerkezes=arr-1",
  ...overrides,
});

const status: SupplierInvoiceMailSyncStatus = {
  state: "DISABLED_NOT_SET",
  canRunNow: true,
  intervalMinutes: 30,
  senders: ["contact@aquarioom.com"],
};

beforeEach(() => {
  auth.session = session("OWNER");
  urlNavigation.reset("/beszerzes/varhato");
  api.list.mockReset().mockResolvedValue({
    items: [
      item({}),
      item({
        id: "arr-2",
        orderReference: "13900",
        invoiceNumber: null,
        stage: "PROFORMA",
        editorPath: null,
        suggestedLineCount: null,
      }),
      item({
        source: "NAV",
        id: "nav-1",
        supplierName: "Hazai Kft.",
        orderReference: null,
        invoiceNumber: "NAV-1",
        currency: "HUF",
        netTotal: 1000,
        lineCount: null,
        suggestedLineCount: null,
        editorPath: "/beszerzes/uj?navInvoiceId=nav-1",
      }),
    ],
    dismissed: [],
  });
  api.dismiss.mockReset().mockResolvedValue(undefined);
  api.restore.mockReset().mockResolvedValue(undefined);
  api.syncStatus.mockReset().mockResolvedValue(status);
  api.sync.mockReset().mockResolvedValue({
    status: "APPLIED",
    trigger: "MANUAL",
    startedAt: "",
    messagesSeen: 2,
    documentsRead: 2,
    duplicateCount: 0,
    failedCount: 0,
    reminderCount: 0,
  });
});

/**
 * A VÁRHATÓ BEÉRKEZÉSEK LISTÁJA. MI PIROSIT: ha a levélből és a NAV-ból jött
 * tétel nem egy listán áll; ha a proforma bevételezésre visz; ha a
 * bevételezhető sor nem a szerkesztőbe visz; ha a forrás-szűrő nem szűr; ha a
 * kézi ellenőrzés nem fut, vagy olyannak is megjelenik, aki nem kezelheti.
 */
describe("ExpectedArrivalListPage", () => {
  it("lists the mail and the NAV items; a bookable row opens the editor, the proforma does not", async () => {
    render(createElement(ExpectedArrivalListPage));
    const rows = await screen.findAllByTestId("varhato-sor");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("rendelés 13858 · FA00009139"),
      expect.stringContaining("Csak proforma"),
      expect.stringContaining("Hazai Kft."),
    ]);
    expect(rows[0]).toHaveTextContent("7 tétel (4 javaslattal)");

    fireEvent.click(rows[1]!);
    expect(urlNavigation.push).not.toHaveBeenCalled();
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[2]!);
    expect(urlNavigation.push.mock.calls.map(([path]) => path)).toEqual([
      "/beszerzes/uj?beerkezes=arr-1",
      "/beszerzes/uj?navInvoiceId=nav-1",
    ]);
  });

  // a corrected invoice after the booking: it is shown, and it opens nothing
  it("flags a correction that arrived after the booking, without opening the editor", async () => {
    api.list.mockResolvedValue({
      items: [
        item({
          id: "arr-3",
          orderReference: "18319",
          invoiceNumber: "32600434",
          stage: "LATE_CORRECTION",
          editorPath: null,
          suggestedLineCount: null,
        }),
      ],
      dismissed: [],
    });
    render(createElement(ExpectedArrivalListPage));
    const [row] = await screen.findAllByTestId("varhato-sor");
    expect(row).toHaveTextContent("Bevételezés után javított számla érkezett");
    expect(row).not.toHaveTextContent("Bevételezhető");
    fireEvent.click(row!);
    expect(urlNavigation.push).not.toHaveBeenCalled();
  });

  it("filters by source", async () => {
    render(createElement(ExpectedArrivalListPage));
    await screen.findAllByTestId("varhato-sor");
    const source = screen.getByRole("combobox", { name: "Forrás" });
    fireEvent.change(source, { target: { value: "NAV" } });
    expect(screen.getAllByTestId("varhato-sor")).toHaveLength(1);
    fireEvent.change(source, { target: { value: "MAIL" } });
    expect(screen.getAllByTestId("varhato-sor")).toHaveLength(2);
  });

  it("says whether the mail pull runs by itself, and a manager can check the mails now", async () => {
    render(createElement(ExpectedArrivalListPage));
    expect(await screen.findByTestId("levelbehuzas-allapot")).toHaveTextContent(
      "nem fut magától",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Levelek ellenőrzése" }),
    );
    await waitFor(() => expect(api.sync).toHaveBeenCalledWith("token-owner"));
    expect(
      await screen.findByText("2 új dokumentum beolvasva."),
    ).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  // What must fail: "Nem kell" on a NAV row (not an arrival) or on a booked
  // one; a click that also opens the editor; no way back from the list.
  it("'Nem kell' takes a mail row off without opening it, and a dismissed one can be taken back", async () => {
    render(createElement(ExpectedArrivalListPage));
    const rows = await screen.findAllByTestId("varhato-sor");
    expect(
      rows.map((row) => row.textContent?.includes("Nem kell") ?? false),
    ).toEqual([true, true, false]);

    fireEvent.click(within(rows[0]!).getByRole("button", { name: "Nem kell" }));
    await waitFor(() =>
      expect(api.dismiss).toHaveBeenCalledWith("token-owner", "arr-1"),
    );
    expect(urlNavigation.push).not.toHaveBeenCalled();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    api.list.mockResolvedValue({
      items: [],
      dismissed: [item({ editorPath: null })],
    });
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Nem kell" }));
    const [kivett] = await screen.findAllByTestId("kivett-sor");
    expect(kivett).toHaveTextContent("Aquarioom");
    fireEvent.click(
      within(kivett!).getByRole("button", { name: "Visszavétel" }),
    );
    await waitFor(() =>
      expect(api.restore).toHaveBeenCalledWith("token-owner", "arr-1"),
    );
  });

  it("says how many payment reminders the check skipped", async () => {
    api.sync.mockResolvedValue({
      status: "APPLIED",
      trigger: "MANUAL",
      startedAt: "",
      messagesSeen: 3,
      documentsRead: 0,
      duplicateCount: 0,
      failedCount: 0,
      reminderCount: 2,
    });
    render(createElement(ExpectedArrivalListPage));
    await screen.findAllByTestId("varhato-sor");
    fireEvent.click(
      screen.getByRole("button", { name: "Levelek ellenőrzése" }),
    );
    expect(
      await screen.findByText(
        "Nincs új beszállítói levél. 2 fizetési felszólítás kihagyva, nem nyit várható beérkezést.",
      ),
    ).toBeInTheDocument();
  });

  it("a viewer without the manage right sees the list but no check button", async () => {
    auth.session = session("VIEWER");
    render(createElement(ExpectedArrivalListPage));
    expect(await screen.findAllByTestId("varhato-sor")).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: "Levelek ellenőrzése" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Nem kell" })).toBeNull();
  });
});

/*
  A FORRÁS-SZŰRŐ AZ URL-BEN (Balázs kérése, 2026-09-30): a szerkesztőből
  visszalépve a lista ugyanazt a forrást mutatja. MI PIROSÍT: ha a szűrő
  megint helyi állapot lenne.
*/
describe("Várható beérkezések -- a forrás-szűrő az URL-ben", () => {
  it("az URL forrásával indul", async () => {
    urlNavigation.reset("/beszerzes/varhato", "source=NAV");
    render(<ExpectedArrivalListPage />);
    await screen.findByText("Hazai Kft.");
    expect(screen.queryByText("Aquarioom")).toBeNull();
  });

  it("a forrás-váltás az URL-be íródik", async () => {
    render(<ExpectedArrivalListPage />);
    await screen.findByText("Hazai Kft.");
    fireEvent.change(screen.getByRole("combobox", { name: "Forrás" }), {
      target: { value: "MAIL" },
    });
    await waitFor(() => expect(urlNavigation.search).toBe("source=MAIL"));
    expect(screen.queryByText("Hazai Kft.")).toBeNull();
  });
});
