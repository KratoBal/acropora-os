import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session, WorksheetListResponse } from "@acropora/types";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
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
        // A KET SOR SZANDEKOSAN KULONBOZIK: ez ITT hozza a teljes utat, a
        // masodik NEM. Igy egy futasban merheto a fo ag es a visszaeses is.
        departmentPath: ["Biodóm", "Fókamedence", "Fóka nagymedence"],
        subject: "Cápasuli kompresszorok bevizsgálása",
        status: "AWAITING_SIGNATURE",
        version: 1,
        versionCount: 1,
        grossAmount: "38100",
        assigneeNames: ["Sanyi", "Kiss Péter"],
        updatedAt: "2026-08-19T10:00:00.000Z",
        hidden: false,
      },
      {
        id: "worksheet-2",
        number: null,
        label: null,
        customerName: "Fővárosi Állat- És Növénykert",
        departmentCode: "PPU",
        departmentPath: null,
        subject: "Szivattyú csere",
        status: "DRAFT",
        version: 1,
        versionCount: 1,
        grossAmount: "0",
        assigneeNames: [],
        updatedAt: "2026-08-19T11:00:00.000Z",
        hidden: false,
      },
    ],
    pagination: { page: 1, pageSize: 25, totalItems: 40, totalPages: 2 },
    // A NEGY SZAM OSSZEGE (33) SZANDEKOSAN NEM EGYEZIK a totalItems-szel (40):
    // igy az allitas meg tudja kulonboztetni, melyikbol dolgozik a csempe. Egyezo
    // szamokkal akkor is zold lenne, ha a csempe a lapozas szamat mutatna.
    counts: { DRAFT: 7, AWAITING_SIGNATURE: 3, SIGNED: 11, REJECTED: 12 },
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

  /**
   * A HELYSZIN TELJES UTJA A PARTNER ALATT, ES A VISSZAESES UGYANABBAN A
   * FUTASBAN.
   *
   * Balazs 2026-09-16-an fotozta le ezt a listat: a partner alatt `NMD` allt
   * magaban. A kod csak TESTVEREK kozott egyedi, tehat ket tavoli ag alatt
   * ugyanaz a kod megengedett -- a listan pedig epp egymas ala kerulhet ket
   * ilyen sor.
   *
   * A MASODIK ALLITAS NEM DISZ: ha a szerver nem tudja felepiteni az utat, a
   * regi alaknak kell latszania, nem ures cellanak. A ket sor a mintaban
   * szandekosan kulonbozik, hogy mind a ketto egy futasban merodjon.
   */
  it("kiírja a helyszín teljes útját, és visszaesik a kódra, ha nincs út", async () => {
    render(<WorksheetListPage />);

    expect(
      await screen.findByText("Biodóm / Fókamedence / Fóka nagymedence"),
    ).toBeTruthy();
    expect(screen.getByText("PPU")).toBeTruthy();
    // A teljes utat hozo sornal a puszta kod mar NEM latszik: azt valtotta fel.
    expect(screen.queryByText("BIO")).toBeNull();
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

    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Lapozás, alul" }),
      ).getByRole("button", { name: "Következő" }),
    );

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
   * A CSEMPEK A VALASZ `counts` MEZOJEBOL OLVASNAK.
   *
   * ITT KORABBAN MAS ALLT, es a csere nem fedettseg-vesztes, hanem
   * hataratrakas. A regi allitas azt merte, hogy a KLIENS harom kulon
   * lista-hivast kuld, es azok viszik a kereses szurojet -- vagyis hogy a
   * csempek ugyanarrol a halmazrol szolnak, mint a lista.
   *
   * Az a mechanizmus MEGSZUNT: a szamokat a szerver adja, ugyanabban a
   * valaszban. A tulajdonsag megmaradt, csak mar NEM A KLIENSEN dol el --
   * kliens-oldalrol nincs is mit allitani rola, mert egy valaszbol jon a ketto.
   * A szerver oldalan a `worksheets/worksheet-list-scope.spec.ts` meri, hogy a
   * szamlalo feltetele a listaeval EGY fuggvenybol szuletik, es hogy pontosan
   * az allapottal ter el tole.
   *
   * AMI ITT MARAD MERHETO: hogy a felulet tenyleg a valasz `counts` mezojet
   * mutatja, es nem valamelyik kezreeso masik szamot.
   */
  it("a csempék a válasz counts mezőjéből olvasnak", async () => {
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    // A fixture negy szama kulonbozik egymastol ES a totalItems-tol is.
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
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

/**
 * A SAV A LAP ALLAPOTAROL BESZEL, NEM A KAPCSOLATROL -- ES A HELYES SZAM NEM
 * EGY, HANEM ANNYI, AHANY ALLAPOTBA A LAP BE TUD KERULNI.
 *
 * Ez a lap kettobe: `data ? loaded : empty`. A ket allitas EGYUTT fogja meg a
 * rogzult valasztast; kulon-kulon egyik sem. Egy lap, ami mindig `loaded`-ot
 * ad, a tipusellenorzesen ES az elso allitason is atmegy, es hideg
 * betolteskor azt mondana, hogy "a legutobb betoltott adatokat latod",
 * miközben a kepernyo ures.
 */
describe("WorksheetListPage kapcsolat nélkül", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    api.list.mockReset().mockResolvedValue(response());
    api.selectablePartners.mockReset().mockResolvedValue({ items: [] });
    setOnLine(false);
  });

  afterEach(() => setOnLine(true));

  it("betöltött listánál a frissítésről beszél", async () => {
    render(<WorksheetListPage />);
    await screen.findByText("Sanyi, Kiss Péter");

    expect(await savotMond("loaded")).toBeTruthy();
  });

  it("üres képernyőn azt mondja, hogy ezért nincs adat", async () => {
    // SOHA NEM TELJESULO valasz: a lap a "meg semmi nem toltodott be"
    // allapotban marad, vagyis pont abban, amirol a masodik mondat szol.
    api.list.mockReset().mockReturnValue(new Promise(() => {}));
    render(<WorksheetListPage />);

    expect(await savotMond("empty")).toBeTruthy();
  });
});
