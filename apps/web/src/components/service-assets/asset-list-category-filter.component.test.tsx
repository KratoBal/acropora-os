import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  AssetCategoryListResponse,
  AssetListItem,
  AssetListResponse,
  Session,
} from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetListPage } from "./asset-list-page";

/**
 * A KATEGORIA-SZURO BEKOTESE, NEM A LOGIKAJA.
 *
 * A szerver oldali tiszta fuggveny (`asset-category-filter.ts`) kulon meg van
 * merve: mit epit a ket kerdesbol, es hogy EGYUTT allva `AND`-del kapcsolodnak,
 * nem felulirjak egymast. Amit AZ nem mond meg, az a BEKOTES -- hogy a lenyilo
 * tenyleg a cimsorba ir, es hogy a ket szerver-parameter kozott a valtas
 * TISZTAN tortenik.
 *
 * ES AMIERT EZ TOBB EGY URLAP-TESZTNEL: a lap EGY valasztot mutat, a vegpont
 * KET kerdest ismer (`category=with|without` es `categoryId`). A forditas a
 * `setCategoryFilter`-ben tortenik, es pontosan ott lehet olyat rontani, amit
 * kivulrol semmi nem mutat: ha a regi parameter bennmarad, a lekerdezes ket
 * egymasnak ellentmondo feltetelt kuld, es a lista URESEN jon vissza -- ami
 * pont ugy nez ki, mintha nem lenne ilyen eszkoz.
 */

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
const suppliers = vi.hoisted(() => ({ units: vi.fn() }));
const categories = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok",
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
vi.mock("@/lib/api/assets", () => ({ assetsApi: api }));
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: suppliers }));
vi.mock("@/lib/api/asset-categories", () => ({
  assetCategoriesApi: categories,
}));

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

function asset(overrides: Partial<AssetListItem>): AssetListItem {
  return {
    id: "asset-1",
    assetNumber: "ESZ-0001",
    name: "Keringető szivattyú",
    kind: "EQUIPMENT",
    status: "ACTIVE",
    criticality: "NORMAL",
    owner: {
      type: "SUPPLIER",
      id: "supplier-1",
      code: "FANK",
      displayName: "Fankó Kft.",
    },
    qrToken: "qr-1",
    childCount: 0,
    updatedAt: "2026-09-22T10:00:00.000Z",
    ...overrides,
  };
}

function response(items: AssetListItem[]): AssetListResponse {
  return {
    items,
    pagination: {
      page: 1,
      pageSize: 25,
      totalItems: items.length,
      totalPages: 1,
    },
    counts: {
      ACTIVE: 0,
      WARM_STANDBY: 0,
      COLD_STANDBY: 0,
      IN_REPAIR: 0,
      RETIRED: 0,
    },
  };
}

const categoryList: AssetCategoryListResponse = {
  items: [
    {
      id: "cat-szivattyu",
      name: "Szivattyú",
      isActive: true,
      sortOrder: 1,
    },
    {
      id: "cat-regi",
      name: "Régi világítás",
      isActive: false,
      sortOrder: 2,
    },
  ],
};

function urlAfterChange() {
  const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
  return new URLSearchParams(target.split("?")[1]);
}

async function renderWith(search: string) {
  navigation.params = new URLSearchParams(search);
  render(<AssetListPage />);
  await waitFor(() => expect(api.list).toHaveBeenCalled());
}

function valaszto() {
  return screen.getByRole("combobox", { name: "Kategória" });
}

/**
 * A KATEGORIA-CELLA A FEJLEC ALAPJAN, NEM A TARTALMA ALAPJAN.
 *
 * Az elso alak `getByRole("cell", { name: "—" })` volt, es KETERTELMUSEG miatt
 * bukott el: a gondolatjel a „Műszaki azonosító" cellaban is ott all, amikor az
 * ures. A nev szerinti valaszto ilyenkor NEM azt mondja, hogy hibas a kod --
 * csak azt, hogy a kerdes nem valaszt ki egyetlen elemet.
 *
 * A fejlecbol szamolt oszlop-index viszont TOBBET is mer, mint amit az elso
 * alak akart: az OSZLOP HELYET is. Ha valaki a „Kategória" fejlecet es a cellat
 * kulon mozgatna, ez a sor jelez -- a nev szerinti kereses nem jelzett volna.
 */
function kategoriaCella() {
  const fejlecek = screen
    .getAllByRole("columnheader")
    .map((cella) => cella.textContent?.trim());
  const oszlop = fejlecek.indexOf("Kategória");
  expect(oszlop, "a „Kategória” fejléc nincs a táblázatban").toBeGreaterThan(
    -1,
  );
  const sorok = screen.getAllByRole("row");
  const cellak = within(sorok[1] as HTMLElement).getAllByRole("cell");
  return cellak[oszlop] as HTMLElement;
}

describe("AssetListPage kategória-szűrő", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.replace.mockClear();
    api.list.mockReset().mockResolvedValue(response([]));
    suppliers.units.mockReset().mockResolvedValue({ items: [] });
    categories.list.mockReset().mockResolvedValue(categoryList);
  });

  /**
   * POZITIV KONTROLL, ES ELOL ALL: ha a valaszto egyaltalan nem jelenne meg (vagy
   * masik hozzaferheto nevvel allna), a lenti allitasok mind a `getByRole`-on
   * hasalnanak el -- de akkor a hiba OKAT nem mondana meg egyik sem.
   */
  it("KONTROLL: a választó megjelenik, és a betöltött kategóriákat kínálja", async () => {
    await renderWith("");

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Szivattyú" }),
      ).toBeInTheDocument(),
    );
    expect(valaszto()).toBeInTheDocument();
  });

  /**
   * A KIVEZETETT KATEGORIA IS VALASZTHATO A SZURESBEN -- ES EZ DONTES, NEM
   * ELNEZES.
   *
   * A felviteli urlap SZANDEKOSAN csak az aktivakat kinalja: ott a kivezetett
   * ertek visszahozna azt, ami miatt kivezettuk. A szures viszont nem rendel
   * hozza semmit, csak olvas -- es ha kimaradna, az azon allo eszkozokre nem
   * lehetne rakeresni, holott a nevuk ott all a listaban.
   *
   * A MEGJELOLES („kivezetett”) AZERT KELL, mert a ket eset egy lenyiloban
   * megkulonboztethetetlen lenne, es a kezelo azt hinne, uj eszkozhoz is
   * valaszthatja.
   */
  it("a kivezetett kategóriát is kínálja, megjelölve", async () => {
    await renderWith("");

    await waitFor(() =>
      expect(categories.list).toHaveBeenCalledWith(
        "token-1",
        true,
        expect.anything(),
      ),
    );
    expect(
      screen.getByRole("option", { name: "Régi világítás (kivezetett)" }),
    ).toBeInTheDocument();
  });

  /**
   * KONTROLL A FENTIHEZ: az AKTIV kategoria NINCS megjelolve. Enelkul egy olyan
   * rontas is atmenne, ami MINDEN sorhoz odairja a jelolest.
   */
  it("KONTROLL: az aktív kategória nincs megjelölve", async () => {
    await renderWith("");

    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Szivattyú" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("option", { name: "Szivattyú (kivezetett)" }),
    ).toBeNull();
  });

  it("kategória választása a `categoryId` paramétert írja, és visszaáll az első oldalra", async () => {
    await renderWith("page=4");

    fireEvent.change(valaszto(), { target: { value: "cat-szivattyu" } });

    const url = urlAfterChange();
    expect(url.get("categoryId")).toBe("cat-szivattyu");
    expect(url.get("category")).toBeNull();
    expect(url.get("page")).toBe("1");
  });

  /**
   * A „NINCS KATEGORIA” MAS PARAMETER, ES EZ A LENYEG.
   *
   * A vegpont nem ismer olyan azonositot, hogy „nincs” -- a hianyra kulon
   * kerdes szolgal. Ez a sor azt meri, hogy a forditas MEGTORTENIK, nem pedig
   * az, hogy a sentinel elmegy azonositokent (ami a szerveren ures listat adna,
   * es ugy nezne ki, mintha nem lenne ilyen eszkoz).
   */
  it("a „Nincs kategória” a `category=without` paramétert írja, azonosító nélkül", async () => {
    await renderWith("");

    fireEvent.change(valaszto(), { target: { value: "__NINCS__" } });

    const url = urlAfterChange();
    expect(url.get("category")).toBe("without");
    expect(url.get("categoryId")).toBeNull();
  });

  /**
   * A VALTAS TISZTA -- ES EZ AZ AZ ALLITAS, AMIERT A KET PARAMETER EGY
   * FUGGVENYBEN ALL BE.
   *
   * Ha a regi `category=without` bennmaradna, a lekerdezes ket egymasnak
   * ellentmondo feltetelt kuldene (nincs kategoriaja ES ez a kategoriaja), es a
   * szerver URES listat adna vissza. Az pedig pont ugy nez ki, mintha az adott
   * kategoriaban nem lenne eszkoz -- nema hiba, hangos kovetkezmennyel.
   */
  it("a „Nincs kategória”-ról kategóriára váltva a `category` paraméter ELTŰNIK", async () => {
    await renderWith("category=without");

    fireEvent.change(valaszto(), { target: { value: "cat-szivattyu" } });

    const url = urlAfterChange();
    expect(url.get("categoryId")).toBe("cat-szivattyu");
    expect(url.get("category")).toBeNull();
  });

  /** A MASIK IRANY, kulon allitassal: azonositorol a hianyra valtva. */
  it("kategóriáról a „Nincs kategória”-ra váltva a `categoryId` ELTŰNIK", async () => {
    await renderWith("categoryId=cat-szivattyu");

    fireEvent.change(valaszto(), { target: { value: "__NINCS__" } });

    const url = urlAfterChange();
    expect(url.get("category")).toBe("without");
    expect(url.get("categoryId")).toBeNull();
  });

  it("a „Minden kategória” MINDKÉT paramétert törli", async () => {
    await renderWith("categoryId=cat-szivattyu");

    fireEvent.change(valaszto(), { target: { value: "" } });

    const url = urlAfterChange();
    expect(url.get("category")).toBeNull();
    expect(url.get("categoryId")).toBeNull();
  });

  /**
   * A VALASZTO A CIMBOL TOLTODIK ELO, nem a sajat allapotabol: enelkul egy
   * megosztott vagy frissitett lap ures valasztot mutatna, holott szurve van.
   */
  it("a címben álló szűrés a választón is látszik", async () => {
    await renderWith("category=without");

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Szivattyú" })).toBeEnabled(),
    );
    expect((valaszto() as HTMLSelectElement).value).toBe("__NINCS__");
  });

  it("a soron kiírja a kategória nevét", async () => {
    api.list.mockResolvedValue(
      response([asset({ category: "Szivattyú", categoryId: "cat-szivattyu" })]),
    );
    await renderWith("");

    await waitFor(() =>
      expect(screen.getByText("Keringető szivattyú")).toBeInTheDocument(),
    );
    expect(kategoriaCella().textContent).toBe("Szivattyú");
  });

  /**
   * KONTROLL: kategoria NELKULI soron GONDOLATJEL all, nem ures cella.
   *
   * Ket dolgot ment meg. Egy: a fenti allitas akkor is zold lenne, ha a cella
   * MINDIG a kapott erteket irna ki -- ez a sor meri, hogy a hianynak is van
   * alakja. Ketto: egy ures cella ugy olvasodik, mintha a lekerdezes nem hozta
   * volna el a mezot; a gondolatjel kimondja, hogy NINCS kategoria, es pont ez
   * az a halmaz, amit a „Nincs kategória” szuro elohoz.
   */
  it("KONTROLL: kategória nélküli soron gondolatjel áll", async () => {
    api.list.mockResolvedValue(response([asset({})]));
    await renderWith("");

    await waitFor(() =>
      expect(screen.getByText("Keringető szivattyú")).toBeInTheDocument(),
    );
    expect(kategoriaCella().textContent).toBe("—");
  });
});
