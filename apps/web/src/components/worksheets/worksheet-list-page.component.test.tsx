import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, WorksheetListResponse } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetListPage } from "./worksheet-list-page";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

/**
 * A `selectablePartners` A PARTNER-VALASZTOT TOLTI (Balazs 2026-09-15-i
 * designjanak eszkozsora). A lapnak a hianya nem szabad hogy szamitson -- a
 * valaszto ilyenkor egyszeruen nem jelenik meg --, de a MOCK hianya mas: az
 * "nem fuggveny" hibaval szall el meg a render kozben, es a lap egyaltalan nem
 * jon fel. Ezert all itt, alapertelmezesben ures listaval.
 */
const api = vi.hoisted(() => ({
  list: vi.fn(),
  selectablePartners: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/munkalapok",
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
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-sanyi",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

function response(
  overrides: Partial<WorksheetListResponse> = {},
): WorksheetListResponse {
  return {
    items: [
      {
        id: "worksheet-1",
        // SZÁNDÉKOSAN a RÉGI alakú szám, a partner tagjával. 2026-08-27 óta az
        // új lapok `BIO-2026-001` alakot kapnak, a korábbiak száma viszont
        // változatlan marad, tehát a listának mindkettőt ki kell írnia. Aki
        // innen másol mintát, ne ezt vegye az új alaknak.
        number: "FANK-BIO-2026-001",
        label: "FANK-BIO-2026-001",
        customerName: "Fővárosi Állat- És Növénykert",
        departmentCode: "BIO",
        subject: "Cápasuli kompresszorok bevizsgálása",
        status: "AWAITING_SIGNATURE",
        version: 1,
        versionCount: 1,
        grossAmount: "38100",
        assigneeNames: ["Sanyi", "Kiss Péter"],
        updatedAt: "2026-08-19T10:00:00.000Z",
      },
      {
        id: "worksheet-2",
        number: null,
        label: null,
        customerName: "Fővárosi Állat- És Növénykert",
        departmentCode: "PPU",
        subject: "Szivattyú csere",
        status: "DRAFT",
        version: 1,
        versionCount: 1,
        grossAmount: "0",
        assigneeNames: [],
        updatedAt: "2026-08-19T11:00:00.000Z",
      },
    ],
    pagination: { page: 1, pageSize: 25, totalItems: 40, totalPages: 2 },
    ...overrides,
  };
}

describe("WorksheetListPage", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response());
    api.selectablePartners.mockReset().mockResolvedValue({ items: [] });
  });

  it("names the people a worksheet is on, and says so when it is nobody's", async () => {
    render(<WorksheetListPage />);

    expect(await screen.findByText("Sanyi, Kiss Péter")).toBeTruthy();
    // Az üres cella hibának látszana; a "nincs kiosztva" szabály.
    expect(screen.getByText("Nincs kiosztva")).toBeTruthy();
  });

  // A piszkozatnak nincs száma, mert a sorszám a lezáráskor keletkezik. Ha
  // ezt üresen hagynánk, a felhasználó elveszett adatot feltételezne.
  it("says a draft has no number yet instead of showing an empty cell", async () => {
    render(<WorksheetListPage />);
    expect(await screen.findByText("Még nincs száma")).toBeTruthy();
  });

  // A lapozas nem mehet a szuro-agon: az mindig page=1-et ir, tehat a
  // "Kovetkezo" gomb csendben az elso oldalra vinne vissza.
  it("moves to the next page instead of quietly returning to the first", async () => {
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    fireEvent.click(screen.getByRole("button", { name: "Következő" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("page")).toBe("2");
  });

  it("filters down to the worksheets handed to the person looking", async () => {
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    fireEvent.click(
      screen.getByRole("button", { name: "Csak amit rám osztottak" }),
    );

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("assigneeId")).toBe(
      "user-sanyi",
    );
  });
});

/**
 * A STATISZTIKA-CSEMPEK, Balazs 2026-09-15-i designjabol.
 *
 * A csempe nem dísz: ugyanaz az elem mondja meg a darabszamot es viszi oda a
 * listat. Az itteni allitasok azt merik, hogy a KETTO UGYANARROL A HALMAZROL
 * szol -- a szam a szurt ossz-darabszambol jon, nem a lapon levo sorokbol, es a
 * szamlalas ugyanazokat a tobbi szurot viszi, mint a lista.
 */
describe("WorksheetListPage állapot-csempék", () => {
  /** Allapotonkent MAS totalItems: enelkul barmelyik szam barmelyik csempehez
   * illeszkedne, es a lekepezes elcsuszasa lathatatlan maradna. */
  const totals: Record<string, number> = {
    DRAFT: 7,
    AWAITING_SIGNATURE: 3,
    SIGNED: 11,
  };

  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.selectablePartners.mockReset().mockResolvedValue({ items: [] });
    api.list
      .mockReset()
      .mockImplementation((_token, query: URLSearchParams) => {
        const status = query.get("status") ?? "";
        const base = response();
        return Promise.resolve({
          ...base,
          pagination: {
            ...base.pagination,
            totalItems: totals[status] ?? base.pagination.totalItems,
          },
        });
      });
  });

  it("a csempe a SZŰRT összdarabszámot mutatja, nem a lapon lévő sorok számát", async () => {
    render(<WorksheetListPage />);

    // A valasz KET sort tartalmaz, a harom szam mindegyike mas: ha a csempe a
    // `items.length`-bol dolgozna, mindharom 2 lenne.
    expect(await screen.findByText("7")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
  });

  it("a csempe kattintásra a címsorba írja az állapotot", async () => {
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    fireEvent.click(screen.getByRole("button", { name: /Szerkesztés alatt/ }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).get("status")).toBe(
      "DRAFT",
    );
  });

  /**
   * A MASODIK KATTINTAS VISSZAKAPCSOL. Enelkul a kivalasztott csempe
   * `aria-pressed="true"` allapotban ragadna, es csak a fulsorbol lehetne
   * feloldani -- egy nyomogomb, ami csak befele kattint, nem nyomogomb.
   */
  it("a már kiválasztott csempe második kattintásra visszakapcsol", async () => {
    navigation.params = new URLSearchParams("status=DRAFT");
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    fireEvent.click(screen.getByRole("button", { name: /Szerkesztés alatt/ }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
    expect(new URLSearchParams(target.split("?")[1]).has("status")).toBe(false);
  });

  /**
   * A SZAMLALAS UGYANAZT A HALMAZT NEZI, MINT A LISTA.
   *
   * Ha a csempek szamai a szuretlen halmazrol szolnanak, a ket szam egymas
   * mellett allna a kepernyon, es semmi nem arulna el, hogy nem ugyanarrol
   * beszelnek. Merve: ha a kereses kimarad a szamlalas alapjabol, ez az
   * allitas pirosra valt.
   */
  it("a számlálás viszi a lista többi szűrőjét is", async () => {
    navigation.params = new URLSearchParams("search=szivattyú");
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    await waitFor(() =>
      expect(
        api.list.mock.calls.some(
          (call) =>
            (call[1] as URLSearchParams).get("status") === "DRAFT" &&
            (call[1] as URLSearchParams).get("search") === "szivattyú",
        ),
      ).toBe(true),
    );
  });

  /**
   * A LABLEC AZ OSSZ-TALALATOT MONDJA, NEM A LAP HOSSZAT. A ketto kozotti
   * kulonbseg pont akkor szamit, amikor lapozni kellene -- es egy "2 találat"
   * felirat egy 40 elemu listan azt allitja, hogy nincs is tovabb.
   */
  it("a láblécben az összes találat száma áll, nem a lapon lévőké", async () => {
    render(<WorksheetListPage />);

    expect(
      await screen.findByText("40 találat, ebből 2 ezen a lapon"),
    ).toBeTruthy();
  });
});
