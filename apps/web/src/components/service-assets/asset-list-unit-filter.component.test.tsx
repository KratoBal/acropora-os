import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AssetListResponse,
  Session,
  WorksheetDepartmentListResponse,
} from "@acropora/types";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetListPage } from "./asset-list-page";

/**
 * A HELYSZIN-VALASZTO BEKOTESE, NEM A LOGIKAJA.
 *
 * A cimsor-kezelo tiszta fuggvenyei (`unit-filter.ts`) kulon meg vannak merve:
 * mit olvasunk ki, mit irunk vissza, es hogy az URES halmaz TORLI a parametert.
 * Amit AZOK NEM mondanak meg -- es amit a sajat commit uzenetem "nem fedett"
 * cimszo alatt fel is sorolt --, az a BEKOTES: hogy a jelolonegyzet tenyleg a
 * cimsorba ir, es hogy a lekerdezes tenyleg eljut az API-ig azzal az ertekkel.
 *
 * A ket dolog KULON tud elromlani: a fuggveny lehet helyes ugy is, hogy senki
 * nem hivja (ez ma masodszor jott elo a flottaban -- egy `@Transform`, ami
 * semmihez nincs kotve, valtozatlanul atmegy a sajat egysegtesztjein).
 *
 * A VALASZTO CSAK SZERVIZ-PARTNER TULAJDONOSNAL LATSZIK, es ez nem
 * egyszerusites: az alegysegek a partneren at erhetok el, globalis lista nincs.
 * Ezert az elso allitas a HIANYT meri -- enelkul a tobbi allitas akkor is zold
 * lenne, ha a valaszto MINDIG latszana.
 */

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  replace: vi.fn(),
  push: vi.fn(),
}));

const api = vi.hoisted(() => ({ list: vi.fn() }));
const suppliers = vi.hoisted(() => ({ units: vi.fn() }));
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

const emptyList: AssetListResponse = {
  items: [],
  pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
};

const units: WorksheetDepartmentListResponse = {
  items: [
    {
      id: "unit-bio",
      parentId: null,
      code: "BIO",
      name: "Biodóm",
      isActive: true,
    },
    {
      id: "unit-foka",
      parentId: "unit-bio",
      code: "FOK",
      name: "Fókamedence",
      isActive: true,
    },
  ],
};

function urlAfterClick() {
  const target = String(navigation.replace.mock.calls.at(-1)?.[0]);
  return new URLSearchParams(target.split("?")[1]);
}

async function renderWith(search: string) {
  navigation.params = new URLSearchParams(search);
  render(<AssetListPage />);
  await waitFor(() => expect(api.list).toHaveBeenCalled());
}

describe("AssetListPage helyszín-szűrő", () => {
  beforeEach(() => {
    auth.session = session;
    navigation.replace.mockClear();
    api.list.mockReset().mockResolvedValue(emptyList);
    suppliers.units.mockReset().mockResolvedValue(units);
  });

  it("tulajdonos nélkül NEM jelenik meg, és nem is kérdezi le a helyszíneket", async () => {
    await renderWith("");
    expect(screen.queryByText("Helyszínek")).toBeNull();
    expect(suppliers.units).not.toHaveBeenCalled();
  });

  /**
   * VEVO-TULAJDONOSNAL SEM, ES EZ MAS ESET, MINT A FENTI.
   *
   * A tulajdonos NELKULI eset akkor is atmenne, ha a felteteл csak az
   * azonositot nezne -- merve: a tipus-ellenorzest kivéve a fenti allitas
   * VALTOZATLANUL zold marad, mert ott nincs azonosito sem. Ez az allitas az,
   * ami a TIPUST meri: vevo-tulajdonosnal az alegyseg nem ertelmezheto (ott a
   * cim a pontositas), es a szerver el is utasitana.
   */
  it("vevő-tulajdonosnál sem jelenik meg", async () => {
    await renderWith("ownerType=CUSTOMER&ownerId=customer-1");
    expect(screen.queryByText("Helyszínek")).toBeNull();
    expect(suppliers.units).not.toHaveBeenCalled();
  });

  it("szerviz-partner tulajdonosnál a helyszínek TELJES ÚTTAL jelennek meg", async () => {
    await renderWith("ownerType=SUPPLIER&ownerId=supplier-1");
    await waitFor(() =>
      expect(suppliers.units).toHaveBeenCalledWith(
        "token-1",
        "supplier-1",
        expect.anything(),
      ),
    );
    expect(await screen.findByText("Biodóm (BIO)")).toBeTruthy();
    expect(screen.getByText("Biodóm / Fókamedence (FOK)")).toBeTruthy();
  });

  /**
   * A SZURO JELOL, DE NEM SZUR (acrobot dontese, 2026-09-02 21:13). Egy eszkoz
   * allhat archivalt helyszinen, es a listat is akarhatja valaki epp arra
   * szurni: a valasztas itt nem hoz letre semmit. A JELOLES viszont kell,
   * kulonben a felhasznalo nem erti, miert nem ajanljuk ugyanezt a helyszint
   * ott, ahol uj munka indul.
   */
  it("az archivált helyszínt felajánlja, de MEGJELÖLI", async () => {
    suppliers.units.mockResolvedValue({
      items: [
        {
          id: "unit-regi",
          parentId: null,
          code: "REG",
          name: "Régi szárny",
          isActive: false,
        },
      ],
    });

    await renderWith("ownerType=SUPPLIER&ownerId=supplier-1");

    expect(
      await screen.findByText("Régi szárny (REG) · archivált"),
    ).toBeTruthy();
  });

  it("a jelölőnégyzet a CÍMSORBA ír, és visszaállítja a lapozást", async () => {
    await renderWith("ownerType=SUPPLIER&ownerId=supplier-1&page=3");
    fireEvent.click(await screen.findByLabelText("Biodóm (BIO)"));
    const next = urlAfterClick();
    expect(next.get("departmentIds")).toBe("unit-bio");
    expect(next.get("page")).toBe("1");
    expect(next.get("ownerId")).toBe("supplier-1");
  });

  /** HALMAZ, NEM EGY ERTEK: a masodik valasztas nem irja felul az elsot. */
  it("a második választás HOZZÁADÓDIK, nem cseréli az elsőt", async () => {
    await renderWith(
      "ownerType=SUPPLIER&ownerId=supplier-1&departmentIds=unit-bio",
    );
    fireEvent.click(await screen.findByLabelText("Biodóm / Fókamedence (FOK)"));
    expect(urlAfterClick().get("departmentIds")).toBe("unit-bio,unit-foka");
  });

  it("az utolsó kikapcsolása TÖRLI a paramétert", async () => {
    await renderWith(
      "ownerType=SUPPLIER&ownerId=supplier-1&departmentIds=unit-bio",
    );
    fireEvent.click(await screen.findByLabelText("Biodóm (BIO)"));
    expect(urlAfterClick().has("departmentIds")).toBe(false);
  });

  /**
   * AZ UTOLSO LANCSZEM: a cimsorbol tenylegesen eljut-e az ertek az API-ig.
   * Enelkul a fenti allitasok akkor is zoldek lennenek, ha a lekerdezes soha
   * nem venne figyelembe a parametert.
   */
  it("a lekérdezés a kiválasztott helyszínekkel megy ki", async () => {
    await renderWith(
      "ownerType=SUPPLIER&ownerId=supplier-1&departmentIds=unit-bio,unit-foka",
    );
    const query = api.list.mock.calls.at(-1)?.[1] as URLSearchParams;
    expect(query.get("departmentIds")).toBe("unit-bio,unit-foka");
  });
});
