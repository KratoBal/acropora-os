import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  AssetDetail,
  AssetOwnerListResponse,
  Session,
} from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";

import { AssetEditorPage } from "./asset-editor-page";

/**
 * A TULAJDONOS, AKI MÁR OTT VAN, NEM ESHET KI.
 *
 * A választható tulajdonosok listája mostantól a szerviz-jelölt partnereké
 * (Balázs bejelentése, 2026-08-25: az űrlap első mezőjében webshopos vevők
 * jöttek fel). Egy MEGLÉVŐ eszköz tulajdonosa viszont lehet olyan, aki ma nem
 * lenne választható, és a mező kötelező: ha a lista nem tartalmazza, a
 * szerkesztő üres mezőt mutat, a mentés pedig vagy elakad, vagy csendben más
 * tulajdonost ír oda. Ez a fájl azt méri, hogy a szerkesztő MEGMONDJA a
 * szervernek, kit kell mindenképp visszaadnia.
 */

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({
  owners: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok/uj",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/szerviz/eszkozok", fromWithinApp: false }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session }),
}));
vi.mock("@/lib/api/assets", () => ({ assetsApi: api }));

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

const servicePartner = {
  type: "SUPPLIER" as const,
  id: "supplier-1",
  code: "FANK",
  displayName: "Fánk Kft.",
  isActive: true,
  addresses: [],
};

const inheritedCustomer = {
  type: "CUSTOMER" as const,
  id: "customer-9",
  code: "VEVO-9",
  displayName: "Webshopos Vevő",
  isActive: true,
  addresses: [],
  outsideServiceScope: true,
};

const asset = {
  id: "asset-1",
  assetNumber: "ESZ-0001",
  name: "Cápasuli kompresszor",
  kind: "EQUIPMENT",
  status: "ACTIVE",
  criticality: "NORMAL",
  qrToken: "qr-1",
  childCount: 0,
  updatedAt: "2026-08-25T10:00:00.000Z",
  createdAt: "2026-08-25T10:00:00.000Z",
  owner: {
    type: "CUSTOMER",
    id: "customer-9",
    code: "VEVO-9",
    displayName: "Webshopos Vevő",
  },
  ancestors: [],
  children: [],
  events: [],
  documents: [],
} as unknown as AssetDetail;

function owners(items: AssetOwnerListResponse["items"]) {
  return { items };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({
    items: [],
    pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
  });
});

describe("AssetEditorPage tulajdonos-listája", () => {
  it("asks the server to keep the owner the asset already has", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    await waitFor(() => expect(api.owners).toHaveBeenCalled());
    // A HARMADIK argumentum a lényeg: enélkül a lista a szerviz-partnereké, és
    // ennek az eszköznek a tulajdonosa nem lenne benne.
    expect(api.owners.mock.calls[0]?.[2]).toEqual({
      type: "CUSTOMER",
      id: "customer-9",
    });
  });

  it("shows the inherited owner as inherited, not as an offer", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    const option = await screen.findByRole("option", {
      name: /Webshopos Vevő/,
    });
    expect(option.textContent).toMatch(/nem szerviz partner/);
    // És a mező tényleg ezt az értéket viseli, nem üresen áll.
    await waitFor(() =>
      expect(screen.getByLabelText("Partner")).toHaveProperty(
        "value",
        "CUSTOMER:customer-9",
      ),
    );
  });

  /**
   * ÚJ ESZKÖZNÉL NINCS MIT MEGTARTANI, és ez sem mindegy: ha a szerkesztő
   * ilyenkor is küldene egy tulajdonost, a szűrés mellé bekerülne egy sor, amit
   * senki nem tett oda.
   */
  it("asks for the plain service list when there is no asset yet", async () => {
    api.owners.mockResolvedValue(owners([servicePartner]));

    render(<AssetEditorPage />);

    await waitFor(() => expect(api.owners).toHaveBeenCalled());
    expect(api.owners.mock.calls[0]?.[2]).toBeNull();
    expect(api.detail).not.toHaveBeenCalled();
  });
});

/**
 * A KIUT AZ URLAP VEGEN, Balazs 2026-09-15-i designjabol.
 *
 * A kilepes eddig CSAK a lap tetejen allt, gombkent a cim mellett. A cim fole
 * kerult hivatkozaskent -- de az urlap vegen, a kitoltes utan az ember a mentes
 * MELLETT keresi, amikor meggondolja magat, es a leggorgetett allapotbol a lap
 * teteje nem latszik. Ezert all most mind a ket helyen.
 *
 * AZ ALLITAS A CELT IS MERI, NEM CSAK A LETEZEST: egy "Megsem" felirat, ami
 * sehova nem visz, pontosan ugyanugy nez ki, mint egy mukodo.
 */
describe("AssetEditorPage kiút", () => {
  it("a mentés mellett is van kiút, és oda visz, ahonnan jöttünk", async () => {
    api.owners.mockResolvedValue({ items: [] });
    render(<AssetEditorPage />);

    const megsem = await screen.findByRole("link", { name: "Mégsem" });
    expect(megsem.getAttribute("href")).toBe("/szerviz/eszkozok");
  });
});

/**
 * AZ URLAP EGYETLEN ALLAPOTBA TUD KERULNI, TEHAT ITT EGY ALLITAS A HELYES SZAM.
 *
 * A lista- es adatlapoknal ketto all (`loaded` es `empty`), mert azok ket
 * allapotba kerulhetnek. Itt a sav feltetel nelkul `form`-ot kap -- egy
 * masodik allitas nem szigor lenne, hanem DISZ: nem tudna elbukni.
 *
 * Amit ez MEGIS mer, es amiert nem elhagyhato: a `savotMond` a masik ket
 * mondat HIANYAT is allitja, tehat egy rogzult vagy elcsuszott valasztas
 * (peldaul ha valaki a lista alakjat masolna ide) ITT pirosodik ki.
 */
describe("AssetEditorPage kapcsolat nélkül", () => {
  beforeEach(() => setOnLine(false));

  afterEach(() => setOnLine(true));

  it("az űrlapon kimondja, hogy a mentés nem fog sikerülni", async () => {
    render(<AssetEditorPage />);

    expect(await savotMond("form")).toBeTruthy();
  });
});

/**
 * A MATRICAKOD A WEBES URLAPON.
 *
 * MIERT KELLETT, ES MIT NEM MER EZ A FAJL. Ket kulonbozo azonosito van: az
 * `Asset.qrToken` az ADATBAZIS alapertelmezese, tehat minden eszkoz kap egyet,
 * barhonnan is viszik fel -- az `AssetLabel` ezzel szemben az elore KINYOMTATOTT
 * matricak keszlete. A szerver oldal es a MOBIL urlap ota kesz, a webes urlapon
 * viszont egyaltalan nem volt mezo ra (merve 2026-09-16: a `labelCode` mintara
 * az `apps/web` fa alatt nulla talalat), tehat webrol felvitt eszkozhoz
 * nyomtatott matricat semmilyen uton nem lehetett rendelni.
 *
 * AZ ITTENI ALLITASOK A HIVAS TARTALMARA SZOLNAK, NEM A FOGLALASRA. Hogy a kod
 * tenyleg lefoglalodik es ketszer nem oszthato ki, azt az
 * `asset-label.integration.spec.ts` meri az adatbazison. Ha csak az allna, a mai
 * hiba akkor is zold maradna: ott a kod ELMEGY a szerverig, itt eppen az volt a
 * baj, hogy el sem indult.
 */
describe("AssetEditorPage matricakód", () => {
  beforeEach(() => {
    api.owners.mockResolvedValue(owners([servicePartner]));
    api.create.mockResolvedValue({ ...asset, id: "asset-uj" });
  });

  /** A TAROLT ALAK NAGYBETUS (`AssetLabel_code_shape_check`), a bemenet
   * szandekosan megengedobb. Ha a lap a begepelt alakot kuldene, a mentes a
   * tablan bukna el, es a kezelo egy ertelmezhetetlen hibat latna. */
  it("a begépelt kódot normalizálva küldi el", async () => {
    const user = userEvent.setup();
    render(<AssetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "SUPPLIER:supplier-1",
    );
    await user.type(screen.getByLabelText("Eszköz neve"), "Kompresszor");
    await user.type(screen.getByLabelText("Matrica kódja"), " v2196 ");
    await user.click(
      screen.getByRole("button", { name: "Eszköz létrehozása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[1]?.labelCode).toBe("V2196");
  });

  /**
   * TESTVER-KONTROLL, ES NEM DISZ: az elso allitas AKKOR IS zold lenne, ha a
   * mezot MINDIG elkuldenenk. Az ures szoveg viszont nem "nincs matrica", hanem
   * ervenytelen kod -- a szerver `normalizeAssetLabelCode` hivasa `null`-t adna
   * ra, es a felvitel elbukna azon, hogy a kezelo NEM adott meg kodot. A
   * matrica pedig szandekosan elhagyhato (`ASSET_LABEL_REQUIRED_ON_CREATE`).
   */
  it("üres mezőnél a kulcs el sem megy", async () => {
    const user = userEvent.setup();
    render(<AssetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "SUPPLIER:supplier-1",
    );
    await user.type(screen.getByLabelText("Eszköz neve"), "Kompresszor");
    await user.click(
      screen.getByRole("button", { name: "Eszköz létrehozása" }),
    );

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]?.[1]?.labelCode).toBeUndefined();
  });

  /** A ROSSZ ALAK ITT All MEG, NEM A SZERVERNEL: ugyanabbol a fuggvenybol, mint
   * a telefone es a szervere. Az allitas a MENTES ELMARADASAT is meri, nem csak
   * a mondatot -- egy hibauzenet, ami mellett a hivas megis elmegy, rosszabb a
   * semminel. */
  it("a rossz alakú kód megállítja a mentést, és megnevezi az alakot", async () => {
    const user = userEvent.setup();
    render(<AssetEditorPage />);

    await user.selectOptions(
      await screen.findByLabelText("Partner"),
      "SUPPLIER:supplier-1",
    );
    await user.type(screen.getByLabelText("Eszköz neve"), "Kompresszor");
    await user.type(screen.getByLabelText("Matrica kódja"), "ROSSZ");
    await user.click(
      screen.getByRole("button", { name: "Eszköz létrehozása" }),
    );

    /**
     * A MEZO LEIRASA IS TARTALMAZZA AZ ALAKOT, tehat egy tag minta KET elemet
     * talal, es a `findByText` ilyenkor HIBAT dob -- nem azert, mert a
     * hibauzenet hianyzik. Merve: ez a sor elobb tag mintaval allt, es ugy
     * bukott el, hogy a javitando viselkedes kozben rendben volt.
     */
    expect(
      await screen.findByText(/^A matrica kódja egy betű és négy szám/),
    ).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  /**
   * MEGLEVO ESZKOZON A MEZO NINCS OTT, es ez nem szepseg-dontes: a szerver
   * `UpdateAssetDto`-ja NEM ismer `labelCode` mezot (merve 2026-09-16), tehat
   * egy szerkeszteskor kitoltott mezo CSENDBEN elveszne. A kezelo azt hinne,
   * hozzarendelte a matricat.
   */
  it("meglévő eszköz szerkesztésekor nincs matrica mező", async () => {
    api.detail.mockResolvedValue(asset);
    render(<AssetEditorPage assetId="asset-1" />);

    await waitFor(() => expect(api.detail).toHaveBeenCalled());
    expect(screen.queryByLabelText("Matrica kódja")).toBeNull();
  });
});
