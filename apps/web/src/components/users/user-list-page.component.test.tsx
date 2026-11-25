import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { UserListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserListPage, userListQuery } from "./user-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn(), sync: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/users",
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
vi.mock("@/lib/api/users", () => ({ usersApi: api }));

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

function response(page: number): UserListResponse {
  return {
    items: [
      {
        id: "user-2",
        firstName: "Sándor",
        lastName: "Szerelő",
        displayName: "Szerelő Sándor",
        nickname: null,
        email: "sanyi@acropora.local",
        role: "SERVICE",
        isActive: true,
        hasPassword: true,
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
describe("UserListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
    api.sync.mockReset().mockResolvedValue({});
  });

  // The list is the shared table: on the phone a row is a card, each cell labelled.
  it("labels every cell with its column for the phone card view", async () => {
    render(<UserListPage />);
    await screen.findByText("Szerelő Sándor");
    const row = screen.getAllByTestId("user-row")[0]!;
    const labels = [...row.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labels).toEqual(["Név", "E-mail", "Szerepkör", "Státusz", "Jelszó"]);
  });

  // Picasso 3.17: the only two screens with purple links were this and the tutorials list; the name link is the system's green now
  it("the name link is the system's link green, not the purple brand colour", async () => {
    render(<UserListPage />);
    const link = await screen.findByRole("link", { name: "Szerelő Sándor" });
    expect(link.className).toContain("text-pilot-aqua-700");
    expect(link.className).not.toContain("brand");
  });

  it("moves to the next page instead of returning to the first", async () => {
    render(<UserListPage />);
    await screen.findByText("Szerelő Sándor");

    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("page")).toBe("3");
  });
});

/*
  A LISTA RENDEZÉSE AZ OSZLOPFEJEN (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha a név vagy az e-mail fejléce nem a saját
  szerver-mezőjét írja az URL-be; ha a ciklus (növekvő, csökkenő, alap) elakad; ha a rendezés nem nullázza a lapot, vagy elveszíti a
  szűrőt; ha az URL rendezése nem jut a kérésbe, vagy egy ismeretlen mező (régi vagy kézzel írt link) igen (az API 400-at adna, és az
  egész lista eltörne); ha a szerepkör, a státusz vagy a jelszó oszlop rendezhetőnek látszik.
*/
describe("UserListPage sorting", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=3&status=ALL");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(3));
  });

  const lastReplace = () =>
    new URLSearchParams(
      String(navigation.replace.mock.calls.at(-1)?.[0]).split("?")[1],
    );

  it("a header writes its own server field, ascending first, drops the page and keeps the filter", async () => {
    render(<UserListPage />);
    const table = await screen.findByRole("table");
    for (const [name, field] of [
      ["Név", "displayName"],
      ["E-mail", "email"],
    ] as const) {
      navigation.replace.mockReset();
      fireEvent.click(within(table).getByRole("button", { name }));
      const url = lastReplace();
      expect(url.get("sort"), name).toBe(field);
      expect(url.get("direction"), name).toBe("asc");
      expect(url.has("page"), name).toBe(false);
      expect(url.get("status"), name).toBe("ALL");
    }
  });

  it("the second click is descending, the third clears the sort", async () => {
    navigation.params = new URLSearchParams("sort=email&direction=asc");
    render(<UserListPage />);
    const table = await screen.findByRole("table");
    fireEvent.click(within(table).getByRole("button", { name: "E-mail" }));
    expect(lastReplace().get("direction")).toBe("desc");

    // a mock a címet csak értesítésre olvassa újra: az URL "megváltozott"
    navigation.params = new URLSearchParams("sort=email&direction=desc");
    act(() => {
      for (const listener of navigation.listeners) listener();
    });
    navigation.replace.mockReset();
    fireEvent.click(within(table).getByRole("button", { name: "E-mail" }));
    expect(lastReplace().has("sort")).toBe(false);
    expect(lastReplace().has("direction")).toBe(false);
  });

  it("the URL's sort reaches the request, and an unknown or incomplete one does not", async () => {
    navigation.params = new URLSearchParams("sort=displayName&direction=desc");
    render(<UserListPage />);
    await screen.findByRole("table");
    const sent = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(sent.get("sort")).toBe("displayName");
    expect(sent.get("direction")).toBe("desc");

    for (const bad of [
      "sort=role&direction=asc",
      "sort=email",
      "sort=email&direction=up",
      "direction=asc",
    ]) {
      const query = userListQuery(new URLSearchParams(bad));
      expect(query.has("sort"), bad).toBe(false);
      expect(query.has("direction"), bad).toBe(false);
    }
    expect(
      Object.fromEntries(userListQuery(new URLSearchParams("status=ALL"))),
    ).toEqual({ status: "ALL", page: "1", pageSize: "25" });
  });

  it("only the name and the e-mail columns have a sort button", async () => {
    render(<UserListPage />);
    const table = await screen.findByRole("table");
    const sortable = within(table)
      .getAllByRole("columnheader")
      .filter((header) => within(header).queryByRole("button"))
      .map((header) => header.textContent?.replace(/[⇅↑↓]/g, ""));
    expect(sortable).toEqual(["Név", "E-mail"]);
  });
});
