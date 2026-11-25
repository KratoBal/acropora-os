import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { SupplierListResponse, Session } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PilotSupplierListPage,
  SUPPLIER_COLUMNS,
  SUPPLIER_TABLE_MIN_WIDTH,
  SUPPLIER_TABLE_MIN_WIDTH_WITHOUT_CONTACT,
  supplierColumnsFor,
  supplierListQuery,
} from "./pilot-supplier-list-page";

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest alatt,
 * Next build nélkül nem futtatható, `TypeError: default is not a
 * function`-nal bukik. Ugyanaz a mock, mint a `worksheet-detail-page.
 * component.test.tsx`-ben és a `pilot-theme-root.component.test.tsx`-ben:
 * a `PilotThemeRoot` tranzitíven importálja a `pilot-ui.tsx`-en át.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn(), sync: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/partnerek",
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
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: api }));

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

function response(page: number): SupplierListResponse {
  return {
    items: [
      {
        id: "supplier-1",
        code: "BESZ-1",
        name: "Aqua Kereskedés Kft.",
        isSupplier: true,
        isService: false,
        country: "HU",
        isActive: true,
        contactPersonName: "Kovács Anna",
        email: "anna@aqua.example",
        phone: "+36 30 000 0000",
        createdAt: "2026-08-19T10:00:00.000Z",
        updatedAt: "2026-08-19T10:00:00.000Z",
      },
    ],
    pagination: { page, pageSize: 25, totalItems: 60, totalPages: 3 },
  };
}

/**
 * ÁTMÁSOLVA A RÉGI `supplier-list-page.component.test.tsx`-BŐL (2026-09-25,
 * Figma 13. kör, `PilotSupplierListPage`), ugyanazokkal az állításokkal --
 * a szűrés/lapozás/jogosultság logika a régi, nem-pilot komponensből
 * VÁLTOZATLANUL jött át, csak a kártya-szerkezet és a stílus a tervé.
 * A régi teszt-fájl és a régi komponens (`supplier-list-page.tsx`) ezzel
 * együtt törölve.
 *
 * Ugyanaz a mérés, mint az eszközlistán: a lapozás nem mehet a szűrő-ágon,
 * mert az a végén mindig `page=1`-et ír. A javítás előtti alakkal ez az
 * eset bukik - a "Következő" a 2. oldalról az elsőre visz vissza.
 */
describe("PilotSupplierListPage paging", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=2");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(2));
    api.sync.mockReset().mockResolvedValue({});
  });

  /** The Partners menu holds service partners too, not only suppliers, so the
   * button that starts a new record must not name one of the two kinds. The
   * editor screen carries the same label and is asserted in its own spec. */
  it("offers a neutral label for a new record", async () => {
    render(<PilotSupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");

    expect(screen.getByRole("button", { name: "Új felvitele" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Új beszállító" })).toBeNull();
  });

  // The list is the shared table: on the phone every row is a card, each cell labelled with its
  // column (the partner's name is the card title), and the row still opens the partner.
  it("labels every cell with its column for the phone card view", async () => {
    render(<PilotSupplierListPage />);
    await screen.findAllByTestId("supplier-row");
    const row = screen.getAllByTestId("supplier-row")[0]!;
    expect(
      [...row.querySelectorAll("td")].map((td) =>
        td.getAttribute("data-label"),
      ),
    ).toEqual(["Kód", "Név", "Ország", "Kapcsolattartó", "Státusz"]);
    expect(row.getAttribute("aria-label")).toContain("megnyitása");
  });

  it("the fixed column widths fit the table minimum", () => {
    const sum = SUPPLIER_COLUMNS.reduce(
      (acc, c) => acc + Number(/^(\d+)px$/.exec(c.width ?? "")?.[1]),
      0,
    );
    expect(sum).toBeLessThanOrEqual(SUPPLIER_TABLE_MIN_WIDTH);
  });

  /** The list holds two kinds now, and which one a row is has to be readable
   * without opening it. Both labels are asserted on one row that carries both,
   * because that is the case a single-label design would get wrong. */
  it("labels each partner with the kinds it actually is", async () => {
    api.list.mockResolvedValue({
      items: [
        {
          ...response(1).items[0]!,
          name: "Kettős Kft.",
          isSupplier: true,
          isService: true,
        },
      ],
      pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    });

    render(<PilotSupplierListPage />);
    await screen.findByText("Kettős Kft.");

    // Scoped to the row on purpose: the filter above the table offers the same
    // two words as options, so an unscoped search would pass on the filter
    // alone and say nothing about the row.
    const row = within(screen.getByRole("row", { name: /Kettős Kft\./ }));
    expect(row.getByText("Beszállító")).toBeTruthy();
    expect(row.getByText("Szerviz")).toBeTruthy();
  });

  /**
   * A service partner cannot be given a worksheet until it has a code, so the
   * gap is a task somebody has to finish. A blank cell says nothing about
   * that, and the person looking at the list is the one who can fix it.
   *
   * The pair matters: the row WITH a code must show the code, or "always show
   * the warning" would pass this too.
   */
  it("marks the service partner whose code is still missing", async () => {
    api.list.mockResolvedValue({
      items: [
        {
          ...response(1).items[0]!,
          id: "supplier-a",
          name: "Kódos Kft.",
          isService: true,
          worksheetPartnerCode: "KODO",
        },
        {
          ...response(1).items[0]!,
          id: "supplier-b",
          name: "Kódtalan Kft.",
          isService: true,
          worksheetPartnerCode: undefined,
        },
      ],
      pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 },
    });

    render(<PilotSupplierListPage />);
    await screen.findByText("Kódtalan Kft.");

    const withCode = within(screen.getByRole("row", { name: /Kódos Kft\./ }));
    expect(withCode.getByText("KODO")).toBeTruthy();
    expect(withCode.queryByText("Nincs kód")).toBeNull();

    const without = within(screen.getByRole("row", { name: /Kódtalan Kft\./ }));
    expect(without.getByText("Nincs kód")).toBeTruthy();
  });

  /** The filter has to reach the endpoint, because filtering an already-paged
   * result would leave the page count describing a different list than the one
   * on screen. */
  it("asks the endpoint for one kind instead of narrowing the page", async () => {
    render(<PilotSupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");

    fireEvent.change(screen.getByLabelText("Partner típusa"), {
      target: { value: "SERVICE" },
    });

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    const sent = new URLSearchParams(target.split("?")[1]);
    expect(sent.get("kind")).toBe("SERVICE");
    expect(sent.get("page")).toBe("1");
  });

  /**
   * A GOMB SZÖVEGE "Következő ›" (NYÍLLAL), A SAJÁT TERVKÖR SZERINT
   * (2026-09-25, acrobot döntése): a Partner lista `numberedTeal`
   * lapozó-változatot kapott, ami a plusz nyíl-glyphet is hordozza.
   */
  it("moves to the next page instead of returning to the first", async () => {
    render(<PilotSupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");

    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő ›" }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("page")).toBe("3");
  });
});

/*
  A LISTA RENDEZÉSE AZ OSZLOPFEJEN (Balázs kérése, kártya 2f6369a4). MI PIROSÍT: ha egy fejléc nem a saját szerver-mezőjét írja az URL-be
  (a kód, a név, az ország, az ügyintéző); ha a ciklus (növekvő, csökkenő, alap) elakad; ha a rendezés nem nullázza a lapot, vagy
  elveszíti a szűrőt; ha az URL rendezése nem jut a kérésbe, vagy egy ismeretlen mező (régi vagy kézzel írt link) igen (az API 400-at
  adna, és az egész lista eltörne); ha az elérhetőség vagy a státusz oszlop rendezhetőnek látszik.
*/
describe("PilotSupplierListPage sorting", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("page=3&kind=SERVICE");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(3));
  });

  const lastReplace = () =>
    new URLSearchParams(
      String(navigation.replace.mock.calls.at(-1)?.[0]).split("?")[1],
    );

  it("a header writes its own server field, ascending first, drops the page and keeps the filter", async () => {
    render(<PilotSupplierListPage />);
    await screen.findAllByTestId("supplier-row");
    fireEvent.click(screen.getByRole("button", { name: /Kapcsolattartó/ }));
    const url = lastReplace();
    expect(url.get("sort")).toBe("contactPersonName");
    expect(url.get("direction")).toBe("asc");
    expect(url.has("page")).toBe(false);
    expect(url.get("kind")).toBe("SERVICE");
  });

  it("each sortable header sends its own field", async () => {
    render(<PilotSupplierListPage />);
    await screen.findAllByTestId("supplier-row");
    for (const [name, field] of [
      ["Kód", "code"],
      ["Név", "name"],
      ["Ország", "country"],
    ] as const) {
      navigation.replace.mockReset();
      fireEvent.click(screen.getByRole("button", { name }));
      expect(lastReplace().get("sort"), name).toBe(field);
    }
  });

  it("the second click is descending, the third clears the sort", async () => {
    navigation.params = new URLSearchParams("sort=name&direction=asc");
    render(<PilotSupplierListPage />);
    await screen.findAllByTestId("supplier-row");
    fireEvent.click(screen.getByRole("button", { name: /Név/ }));
    expect(lastReplace().get("direction")).toBe("desc");

    // a mock a címet csak értesítésre olvassa újra: az URL "megváltozott"
    navigation.params = new URLSearchParams("sort=name&direction=desc");
    act(() => {
      for (const listener of navigation.listeners) listener();
    });
    navigation.replace.mockReset();
    fireEvent.click(screen.getByRole("button", { name: /Név/ }));
    expect(lastReplace().has("sort")).toBe(false);
    expect(lastReplace().has("direction")).toBe(false);
  });

  it("the URL's sort reaches the request, and an unknown or incomplete one does not", async () => {
    navigation.params = new URLSearchParams("sort=country&direction=desc");
    render(<PilotSupplierListPage />);
    await screen.findAllByTestId("supplier-row");
    const sent = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(sent.get("sort")).toBe("country");
    expect(sent.get("direction")).toBe("desc");

    for (const bad of [
      "sort=email&direction=asc",
      "sort=country",
      "sort=country&direction=up",
      "direction=asc",
    ]) {
      const query = supplierListQuery(new URLSearchParams(bad));
      expect(query.has("sort"), bad).toBe(false);
      expect(query.has("direction"), bad).toBe(false);
    }
    expect(
      Object.fromEntries(
        supplierListQuery(new URLSearchParams("kind=SERVICE")),
      ),
    ).toEqual({ kind: "SERVICE", page: "1", pageSize: "25" });
  });

  it("only the state has no sort button (the contact column sorts by the contact person)", async () => {
    render(<PilotSupplierListPage />);
    const table = await screen.findByRole("table");
    const sortable = within(table)
      .getAllByRole("columnheader")
      .filter((header) => within(header).queryByRole("button"))
      .map((header) => header.textContent?.replace(/[⇅↑↓]/g, ""));
    expect(sortable).toEqual(["Kód", "Név", "Ország", "Kapcsolattartó"]);
  });
});

/*
  A PARTNERLISTA (Picasso 3.6, acrobot 61991): az Ügyintéző és az Elérhetőség tíz sorból kilencben üres volt, ezért egy "Kapcsolattartó" oszlop lett belőlük
  (a név, alatta az e-mail és a telefon), ami el is tűnik, ha az oldal egyetlen sorában sincs semmi; a szűrők egy sorban állnak; a leírás a tartalomról szól.
  MI PIROSÍT: ha az üres oszlop újra áll; ha egy kapcsolati adat nélküli sor miatt eltűnik egy másiké; ha a leírás újra csak beszállítóról szól;
  ha a szűrők újra nyúlnak vagy külön sorba törnek.
*/
describe("PilotSupplierListPage: kapcsolattartó, szűrősor, leírás", () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({
      ...response(1).items[0]!,
      ...over,
    }) as SupplierListResponse["items"][number];

  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams("");
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response(1));
  });

  it("the contact column is one cell: the person, the e-mail and the phone", async () => {
    render(<PilotSupplierListPage />);
    const cell = (await screen.findByText("Kovács Anna")).closest("td")!;
    expect(cell.textContent).toContain("anna@aqua.example");
    expect(cell.textContent).toContain("+36 30 000 0000");
    expect(
      screen.queryByRole("columnheader", { name: /Elérhetőség/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: /Ügyintéző/ }),
    ).toBeNull();
  });

  it("the column is hidden when no partner on the page has any contact data, and the table minimum shrinks with it", async () => {
    const bare = row({ contactPersonName: null, email: null, phone: null });
    expect(supplierColumnsFor([bare, bare]).map((c) => c.id)).not.toContain(
      "contact",
    );
    expect(supplierColumnsFor([bare, bare])).toHaveLength(
      SUPPLIER_COLUMNS.length - 1,
    );
    expect(SUPPLIER_TABLE_MIN_WIDTH_WITHOUT_CONTACT).toBeLessThan(
      SUPPLIER_TABLE_MIN_WIDTH,
    );

    api.list.mockResolvedValue({ ...response(1), items: [bare] });
    render(<PilotSupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");
    expect(
      screen.queryByRole("columnheader", { name: /Kapcsolattartó/ }),
    ).toBeNull();
  });

  it("one partner with a phone alone keeps the column for the whole page, and an empty page keeps all columns", () => {
    const bare = row({ contactPersonName: null, email: null, phone: null });
    const phoneOnly = row({
      id: "s2",
      contactPersonName: null,
      email: null,
      phone: "+36 1 000 0000",
    });
    expect(supplierColumnsFor([bare, phoneOnly]).map((c) => c.id)).toContain(
      "contact",
    );
    expect(supplierColumnsFor([])).toBe(SUPPLIER_COLUMNS);
  });

  it("a partner without contact data shows a pale dash in the column the others fill", async () => {
    api.list.mockResolvedValue({
      ...response(1),
      items: [
        row(),
        row({
          id: "s2",
          name: "Üres Kft.",
          contactPersonName: null,
          email: null,
          phone: null,
        }),
      ],
    });
    render(<PilotSupplierListPage />);
    const cell = (await screen.findByText("Üres Kft."))
      .closest("tr")!
      .querySelectorAll("td")[3]!;
    expect(cell.textContent).toBe("—");
  });

  it("the description speaks about suppliers AND service partners, not only suppliers", async () => {
    render(<PilotSupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");
    expect(
      screen.getByText(/Beszállítók és szerviz partnerek/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Beszállítói törzsadatok/)).toBeNull();
    expect(screen.getByLabelText("Partner keresése")).toBeInTheDocument();
  });

  it("the filter bar: the search is capped, the two selects have a fixed width that does not shrink, and the type filter says what it filters", async () => {
    render(<PilotSupplierListPage />);
    await screen.findByText("Aqua Kereskedés Kft.");
    const search = screen
      .getByLabelText("Partner keresése")
      .closest("div[class*='sm:max-w']");
    expect(search).not.toBeNull();
    for (const label of ["Státusz", "Partner típusa"]) {
      const wrapper = screen.getByLabelText(label).parentElement!;
      expect(wrapper.className).toContain("shrink-0");
      expect(wrapper.className).toMatch(/sm:w-\[\d+px\]/);
    }
    const kind = screen.getByLabelText("Partner típusa") as HTMLSelectElement;
    expect(kind.options[0]!.textContent).toBe("Minden típus");
  });
});
