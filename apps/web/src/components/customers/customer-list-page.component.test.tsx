import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CustomerListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerListPage } from "./customer-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn(), sync: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/vevok",
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        navigation.listeners.add(listener);
        return () => navigation.listeners.delete(listener);
      },
      () => navigation.params,
      () => navigation.params,
    ),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/customers", () => ({ customersApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "balazs@acropora.local",
    displayName: "Balázs",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

function response(page: number): CustomerListResponse {
  return {
    items: [
      {
        id: "customer-1",
        customerNumber: "VEVO-1",
        partnerCode: "VEVO-1",
        source: "MANUAL",
        type: "COMPANY",
        displayName: "Fővárosi Állat- És Növénykert",
        isActive: true,
        address: null,
        createdAt: "2026-08-19T10:00:00.000Z",
        updatedAt: "2026-08-19T10:00:00.000Z",
      },
    ],
    pagination: { page, pageSize: 25, totalItems: 60, totalPages: 3 },
  };
}

/**
 * Ugyanaz a mérés, mint az eszközlistán: a lapozás nem mehet a szűrő-ágon,
 * mert az a végén mindig `page=1`-et ír. A javítás előtti alakkal ez az
 * eset bukik - a "Következő" a 2. oldalról az elsőre visz vissza.
 */
describe("CustomerListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
    api.sync.mockReset().mockResolvedValue({});
  });

  /** One list for the buyers and the partners (one partner register): the title says so, and the
   * partners carry their role as a badge. The menu label is "Vevők" and is asserted in its own spec. */
  it("calls the screen what it holds", async () => {
    render(<CustomerListPage />);

    expect(await screen.findByText("Vevők és partnerek")).toBeTruthy();
  });

  // MI PIROSÍT: ha a lista szerep nélkül nem kéri a partnereket (role=ALL), ha a szerep-szűrő nem a `role` kulcson megy, vagy ha a
  // partner-sor szerep-jelvény nélkül áll, a vevő pedig jelvényt kap.
  it("asks for everyone by default, filters by role through the role key, and badges the partner rows only", async () => {
    const data = response(1);
    data.items = [
      {
        ...data.items[0]!,
        id: "p1",
        displayName: "Beszállító Kft.",
        partnerMirror: true,
        partnerRoles: ["SUPPLIER", "SERVICE"],
      },
      {
        ...data.items[0]!,
        id: "p2",
        displayName: "Csak Partner Kft.",
        partnerMirror: true,
        partnerRoles: [],
      },
      {
        ...data.items[0]!,
        id: "b1",
        displayName: "Vevő Bt.",
        partnerMirror: false,
      },
    ];
    api.list.mockResolvedValue(data);
    navigation.params = new URLSearchParams();
    render(<CustomerListPage />);
    await screen.findByText("Beszállító Kft.");
    expect(
      Object.fromEntries(api.list.mock.calls.at(-1)![1] as URLSearchParams),
    ).toMatchObject({
      role: "ALL",
    });
    const rows = screen.getAllByTestId("customer-row");
    expect(within(rows[0]!).getByText("Beszállító")).toBeTruthy();
    expect(within(rows[0]!).getByText("Szerviz-partner")).toBeTruthy();
    expect(within(rows[1]!).getByText("Partner")).toBeTruthy();
    expect(within(rows[2]!).queryByTestId("role-badges")).toBeNull();

    const select = screen.getByLabelText("Szerep") as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "BUYER",
      "PARTNER",
      "SUPPLIER",
      "SERVICE",
    ]);
    fireEvent.change(select, { target: { value: "SUPPLIER" } });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("role")).toBe(
      "SUPPLIER",
    );
  });

  // The list is the shared table, so on the phone every row is a card whose cells carry
  // their column's name: address and source do not vanish from the 390 px view.
  // The UNAS delivers addresses with HTML entities ("Dunaharaszti&nbsp;"): they must not reach
  // the screen raw.
  it("shows an address without its HTML entities", async () => {
    const data = response(2);
    data.items[0]!.address = "2330 Dunaharaszti&nbsp;Fő út 1.";
    api.list.mockResolvedValue(data);
    render(<CustomerListPage />);
    expect(await screen.findByText("2330 Dunaharaszti Fő út 1.")).toBeTruthy();
    expect(screen.queryByText(/&nbsp;/)).toBeNull();
  });

  it("opens the customer's page when a row is activated (acrobot 42510: an existing customer could not be edited)", async () => {
    render(<CustomerListPage />);
    const row = (await screen.findAllByTestId("customer-row"))[0]!;
    fireEvent.click(row);
    expect(navigation.push).toHaveBeenCalledWith("/vevok/customer-1");
  });

  it("labels every cell with its column for the phone card view", async () => {
    render(<CustomerListPage />);
    await screen.findByText("Fővárosi Állat- És Növénykert");
    const row = screen.getAllByTestId("customer-row")[0]!;
    const labels = [...row.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labels).toEqual(["Név", "Partnerkód", "Cím", "Forrás"]);
  });

  it("moves to the next page instead of returning to the first", async () => {
    render(<CustomerListPage />);
    await screen.findByText("Fővárosi Állat- És Növénykert");

    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("page")).toBe("3");
  });

  // MI PIROSÍT: ha a beszállító-szűrő üres listája nem mondja meg, miért üres (egy üres szűrő hibának látszik)
  it("says why the supplier filter is empty until the partners are linked to customer rows", async () => {
    const data = response(1);
    data.items = [];
    data.pagination = { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 };
    api.list.mockResolvedValue(data);
    navigation.params = new URLSearchParams("role=SUPPLIER");
    render(<CustomerListPage />);
    expect(await screen.findByText(/a partner-átvezetés után/)).toBeTruthy();
  });
});
