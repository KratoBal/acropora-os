import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  ServiceJobListItem,
  ServiceJobListResponse,
  ServiceJobStatusValue,
  Session,
} from "@acropora/types";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  JOB_COLUMNS,
  JOB_TABLE_MIN_WIDTH,
  PilotServiceJobListPage,
  resolveUrlFilters,
  serviceJobListPageFromUrl,
  serviceJobListQuery,
  serviceJobListStateFromUrl,
} from "./pilot-service-job-list-page";

/**
 * BALÁZS KÉRÉSE (2026-09-30 12:29 UTC): egy szűrt listáról az adatlapra, majd
 * vissza, a szűrés maradjon meg. A hibajegy-lista eddig helyi állapotban
 * tartotta a fület, a keresést és a partner/helyszín szűrőt, tehát a
 * visszatérés mindig a "Nyitott hibajegy" fülre, szűretlenül ért vissza.
 * Ez a spec azt méri, hogy az állapot az URL-ből indul és oda íródik vissza.
 */

vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  search: "",
  cache: new Map<string, URLSearchParams>(),
}));

// Stable params per query string, the way Next.js keeps them between renders:
// a fresh object on every render would re-run the URL effect for nothing.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigation.replace,
    push: navigation.push,
  }),
  usePathname: () => "/szerviz/hibajegyek",
  useSearchParams: () => {
    let params = navigation.cache.get(navigation.search);
    if (!params) {
      params = new URLSearchParams(navigation.search);
      navigation.cache.set(navigation.search, params);
    }
    return params;
  },
}));

const api = vi.hoisted(() => ({ list: vi.fn(), facets: vi.fn() }));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "admin@acropora.local",
    displayName: "Admin",
    nickname: null,
    role: "ADMIN",
    customerId: null,
    supplierId: null,
  },
};
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session }),
}));

function item(
  id: string,
  status: ServiceJobStatusValue,
  customerName: string,
): ServiceJobListItem {
  return {
    id,
    jobNumber: `HJ-${id}`,
    title: `Jegy ${id}`,
    kind: "REPAIR",
    status,
    partnerStatus: "IN_PROGRESS",
    partnerStatusLabel: "Feldolgozás alatt",
    customerName,
    departmentPath: null,
    departmentCode: null,
    assignees: [],
    worksheetCount: 0,
    createdAt: "2026-09-30T10:00:00.000Z",
    hidden: false,
  };
}

const response: ServiceJobListResponse = {
  items: [
    item("1", "COMPLETED", "Alfa Kft"),
    item("2", "COMPLETED", "Beta Kft"),
    item("3", "NEW", "Alfa Kft"),
  ],
  counts: {
    NEW: 1,
    TRIAGED: 0,
    SCHEDULED: 0,
    IN_PROGRESS: 0,
    WAITING_FOR_PARTS: 0,
    WAITING_FOR_CUSTOMER: 0,
    COMPLETED: 2,
    CANCELLED: 0,
  },
  truncated: false,
};

// the partner and location options come from the server's facets now, by id (not from the loaded rows)
const facets = {
  partners: [
    { id: "cust-alfa", name: "Alfa Kft" },
    { id: "cust-beta", name: "Beta Kft" },
  ],
  locations: [
    { id: "dep-1", label: "AKV · Nagy medence" },
    { id: "dep-2", label: "Medence kettő" },
  ],
};

// the paging, sort and filter arguments of a list call; the open tab asks for the four really open statuses
function extra(overrides: Record<string, unknown> = {}) {
  return {
    page: 1,
    pageSize: 25,
    sort: undefined,
    direction: undefined,
    statuses: ["NEW", "TRIAGED", "SCHEDULED", "IN_PROGRESS"],
    customerId: undefined,
    departmentId: undefined,
    ...overrides,
  };
}

/*
  STRICT MODE-BAN RENDERELÜNK, mert a fejlesztői szerver is abban fut, és ott
  minden effekt kétszer indul. Egy "az első futást kihagyom" jelzőre épített
  nullázás itt a második futáson nullázná az URL-ből jött partnert.
*/
function renderAt(search: string) {
  navigation.search = search;
  return render(
    <StrictMode>
      <PilotServiceJobListPage />
    </StrictMode>,
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

beforeEach(() => {
  navigation.replace.mockReset();
  navigation.push.mockReset();
  navigation.cache.clear();
  api.list.mockReset();
  api.list.mockResolvedValue(response);
  api.facets.mockReset();
  api.facets.mockResolvedValue(facets);
});

describe("service-job list state in the URL", () => {
  it("reads the tab, search and partner from the URL, and leaves the URL alone", async () => {
    renderAt("tab=closed&q=szivatty&partner=cust-beta");

    await screen.findByText("Jegy 2");
    await settle();

    // the closed tab asks for the closed statuses (the server filters), with the URL's search and partner, page 1 of 25
    expect(api.list).toHaveBeenLastCalledWith(
      "token-1",
      "all",
      expect.anything(),
      "szivatty",
      false,
      "REPAIR",
      undefined,
      { from: "", to: "" },
      {
        page: 1,
        pageSize: 25,
        sort: undefined,
        direction: undefined,
        statuses: ["COMPLETED", "CANCELLED"],
        customerId: "cust-beta",
        departmentId: undefined,
      },
    );
    expect(
      (screen.getByLabelText("Partner szűrő") as HTMLSelectElement).value,
    ).toBe("cust-beta");
    // nothing was reset, so there is nothing to write back
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  // The table must not scroll inside its card on a 1280 px laptop: viewport 1280 - sidebar 224 -
  // 2 x 32 page margin = 992 px of card (at 1440 px it is 1152). The first version summed to 1220
  // and cut the last column at 1440 px (stage 6f221c3d).
  const CARD_AT_1280 = 1280 - 224 - 2 * 32;
  const MIN_FLEXIBLE_COLUMN = 160;

  it("the fixed column widths leave every flexible column its minimum", () => {
    const fixed = JOB_COLUMNS.filter((c) => c.width);
    const flexible = JOB_COLUMNS.filter((c) => !c.width);
    const sum = fixed.reduce(
      (acc, c) => acc + Number(/^(\d+)px$/.exec(c.width ?? "")?.[1]),
      0,
    );
    expect(flexible.map((c) => c.id)).toEqual(["job", "customer"]);
    expect(sum + flexible.length * MIN_FLEXIBLE_COLUMN).toBeLessThanOrEqual(
      JOB_TABLE_MIN_WIDTH,
    );
  });

  it("the table minimum fits the card of a 1280 px screen, so it does not scroll", () => {
    expect(JOB_TABLE_MIN_WIDTH).toBeLessThanOrEqual(CARD_AT_1280);
  });

  // The list is the shared table: on the phone every row is a card, each cell labelled with its
  // column, so the partner, the state and the date do not disappear at 390 px.
  it("labels every cell with its column for the phone card view", async () => {
    renderAt("");
    await screen.findByText("Jegy 3");
    const row = screen.getAllByTestId("service-job-row")[0]!;
    const labels = [...row.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label"),
    );
    expect(labels).toEqual([
      "Hibajegy",
      "Partner / helyszín",
      "Felelős",
      "Állapot",
      "Munkalap",
      "Létrehozva",
      null,
    ]);
    // the row opens the ticket on click and on the keyboard (shared table behaviour)
    expect(row.getAttribute("aria-label")).toContain("megnyitása");
  });

  it("writes a filter change back to the URL", async () => {
    renderAt("tab=closed");
    await screen.findByText("Jegy 1");

    fireEvent.change(screen.getByLabelText("Partner szűrő"), {
      target: { value: "cust-alfa" },
    });
    await settle();

    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/szerviz/hibajegyek?tab=closed&partner=cust-alfa",
      { scroll: false },
    );
  });

  it("clears the partner when the tab changes, and the URL follows", async () => {
    renderAt("tab=closed&partner=cust-beta");
    await screen.findByText("Jegy 2");

    fireEvent.click(screen.getByRole("tab", { name: /^Összes/ }));
    await settle();

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenLastCalledWith(
        "/szerviz/hibajegyek?tab=all",
        { scroll: false },
      ),
    );
  });
});

describe("serviceJobListStateFromUrl / serviceJobListQuery", () => {
  it("round-trips a full state and keeps the default tab out of the URL", () => {
    const state = {
      tab: "waiting" as const,
      search: "pumpa",
      includeHidden: true,
      partner: "Alfa Kft",
      location: "A / B",
      createdFrom: "2026-11-18",
      createdTo: "2026-11-19",
    };
    const query = serviceJobListQuery(state);
    expect(serviceJobListStateFromUrl(new URLSearchParams(query))).toEqual(
      state,
    );
    expect(
      serviceJobListQuery({
        ...serviceJobListStateFromUrl(new URLSearchParams()),
      }),
    ).toBe("");
  });

  it("falls back to the open tab on an unknown tab value", () => {
    expect(
      serviceJobListStateFromUrl(new URLSearchParams("tab=bogus")).tab,
    ).toBe("open");
  });
});

/**
 * THE SERVICE REDESIGN'S LIST (Figma 423:20, Balázs, 2026-10-04): the
 * "Felelős" column by name, the partner's status under the internal one,
 * the stat tiles from the server's counts, and the hidden-rows switch only
 * for whoever may restore a hidden job.
 */
describe("service-job list, redesign columns", () => {
  function withRows(rows: ServiceJobListItem[]) {
    api.list.mockResolvedValue({ ...response, items: rows });
  }

  it("names every assignee in the Felelős column", async () => {
    withRows([
      {
        ...item("3", "NEW", "Alfa Kft"),
        assignees: [
          { userId: "u-1", name: "Ádám", assignedAt: "2026-10-01T08:00:00Z" },
          { userId: "u-2", name: "Péter", assignedAt: "2026-10-01T09:00:00Z" },
        ],
      },
    ]);
    renderAt("");
    expect(await screen.findByText("Ádám, Péter")).toBeTruthy();
    expect(screen.queryByText("Nincs kiosztva")).toBeNull();
  });

  it("says Nincs kiosztva when nobody is assigned", async () => {
    withRows([item("3", "NEW", "Alfa Kft")]);
    renderAt("");
    expect(await screen.findByText("Nincs kiosztva")).toBeTruthy();
  });

  // A PARTNER ÁLLAPOTA NEM ISMÉTLŐDIK A LISTA SORAIBAN (picasso, f0b70dbd, 2. pont): minden soron ugyanazt mondta, zaj volt; az adatlapon marad.
  it("shows the internal status badge and does not repeat the partner's status on the row", async () => {
    withRows([item("3", "NEW", "Alfa Kft")]);
    renderAt("");
    await screen.findByText("Jegy 3");
    expect(screen.getByText("Új")).toBeTruthy();
    expect(screen.queryByText(/A partner ezt látja/)).toBeNull();
    expect(screen.queryByText(/Feldolgozás alatt/)).toBeNull();
  });

  it("draws the stat tiles from the server's counts", async () => {
    api.list.mockResolvedValue({
      ...response,
      counts: {
        ...response.counts,
        NEW: 2,
        IN_PROGRESS: 5,
        WAITING_FOR_PARTS: 2,
        WAITING_FOR_CUSTOMER: 1,
        COMPLETED: 20,
        CANCELLED: 8,
      },
    });
    renderAt("");
    const tiles = await screen.findByLabelText("Összesítés");
    await waitFor(() =>
      expect(tiles.textContent).toContain("Nyitott hibajegy7"),
    );
    expect(tiles.textContent).toContain("2 új");
    expect(tiles.textContent).toContain("Várakozik3");
    expect(tiles.textContent).toContain("2 alkatrészre · 1 ügyfélre");
    expect(tiles.textContent).toContain("Lezárt ügy28");
    // decisions E1, E2: no priority and no monthly figure
    expect(tiles.textContent).not.toMatch(/sürgős|hónap/);
  });

  it("shows a long partner and location in full, not cut off", async () => {
    const longName =
      "Fővárosi Állat- és Növénykert Nonprofit Zártkörűen Működő Részvénytársaság";
    withRows([
      {
        ...item("3", "NEW", longName),
        departmentPath: ["Pálmaház", "Tengeri akváriumok", "Nagy medence"],
      },
    ]);
    renderAt("");
    const name = await screen.findByText(longName, { selector: "p" });
    expect(name.className).not.toContain("truncate");
    expect(
      screen.getByText("Pálmaház / Tengeri akváriumok / Nagy medence"),
    ).toBeTruthy();
  });

  it("asks the server for hidden rows when the switch is on", async () => {
    renderAt("");
    await screen.findByText("Jegy 3");
    fireEvent.click(screen.getByRole("button", { name: "Rejtettek is" }));
    await settle();
    expect(api.list).toHaveBeenLastCalledWith(
      "token-1",
      "open",
      expect.anything(),
      "",
      true,
      "REPAIR",
      undefined,
      { from: "", to: "" },
      extra(),
    );
  });

  it("does not offer the hidden-rows switch without the hide permission", async () => {
    const role = session.user.role;
    session.user.role = "SERVICE";
    try {
      renderAt("");
      await screen.findByText("Jegy 3");
      expect(screen.queryByRole("button", { name: "Rejtettek is" })).toBeNull();
      // the service role still opens new jobs
      expect(screen.getByText("Új hibajegy")).toBeTruthy();
    } finally {
      session.user.role = role;
    }
  });
});

/**
 * A LÉTREHOZÁS TÓL-IG SZŰRŐJE (Luca, 2026-11-20 09:39 UTC). MI PIROSÍT: ha a mezők nem a createdFrom/createdTo paramétert
 * küldik a szervernek, vagy nem íródnak az URL-be; ha az URL-ben álló nap nem megy át, vagy nem magyarul látszik a mezőben;
 * ha a felirat nem mondja ki, melyik dátumra szűr; ha a félig beírt nap kérést indít; ha a fordított tartomány nem szól.
 */
describe("service-job list, the created-day filter", () => {
  it("a felirat a létrehozásra szűr, és a két mező a createdFrom / createdTo paramétert küldi, az URL-be is", async () => {
    renderAt("");
    await screen.findByText("Jegy 3");
    expect(
      screen.getByRole("group", { name: "Létrehozás napja" }).textContent,
    ).toMatch(/^Létrehozva/);
    fireEvent.change(screen.getByLabelText("Létrehozva ettől a naptól"), {
      target: { value: "2026-11-18" },
    });
    fireEvent.change(screen.getByLabelText("Létrehozva eddig a napig"), {
      target: { value: "2026-11-19" },
    });
    await settle();
    expect(api.list).toHaveBeenLastCalledWith(
      "token-1",
      "open",
      expect.anything(),
      "",
      false,
      "REPAIR",
      undefined,
      { from: "2026-11-18", to: "2026-11-19" },
      extra(),
    );
    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/szerviz/hibajegyek?createdFrom=2026-11-18&createdTo=2026-11-19",
      { scroll: false },
    );
  });

  it("az URL-ben álló nap átmegy a szerverhez, és magyarul látszik a mezőben", async () => {
    renderAt("createdFrom=2026-11-18&createdTo=2026-11-19");
    await screen.findByText("Jegy 3");
    expect(api.list.mock.calls.at(-1)?.[7]).toEqual({
      from: "2026-11-18",
      to: "2026-11-19",
    });
    expect(
      (screen.getByLabelText("Létrehozva ettől a naptól") as HTMLInputElement)
        .value,
    ).toBe("2026. 11. 18.");
    expect(
      (screen.getByLabelText("Létrehozva eddig a napig") as HTMLInputElement)
        .value,
    ).toBe("2026. 11. 19.");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("a félig beírt nap nem szűrőváltozás: nem megy új kérés", async () => {
    renderAt("");
    await screen.findByText("Jegy 3");
    await settle();
    const before = api.list.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Létrehozva ettől a naptól"), {
      target: { value: "20261" },
    });
    await settle();
    expect(api.list.mock.calls.length).toBe(before);
  });

  it("a fordított tartomány kimondja, mi a baj; a rendes nem szól", async () => {
    const reversed = renderAt("createdFrom=2026-11-20&createdTo=2026-11-19");
    await screen.findByText("Jegy 3");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /kezdő dátum a záró dátum után/,
    );
    reversed.unmount();
    renderAt("createdFrom=2026-11-19&createdTo=2026-11-19");
    await screen.findByText("Jegy 3");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/*
  A HIBAJEGY-LISTA (a) CSOMAGJA (picasso, f0b70dbd, 1., 4., 5., 7. pont és az állapotok). MI PIROSÍT: ha a fül száma nem a csempék
  száma (egy `counts`, két megjelenítés), vagy a "Lezárt" nem a Meghiúsultat is számolja; ha a "0 munkalap" jelvény marad, vagy az "1
  munkalap" jelvényt veszít; ha a hosszú cím nincs két sorra vágva, vagy nincs tooltip a teljes szöveggel; ha a sor billentyűvel
  (Enter) vagy a nyílon kívüli kattintással nem nyílik; ha a szűrő miatti üres lista nem kínál "Szűrők törlése" gombot (és az nem
  törli a keresést és a szűrőket); ha egy betöltési hiba üres listának látszik (nincs hibaüzenet, nincs újrapróbálás).
*/
describe("service-job list (a): tabs with numbers, quiet rows, states", () => {
  const withRows = (rows: ServiceJobListItem[]) =>
    api.list.mockResolvedValue({ ...response, items: rows });

  it("puts the numbers on the tabs, from the same counts as the tiles, the closed tab counting the failed ones too", async () => {
    api.list.mockResolvedValue({
      ...response,
      counts: {
        NEW: 2,
        TRIAGED: 1,
        SCHEDULED: 1,
        IN_PROGRESS: 2,
        WAITING_FOR_PARTS: 2,
        WAITING_FOR_CUSTOMER: 1,
        COMPLETED: 20,
        CANCELLED: 8,
      },
    });
    renderAt("");
    await screen.findByText("Jegy 3");
    expect(screen.getByRole("tab", { name: "Nyitott 6" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Várakozik 3" })).toBeTruthy();
    // Meghiúsult (CANCELLED) is closed: 20 + 8
    expect(screen.getByRole("tab", { name: "Lezárt 28" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Összes 37" })).toBeTruthy();
    // a csempe ugyanazt a három számot mondja
    const tiles = screen.getByLabelText("Összesítés");
    expect(within(tiles).getByText("6")).toBeTruthy();
    expect(within(tiles).getByText("3")).toBeTruthy();
    expect(within(tiles).getByText("28")).toBeTruthy();
  });

  it("shows no tab numbers before the counts have arrived", () => {
    api.list.mockReturnValue(new Promise(() => undefined));
    renderAt("");
    expect(screen.getByRole("tab", { name: "Nyitott" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Lezárt" })).toBeTruthy();
  });

  it("gives 0 worksheets no badge and a dash, and 1 or more a badge", async () => {
    withRows([
      { ...item("1", "NEW", "Alfa Kft"), worksheetCount: 0 },
      { ...item("2", "NEW", "Alfa Kft"), worksheetCount: 1 },
      { ...item("3", "NEW", "Alfa Kft"), worksheetCount: 3 },
    ]);
    renderAt("");
    await screen.findByText("Jegy 1");
    expect(screen.queryByText("0 munkalap")).toBeNull();
    expect(screen.getAllByLabelText("Nincs munkalap")).toHaveLength(1);
    expect(screen.getByText("1 munkalap")).toBeTruthy();
    expect(screen.getByText("3 munkalap")).toBeTruthy();
  });

  it("clamps a long title to two lines and keeps the whole text in the tooltip", async () => {
    const longTitle =
      "Rendellenesség: Vízóra-leolvasás (stage-próba), ESZK-20260922-134703h-45D5 AKV/A11 Homokszűrő és még egy hosszú folytatás";
    withRows([{ ...item("1", "NEW", "Alfa Kft"), title: longTitle }]);
    renderAt("");
    const title = await screen.findByText(longTitle);
    expect(title.className).toContain("line-clamp-2");
    expect(title.getAttribute("title")).toBe(longTitle);
  });

  it("opens the job with Enter on the row and with a click anywhere on it, not only on the arrow", async () => {
    withRows([item("3", "NEW", "Alfa Kft")]);
    renderAt("");
    const row = (await screen.findAllByTestId("service-job-row"))[0]!;
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.getAttribute("aria-label")).toBe("HJ-3 Jegy 3 megnyitása");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(navigation.push).toHaveBeenCalledWith("/szerviz/hibajegyek/3");
    navigation.push.mockClear();
    fireEvent.click(within(row).getByText("Jegy 3"));
    expect(navigation.push).toHaveBeenCalledWith("/szerviz/hibajegyek/3");
  });

  it("offers Szűrők törlése on a filtered-empty list, and it clears the search and the filters", async () => {
    // the server filters: a partner that is known but has no tickets here gives an empty list, and without the filter the row comes back
    api.list.mockImplementation(
      async (...args: unknown[]) =>
        ({
          ...response,
          items: (args[8] as { customerId?: string }).customerId
            ? []
            : [item("3", "NEW", "Alfa Kft")],
        }) satisfies ServiceJobListResponse,
    );
    renderAt("partner=cust-beta");
    expect(await screen.findByText("Nincs találat")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Szűrők törlése" }));
    expect(await screen.findByText("Jegy 3")).toBeTruthy();
    expect(screen.queryByText("Nincs találat")).toBeNull();
  });

  it("a load error is said as an error, with a retry, and is not an empty list", async () => {
    api.list.mockRejectedValue(new Error("A szerver nem érhető el."));
    renderAt("");
    expect(await screen.findByText("Betöltési hiba")).toBeTruthy();
    expect(screen.getByText("A szerver nem érhető el.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Újrapróbálás" })).toBeTruthy();
    expect(screen.queryByText("Még nincs hibajegy")).toBeNull();
    expect(screen.queryByText("Nincs találat")).toBeNull();
  });

  it("an empty list says so and offers the first ticket", async () => {
    withRows([]);
    renderAt("");
    expect(await screen.findByText("Még nincs hibajegy")).toBeTruthy();
    // a fejlécben és az üres állapot kártyáján is ott a gomb
    expect(screen.getAllByRole("link", { name: /Új hibajegy/ })).toHaveLength(
      2,
    );
  });
});

/**
 * (b) KÖR (f0b70dbd): a lista szerveroldali lapozású és rendezett, a fül az állapot-szűrő, a partner és a helyszín azonosítóval szűr, és a
 * legördülők a szerver szűrő-lehetőségeiből épülnek. MI PIROSÍT: ha az oldalszám nem az URL-ből jön, vagy nem kerül vissza oda; ha egy
 * szűrőváltás nem az első oldalra visz (és egy kérés megy el, nem kettő); ha a rendezés elvész egy szűrő-váltásnál; ha a fül nem az
 * állapotokat kéri; ha a legördülők a betöltött sorokból épülnek.
 */
describe("service-job list (b): server paging, sort, status tabs, facets", () => {
  const paged = (page: number, totalItems: number, rows = response.items) => ({
    ...response,
    items: rows,
    pagination: {
      page,
      pageSize: 25,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / 25)),
    },
  });

  it("asks for the page in the URL, says the row range of the filtered set, and pages with the page key only", async () => {
    api.list.mockResolvedValue(paged(2, 61));
    renderAt("tab=closed&sort=createdAt&direction=desc&page=2");
    await screen.findByText("Jegy 3");
    await settle();
    expect(api.list).toHaveBeenLastCalledWith(
      "token-1",
      "all",
      expect.anything(),
      "",
      false,
      "REPAIR",
      undefined,
      { from: "", to: "" },
      extra({
        page: 2,
        sort: "createdAt",
        direction: "desc",
        statuses: ["COMPLETED", "CANCELLED"],
      }),
    );
    // 3 rows on page 2 of 25: "26–28 / 61"
    expect(screen.getByText(/26–28 \/ 61 lezárt hibajegy/)).toBeTruthy();
    // the URL already says everything: nothing is written back
    expect(navigation.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Következő" }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/szerviz/hibajegyek?tab=closed&sort=createdAt&direction=desc&page=3",
      { scroll: false },
    );
  });

  it("shows no pager when everything fits one page", async () => {
    api.list.mockResolvedValue(paged(1, 3));
    renderAt("");
    await screen.findByText("Jegy 3");
    expect(screen.queryByRole("button", { name: "Következő" })).toBeNull();
    expect(screen.getByText(/1–3 \/ 3 nyitott hibajegy/)).toBeTruthy();
  });

  it("a filter change goes to the first page in ONE request, and keeps the sort", async () => {
    api.list.mockResolvedValue(paged(3, 61));
    renderAt("tab=closed&sort=jobNumber&direction=asc&page=3");
    await screen.findByText("Jegy 3");
    await settle();
    api.list.mockClear();

    fireEvent.click(screen.getByRole("tab", { name: /^Összes/ }));
    await settle();

    // no request with the old page and the new tab
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.list).toHaveBeenLastCalledWith(
      "token-1",
      "all",
      expect.anything(),
      "",
      false,
      "REPAIR",
      undefined,
      { from: "", to: "" },
      extra({
        page: 1,
        sort: "jobNumber",
        direction: "asc",
        statuses: null,
      }),
    );
    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/szerviz/hibajegyek?tab=all&sort=jobNumber&direction=asc",
      { scroll: false },
    );
  });

  it("clicking a sortable header writes the sort key and drops the page; the state column is not sortable", async () => {
    api.list.mockResolvedValue(paged(2, 61));
    renderAt("page=2");
    await screen.findByText("Jegy 3");
    fireEvent.click(screen.getByRole("button", { name: /Hibajegy/ }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/szerviz/hibajegyek?sort=jobNumber&direction=asc",
      { scroll: false },
    );
    expect(screen.queryByRole("button", { name: /^Állapot/ })).toBeNull();
    expect(
      JOB_COLUMNS.filter((column) => column.sortable).map(
        (column) => column.id,
      ),
    ).toEqual(["job", "createdAt"]);
  });

  it("builds the partner and location options from the server's facets, and asks for them with the tab's statuses", async () => {
    renderAt("tab=waiting");
    await screen.findByText("Jegy 3");
    await settle();
    expect(api.facets).toHaveBeenLastCalledWith(
      "token-1",
      "open",
      expect.anything(),
      "",
      false,
      { from: "", to: "" },
      ["WAITING_FOR_PARTS", "WAITING_FOR_CUSTOMER"],
    );
    const partners = within(screen.getByLabelText("Partner szűrő"));
    expect(
      partners.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Minden partner", "Alfa Kft", "Beta Kft"]);
    const locations = within(screen.getByLabelText("Helyszín szűrő"));
    expect(
      locations.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Minden helyszín", "AKV · Nagy medence", "Medence kettő"]);
  });

  it("sends the chosen location by its id, and goes back to the last page when the URL's page is gone", async () => {
    api.list.mockResolvedValue({ ...paged(9, 30), items: [] });
    renderAt("location=dep-2&page=9");
    await settle();
    expect(api.list).toHaveBeenCalledWith(
      "token-1",
      "open",
      expect.anything(),
      "",
      false,
      "REPAIR",
      undefined,
      { from: "", to: "" },
      extra({ page: 9, departmentId: "dep-2" }),
    );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenLastCalledWith(
        "/szerviz/hibajegyek?location=dep-2&page=2",
        { scroll: false },
      ),
    );
    expect(screen.queryByText("Nincs találat")).toBeNull();
  });

  it("reads the page from the URL only when it is a positive whole number", () => {
    for (const [query, page] of [
      ["", 1],
      ["page=4", 4],
      ["page=0", 1],
      ["page=-2", 1],
      ["page=2.5", 1],
      ["page=x", 1],
    ] as const)
      expect(serviceJobListPageFromUrl(new URLSearchParams(query)), query).toBe(
        page,
      );
  });
});

/**
 * A RÉGI, NEVET HORDOZÓ URL-EK (acrobot 61765, Luca könyvjelzői). MI PIROSÍT: ha egy ismeretlen partner üres listát ad magyarázat nélkül;
 * ha a lista a szűrő-lehetőségek előtt, a rossz értékkel kér; ha a név nem íródik át azonosítóra; ha a későbbi (keresésre szűkült)
 * lehetőségek kidobják a felhasználó választotta partnert.
 */
describe("service-job list (b): old URLs that carry a name", () => {
  const lastExtra = () =>
    api.list.mock.calls.at(-1)![8] as Record<string, unknown>;

  it("rewrites a partner NAME to its id before the first list request, and the URL follows", async () => {
    renderAt("partner=Beta+Kft");
    await screen.findByText("Jegy 3");
    await settle();
    // never asked with the name
    for (const call of api.list.mock.calls)
      expect((call[8] as { customerId?: string }).customerId).toBe("cust-beta");
    expect(
      (screen.getByLabelText("Partner szűrő") as HTMLSelectElement).value,
    ).toBe("cust-beta");
    expect(screen.queryByText(/A régi szűrő nem érvényes/)).toBeNull();
    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/szerviz/hibajegyek?partner=cust-beta",
      { scroll: false },
    );
  });

  it("maps an old location path to the one option it ends in", async () => {
    renderAt("location=Akv%C3%A1rium+%2F+Nagy+medence");
    await screen.findByText("Jegy 3");
    await settle();
    expect(lastExtra().departmentId).toBe("dep-1");
    for (const call of api.list.mock.calls)
      expect((call[8] as { departmentId?: string }).departmentId).toBe("dep-1");
  });

  it("drops a value nobody can identify, says so, and shows the whole list", async () => {
    renderAt("partner=Nincs+Ilyen+Kft&location=Valami+%2F+Semmi");
    expect(
      await screen.findByText(
        "A régi szűrő nem érvényes, a teljes lista látszik",
      ),
    ).toBeTruthy();
    await screen.findByText("Jegy 3");
    await settle();
    // the list was asked once the options were known, and without the dropped filters
    for (const call of api.list.mock.calls) {
      expect((call[8] as { customerId?: string }).customerId).toBeUndefined();
      expect(
        (call[8] as { departmentId?: string }).departmentId,
      ).toBeUndefined();
    }
    expect(screen.queryByText("Nincs találat")).toBeNull();
    expect(navigation.replace).toHaveBeenLastCalledWith("/szerviz/hibajegyek", {
      scroll: false,
    });
  });

  it("keeps the URL's filter when the options cannot be loaded, and still loads the list", async () => {
    api.facets.mockRejectedValue(new Error("nem elérhető"));
    renderAt("partner=cust-beta");
    await screen.findByText("Jegy 3");
    await settle();
    expect(lastExtra().customerId).toBe("cust-beta");
  });

  it("does not drop a chosen partner when a later search narrows the options", async () => {
    renderAt("partner=cust-alfa");
    await screen.findByText("Jegy 3");
    api.facets.mockResolvedValue({ partners: [], locations: [] });
    fireEvent.change(screen.getByLabelText("Hibajegy keresése"), {
      target: { value: "szivattyu" },
    });
    await settle();
    expect(api.facets).toHaveBeenCalledTimes(3);
    expect(screen.queryByText(/A régi szűrő nem érvényes/)).toBeNull();
    expect(lastExtra().customerId).toBe("cust-alfa");
  });

  it("resolveUrlFilters: an ambiguous name or leaf is dropped, an id stays", () => {
    const twins = {
      partners: [
        { id: "p1", name: "Ikrek Kft" },
        { id: "p2", name: "Ikrek Kft" },
      ],
      locations: [
        { id: "l1", label: "A · Medence" },
        { id: "l2", label: "B · Medence" },
      ],
    };
    expect(resolveUrlFilters(twins, "p2", "l1")).toEqual({
      partner: "p2",
      location: "l1",
      dropped: false,
    });
    expect(resolveUrlFilters(twins, "Ikrek Kft", "X / Medence")).toEqual({
      partner: "Mind",
      location: "Mind",
      dropped: true,
    });
  });
});
