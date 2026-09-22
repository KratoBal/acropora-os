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
const suppliers = vi.hoisted(() => ({ units: vi.fn() }));
const unitsOfMeasure = vi.hoisted(() => ({ list: vi.fn() }));
const categories = vi.hoisted(() => ({ list: vi.fn() }));

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
/**
 * A KET MASIK KLIENS IS MOCKOLVA -- ES EZ NEM OVATOSSAG, HANEM MERT VALODI
 * HIVAS MENT EL.
 *
 * Merve 2026-09-16: ez a spec HAROM `ECONNREFUSED 127.0.0.1:3000` hibat
 * hagyott maga utan, mert a `suppliersApi` nem volt mockolva. A relativ
 * `/api/...` ut a teszt-kornyezetben a `localhost:3000`-re oldodik fel: aki
 * kozben `pnpm dev`-et futtat, annak a SAJAT szerverere megy a keres.
 *
 * ES A ZOLD NEM MONDTA MEG. A hivas eredmenye egy elnyelt `catch`-be fut, a
 * teszt pedig a MEGHIUSULT hivas utani allapotot merte -- vagyis nem azt, amit
 * hitt: egy ures partnerlista ugyanugy nez ki, mint egy halott hivas.
 */
vi.mock("@/lib/api/suppliers", () => ({ suppliersApi: suppliers }));
vi.mock("@/lib/api/units-of-measure", () => ({
  unitsOfMeasureApi: unitsOfMeasure,
}));
/*
  A KATEGORIA-KLIENS IS MOCKOLVA, ugyanabbol az okbol, amit a fenti jegyzet
  leir: enelkul VALODI hivas megy a `127.0.0.1:3000` cimre, es a zold nem
  mondja meg -- egy ures kategoria-lista pontosan ugy nez ki, mint egy halott
  hivas.
*/
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
  suppliers.units.mockResolvedValue({ items: [] });
  unitsOfMeasure.list.mockResolvedValue({ items: [WATT, KILOWATT] });
  categories.list.mockResolvedValue({ items: [SZIVATTYU] });
});

/** A ket teljesitmeny-egyseg, amit a valaszto kinal. */
const WATT = {
  id: "uom-w",
  code: "W",
  name: "watt",
  kind: "PERFORMANCE" as const,
  isActive: true,
  sortOrder: 0,
};
const KILOWATT = { ...WATT, id: "uom-kw", code: "kW", name: "kilowatt" };

/** A valaszto EGYETLEN aktiv kategoriaja. A kivezetett szandekosan hianyzik. */
const SZIVATTYU = {
  id: "cat-szivattyu",
  name: "Szivattyú",
  isActive: true,
  sortOrder: 0,
};

/**
 * A KIVEZETETT KATEGORIA, AMI MAR OTT ALL AZ ESZKOZON.
 *
 * Ugyanaz az alak, mint a tulajdonosnal a fajl fejlecében: a VALASZTO listaja
 * szukebb, mint ami egy MEGLEVO eszkozon allhat. A kivezetes a valasztot
 * szukiti, nem a mar rogzitett erteket tunteti el.
 *
 * MI PIROSIT: ha a `select` csak az aktiv sorokat kapja. Akkor a `value` olyan
 * azonosito, amihez nincs `option`, a bongeszo ureset mutat, es a kezelo azt
 * hiszi, nincs kategoria beallitva -- majd valaszt egyet, es egy ervenyes
 * erteket ir felul vakon. Ez a matricakod hibaja, masodszor.
 */
describe("AssetEditorPage kategória-választója", () => {
  const kivezetettel = {
    ...asset,
    categoryId: "cat-regi",
    category: "Régi világítás",
  } as unknown as AssetDetail;

  it("KONTROLL: az aktív kategória sima sorként jelenik meg", async () => {
    api.detail.mockResolvedValue({
      ...asset,
      categoryId: "cat-szivattyu",
      category: "Szivattyú",
    } as unknown as AssetDetail);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    expect(
      await screen.findByRole("option", { name: "Szivattyú" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /kivezetett/ }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Kategória")).toHaveProperty(
        "value",
        "cat-szivattyu",
      ),
    );
  });

  it("a kivezetett kategória saját sort kap, megjelölve", async () => {
    api.detail.mockResolvedValue(kivezetettel);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    expect(
      await screen.findByRole("option", {
        name: "Régi világítás (kivezetett)",
      }),
    ).toBeInTheDocument();
  });

  /**
   * ES A MEZO TENYLEGESEN EZT AZ ERTEKET VISELI, nem uresen all.
   *
   * KULON ALLITAS, es nem ismetles: az `option` LETEZHET ugy is, hogy a
   * `select` erteke mellette ures marad (rossz `value`, rossz sorrend). A
   * tulajdonos-mezonel ugyanez ket allitasban all, ugyanezert.
   */
  it("a mező a kivezetett kategóriát viseli, nem üres", async () => {
    api.detail.mockResolvedValue(kivezetettel);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    await waitFor(() =>
      expect(screen.getByLabelText("Kategória")).toHaveProperty(
        "value",
        "cat-regi",
      ),
    );
  });

  /**
   * NEV NELKUL IS SOR KELETKEZIK.
   *
   * Regi mentett lapon vagy egy meg le nem toltott valaszon a nev hianyozhat.
   * Egy ures `option` ugyanolyan nema lenne, mint a hianyzo: a „Kivezetett
   * kategória" legalabb megmondja, hogy VAN ertek.
   */
  it("név nélkül is sor keletkezik, általános felirattal", async () => {
    api.detail.mockResolvedValue({
      ...asset,
      categoryId: "cat-regi",
    } as unknown as AssetDetail);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    expect(
      await screen.findByRole("option", { name: "Kivezetett kategória" }),
    ).toBeInTheDocument();
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
   * MEGLEVO ESZKOZON IS OTT A MEZO -- ES EZ AZ ALLITAS AZ ELLENKEZOJET MONDTA.
   *
   * Itt korabban az allt, hogy a mezo szerkeszteskor NINCS ott, es az INDOKA is
   * ki volt irva: a szerver `UpdateAssetDto`-ja nem ismert `labelCode` mezot,
   * tehat a kitoltott mezo csendben elveszett volna. Az indok Balazs 2026-09-16-i
   * kerese nyoman megszunt, tehat az allitas is atirodik -- nem torlodik.
   *
   * Azert atiras es nem torles, mert a KERDES ugyanaz maradt: mi tortenik a
   * matricaval a szerkeszto lapon. Egy torolt allitas helyen senki nem latna,
   * hogy ezt valaha vegiggondoltuk.
   */
  it("meglévő eszköz szerkesztésekor OTT a mező, a MOSTANI kóddal", async () => {
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    api.detail.mockResolvedValue({ ...asset, labelCode: "V2196" });
    render(<AssetEditorPage assetId="asset-1" />);

    const mezo = await screen.findByLabelText("Matrica kódja");
    // AZ ELOTOLTES A LENYEG, nem a mezo letezese: egy URES doboz azt allitana,
    // hogy nincs matrica, es a kezelo egy MUKODO kodot irna felul anelkul,
    // hogy latna. A szerver ezt cserekent vegre is hajtana.
    expect((mezo as HTMLInputElement).value).toBe("V2196");
  });

  /**
   * A LAP KIMONDJA, AMIT A MEZO NEM TUD MEGTENNI.
   *
   * A kiurites nem szedi le a matricat (a szerver `string`-et var, nem
   * `string | null`). Ha ezt a leiras elhallgatna, a kezelo kiurítene a mezot,
   * mentene, es azt hinne, leszedte -- kozben semmi nem tortenne. Egy nema
   * no-op rosszabb egy hibauzenetnel.
   *
   * ES A KET AG MAST MOND: a felvitelen nincs mit leszedni, ott a mondat arrol
   * szol, hogy UTOLAG is potolhato. Korabban epp az ellenkezojet allitotta
   * ("utolag ezen a lapon mar nem potolhato") -- az a mondat Balazs
   * 2026-09-16-i keresevel elavult.
   */
  it("a szerkesztő leírása kimondja, hogy a kiürítés nem szedi le", async () => {
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    api.detail.mockResolvedValue({ ...asset, labelCode: "V2196" });
    render(<AssetEditorPage assetId="asset-1" />);

    await screen.findByLabelText("Matrica kódja");
    expect(screen.getByText(/kiürítése nem szedi le/)).toBeTruthy();
    // TESTVER-KONTROLL: a FELVITELI ag NEM ezt mondja, es nem is mondhatja --
    // ott nincs mit leszedni. Ha a ket mondat valaha egy lenne, ez pirosodik.
    expect(
      screen.queryByText(/utólag ezen a lapon már nem pótolható/),
    ).toBeNull();
  });

  it("a szerkesztő mentése FELVISZI a beírt kódot", async () => {
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    api.detail.mockResolvedValue(asset);
    api.update.mockResolvedValue({ ...asset, labelCode: "V2196" });
    render(<AssetEditorPage assetId="asset-1" />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Matrica kódja"), " v2196 ");
    await user.click(
      screen.getByRole("button", { name: "Módosítások mentése" }),
    );

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    // A NORMALIZALT ALAK MEGY EL, nem a begepelt: a tabla megkotese csak
    // nagybetut enged, a bemenet viszont szandekosan megengedobb.
    expect(api.update.mock.calls[0]?.[2]?.labelCode).toBe("V2196");
  });

  /**
   * A TESTVER-KONTROLL, ES ENELKUL A FENTI ALLITAS SEMMIT NEM ER.
   *
   * Egy mentes, ami MINDIG kuldene a mezot, a fentin is atmenne. Ez az egy
   * mondja ki, hogy az URES mezo nem torlest jelent: a matricat ezen az uton
   * nem lehet leszedni, es egy `null` a szerveren 400-zal bukna el.
   */
  it("üres mezőnél a kulcs EL SEM megy, nem törlést küld", async () => {
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    api.detail.mockResolvedValue({ ...asset, labelCode: "V2196" });
    api.update.mockResolvedValue(asset);
    render(<AssetEditorPage assetId="asset-1" />);

    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText("Matrica kódja"));
    await user.click(
      screen.getByRole("button", { name: "Módosítások mentése" }),
    );

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    /**
     * A DROTON MERUNK, NEM AZ OBJEKTUMON -- ES EZT A TESZT TANITOTTA MEG.
     *
     * Eloszor `"labelCode" in kuldott` allt itt, es PIROS lett: az
     * objektum-literal a kulcsot MINDIG kiirja, `undefined` ertekkel. A
     * `JSON.stringify` viszont eldobja, tehat a szerver NEM latja -- a
     * viselkedes helyes volt, az allitasom mert rosszat.
     *
     * A szerializalt alak a helyes merce, mert az `undefined` (kulcs eltunik)
     * es a `null` (TORLES megy fel) kozotti kulonbseg pontosan itt dol el. A
     * felviteli ut tesztje `.toBeUndefined()`-et hasznal, ami MIND A KETTOT
     * atengedi -- ez a sor szigorubb nala.
     */
    const kuldott = JSON.parse(
      JSON.stringify(api.update.mock.calls[0]?.[2] ?? {}),
    );
    expect("labelCode" in kuldott).toBe(false);
    // ES A KONTRASZT UGYANITT: egy SZOVEGES mezo ugyanattol a mozdulattol
    // `null`-t kuld. Ha ez a ket sor valaha egyet mondana, a ket szabaly
    // osszecsuszott.
    expect(kuldott.notes).toBe(null);
  });

  it("a rossz ALAK a szerkesztő ágon is megállítja a mentést", async () => {
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    api.detail.mockResolvedValue(asset);
    render(<AssetEditorPage assetId="asset-1" />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Matrica kódja"), "ROSSZ");
    await user.click(
      screen.getByRole("button", { name: "Módosítások mentése" }),
    );

    expect(
      await screen.findByText(/^A matrica kódja egy betű és négy szám/),
    ).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });
});

/**
 * A TELJESITMENY ES A MERTEKEGYSEGE EGY ADAT, KET MEZOBEN.
 *
 * A tablan CHECK all rajta, a szerver mondatot ad, az urlap pedig a mezo
 * mellett szol. Harom reteg ugyanarra a szabalyra -- es itt azt merjuk, hogy a
 * legkulso is all.
 */
describe("AssetEditorPage teljesítmény-mezője", () => {
  /**
   * A MEZOK SORRENDJE, AHOGY BALAZS KERTE 2026-09-16-AN.
   *
   * MIERT ALLITAS ES NEM IZLES: az urlap KETOSZLOPOS racs, tehat a forrasbeli
   * sorrend donti el, mi all EGYMAS MELLETT a kepernyon. A `Leltari szam`
   * korabban a `Teljesitmeny` es a `Mertekegyseg` KOZOTT allt, es ezzel ket
   * kulonbozo sorba tolta a ket mezot, amik EGY adatot alkotnak. A forrasban
   * levo komment kozben vegig azt allitotta, hogy egymas mellett vannak.
   *
   * Egy szem nelkuli olvasonak (es egy kesobbi atrendezesnek) ez a sorrend
   * lathatatlan. Ezert all itt a DOM-beli sorrendre allitas: egy uj mezo
   * bekozekelese ezt pirosra viszi, a kepernyot pedig senki nem nezi meg
   * minden PR utan.
   */
  it("a sorozatszám mellett a leltári szám áll, a teljesítmény mellett a mértékegység", async () => {
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    render(<AssetEditorPage assetId="asset-1" />);
    await screen.findByLabelText("Sorozatszám");

    const sorrend = [
      "Sorozatszám",
      "Leltári szám",
      "Teljesítmény",
      "Mértékegység",
    ].map((nev) => screen.getByLabelText(nev));

    // `reduce` kezdoertek NELKUL: igy a ket osszehasonlitott elem tipusa nem
    // `T | undefined`, tehat a `noUncheckedIndexedAccess` nem ker felkialtojelet
    // egy olyan indexre, amirol a ciklus maga garantalja, hogy letezik.
    sorrend.reduce((elozo, kovetkezo) => {
      expect(
        elozo.compareDocumentPosition(kovetkezo) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      return kovetkezo;
    });
  });

  it("a meglévő pár BETÖLTŐDIK, nem üres mezőt mutat", async () => {
    api.detail.mockResolvedValue({
      ...asset,
      performance: "500",
      performanceUnit: { id: "uom-w", code: "W", name: "watt" },
    });
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    render(<AssetEditorPage assetId="asset-1" />);

    const mezo = await screen.findByLabelText("Teljesítmény");
    await waitFor(() => expect((mezo as HTMLInputElement).value).toBe("500"));
    const egyseg = screen.getByLabelText("Mértékegység") as HTMLSelectElement;
    expect(egyseg.value).toBe("uom-w");
  });

  /**
   * EZ AZ AZ ALLITAS, AMIERT A `performanceUnitOptions` LETEZIK.
   *
   * A valaszto az AKTIVAKAT kinalja. Ha az eszkozon egy azota KIVEZETETT
   * egyseg all, es a lista nem tartalmazza, a legordulo az elso elemre esne
   * vissza: a kezelo megnyitja a lapot, egy szot sem ir, ment -- es a
   * mertekegyseg megvaltozik. Nemán, es pont azon az uton, ahol senki nem
   * keresi.
   */
  it("a KIVEZETETT egység is látszik, ha az eszközön az áll", async () => {
    api.detail.mockResolvedValue({
      ...asset,
      performance: "500",
      performanceUnit: { id: "uom-regi", code: "LE", name: "lóerő" },
    });
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    // A LISTA SZANDEKOSAN NEM TARTALMAZZA: ezt meri az allitas.
    unitsOfMeasure.list.mockResolvedValue({ items: [WATT, KILOWATT] });

    render(<AssetEditorPage assetId="asset-1" />);

    const egyseg = (await screen.findByLabelText(
      "Mértékegység",
    )) as HTMLSelectElement;
    await waitFor(() => expect(egyseg.value).toBe("uom-regi"));
    expect([...egyseg.options].map((option) => option.value)).toContain(
      "uom-regi",
    );
  });

  it("szám mértékegység nélkül NEM megy el, és megmondja, miért", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));

    const user = userEvent.setup();
    render(<AssetEditorPage assetId="asset-1" />);

    await user.type(await screen.findByLabelText("Teljesítmény"), "500");
    await user.click(
      screen.getByRole("button", { name: "Módosítások mentése" }),
    );

    await screen.findByText(/Válassz mértékegységet/);
    // A LENYEG A MASODIK ALLITAS: nem elég, hogy szol -- NEM is szabad
    // elkuldenie. Egy orzo, ami szol de atengedi a mentest, nem orzo.
    expect(api.update).not.toHaveBeenCalled();
  });

  it("a tizedesvesszőt pontra fordítva küldi el", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    api.update.mockResolvedValue({ ...asset, id: "asset-1" });

    const user = userEvent.setup();
    render(<AssetEditorPage assetId="asset-1" />);

    await user.type(await screen.findByLabelText("Teljesítmény"), "0,5");
    await user.selectOptions(screen.getByLabelText("Mértékegység"), "uom-w");
    await user.click(
      screen.getByRole("button", { name: "Módosítások mentése" }),
    );

    await waitFor(() => expect(api.update).toHaveBeenCalled());
    // MERVE a valodi `Prisma.Decimal`-on: a `"0,5"` DOB, es abbol 500 lenne.
    expect(api.update.mock.calls[0]?.[2]).toMatchObject({
      performance: "0.5",
      performanceUnitId: "uom-w",
    });
  });

  /**
   * A TORLES CSAK EGYUTT MEGY -- es a `null` ITT torlest jelent, a
   * matricakoddal ELLENTETBEN.
   */
  it("a két mező kiürítve EGYÜTT törli a párt", async () => {
    api.detail.mockResolvedValue({
      ...asset,
      performance: "500",
      performanceUnit: { id: "uom-w", code: "W", name: "watt" },
    });
    api.owners.mockResolvedValue(owners([servicePartner, inheritedCustomer]));
    api.update.mockResolvedValue({ ...asset, id: "asset-1" });

    const user = userEvent.setup();
    render(<AssetEditorPage assetId="asset-1" />);

    await user.clear(await screen.findByLabelText("Teljesítmény"));
    await user.selectOptions(screen.getByLabelText("Mértékegység"), "");
    await user.click(
      screen.getByRole("button", { name: "Módosítások mentése" }),
    );

    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0]?.[2]).toMatchObject({
      performance: null,
      performanceUnitId: null,
    });
  });
});

/**
 * A HIBA ES AZ URES TORZSADAT NEM UGYANAZ -- ES EDDIG UGYANUGY NEZETT KI.
 *
 * A mertekegyseg-legordulo mind a ket esetben csak a "Nincs megadva" sort
 * kinalja, es a kezelo abbol azt olvassa ki, hogy nincs mertekegyseg -- nem
 * azt, hogy most nem tudtuk lekerdezni. Offline ez lenne az ALAPHELYZET.
 *
 * A HAROM ALLITAS EGYUTT ER VALAMIT: az elso azt meri, hogy a hiba LATSZIK, a
 * masodik azt, hogy az URES eredmeny NEM ad hamis riasztast, a harmadik azt,
 * hogy a sajat lemondasunk nem szamit hibanak. Barmelyik nelkul a tobbi egy
 * olyan komponensen is teljesulne, ami mindig (vagy soha) kiirja.
 */
describe("a mértékegységek hibája megkülönböztethető az ürestől", () => {
  const UZENET = /A mértékegységek most nem tölthetők be/;

  it("HIBÁNÁL kiírja, hogy nem tölthetők be", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner]));
    unitsOfMeasure.list.mockRejectedValue(new Error("hálózati hiba"));

    render(<AssetEditorPage assetId="asset-1" />);

    expect(await screen.findByText(UZENET)).toBeTruthy();
  });

  it("ÜRES törzsadatnál NEM ír ki semmit", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner]));
    unitsOfMeasure.list.mockResolvedValue({ items: [] });

    render(<AssetEditorPage assetId="asset-1" />);

    /*
      A RENDERRE VARUNK, NEM A HIVASRA (26162440).

      A `waitFor(... api.owners called)` arra vart, hogy a LEHIVAS
      megtortenjen. A tagado allitas viszont a KEPERNYOROL szol, es a render
      elott MINDEN null -- tehat trivialisan atment volna akkor is, ha az
      uzenet kesobb megjelenik. Itt semmilyen kontroll nem kovette, tehat a
      teszt CSENDBEN maradt zold.
    */
    expect(await screen.findByLabelText("Partner")).toBeTruthy();
    expect(screen.queryByText(UZENET)).toBeNull();
  });

  it("a saját LEMONDÁSUNK nem hiba", async () => {
    api.detail.mockResolvedValue(asset);
    api.owners.mockResolvedValue(owners([servicePartner]));
    unitsOfMeasure.list.mockRejectedValue(
      new DOMException("megszakítva", "AbortError"),
    );

    render(<AssetEditorPage assetId="asset-1" />);

    // UGYANAZ, MINT FENT: a renderre varunk, es csak azutan allitunk hianyt.
    expect(await screen.findByLabelText("Partner")).toBeTruthy();
    expect(screen.queryByText(UZENET)).toBeNull();
  });
});
