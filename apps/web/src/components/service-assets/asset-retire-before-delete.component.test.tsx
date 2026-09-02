import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetDetail, AssetQrCode, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AssetDetailPage } from "./asset-detail-page";

/**
 * A KIVEZETÉS A FŐ ÚT, ÉS A VISSZAFORDÍTHATÓSÁGA AZ ELSŐ ÁLLÍTÁS.
 *
 * Balázs döntése (2026-08-31): a törlési szabály marad, de a felület a
 * KIVEZETÉST ajánlja elsőként. A kivezetés azért lett a fő út, mert MEGŐRZI az
 * adatot — és ebből következik, hogy ha a felhasználó véglegesnek hiszi, akkor
 * épp a TÖRLÉS felé mozdul. Egy kimondatlan visszafordíthatóság tehát nem
 * hiányzó információ, hanem **az ellenkezőjét éri el annak, amit a döntés
 * akart**.
 *
 * Ezért áll az első állítás arról, hogy a megerősítő ablak KIMONDJA: visszavonható,
 * és megmondja, HOL. Egy szöveg, amit semmi nem véd, egy takarítás alkalmával
 * eltűnik.
 */

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  qr: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  rotateQr: vi.fn(),
  deleteDocument: vi.fn(),
  uploadDocument: vi.fn(),
  documentUrl: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok/asset-1",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/szerviz/eszkozok", fromWithinApp: false }),
}));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/assets", () => ({ assetsApi: api }));

function session(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "balazs@acropora.local",
      displayName: "Balázs",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

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
    type: "SUPPLIER",
    id: "supplier-1",
    code: "FANK",
    displayName: "Fánk Kft.",
  },
  ancestors: [],
  children: [],
  events: [],
  documents: [],
} as unknown as AssetDetail;

const qr = {
  assetId: "asset-1",
  assetNumber: "ESZ-0001",
  value: "acropora-os://assets/scan/qr-1",
  svg: "<svg />",
  labelSizeMm: 30,
} as AssetQrCode;

async function open(role: Session["user"]["role"] = "OWNER") {
  auth.session = session(role);
  render(<AssetDetailPage assetId="asset-1" />);
  await waitFor(() => expect(api.detail).toHaveBeenCalled());
  fireEvent.click(
    await screen.findByRole("button", { name: "Eszköz kivezetése" }),
  );
  return screen.findByRole("dialog");
}

describe("kivezetés a fő út, törlés a második", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.detail.mockResolvedValue(asset);
    api.qr.mockResolvedValue(qr);
    api.update.mockResolvedValue({ ...asset, status: "RETIRED" });
    api.remove.mockResolvedValue({ ok: true });
  });

  /**
   * AZ ELSO ALLITAS, ES NEM VELETLENUL: enelkul a dontes celja fordul a
   * visszajara. Ha ez a szoveg kikerul, EZ az allitas bukik, nevvel.
   */
  it("a kivezetés megerősítése KIMONDJA, hogy visszavonható, és hol", async () => {
    const dialog = await open();
    expect(dialog.textContent).toContain("Visszavonható");
    expect(dialog.textContent).toContain("állapot mezőben");
  });

  it("a megerősítés megnevezi, mi marad meg", async () => {
    const dialog = await open();
    expect(dialog.textContent).toContain("megmaradnak");
  });

  /**
   * EGY GOMB, NEM KETTO. Ket egymas melletti gomb VALASZTASSA tenne, ami nem az.
   */
  it("az adatlapon NINCS törlés gomb a kivezetés mellett", async () => {
    auth.session = session("OWNER");
    render(<AssetDetailPage assetId="asset-1" />);
    await waitFor(() => expect(api.detail).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /Végleges törlés/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Eszköz kivezetése" }),
    ).toBeTruthy();
  });

  it("a törlés a kivezetés ablakából érhető el, egy lépéssel beljebb", async () => {
    const dialog = await open();
    fireEvent.click(
      await screen.findByText("Ez az eszköz téves felvitel? Végleges törlés."),
    );
    const second = await screen.findByRole("dialog");
    expect(second.textContent).toContain("Véglegesen törlöd");
    expect(second.textContent).toContain("Nem vonható vissza");
    void dialog;
  });

  /**
   * A JOG NELKULI FELHASZNALONAK NEM LETILTVA, HANEM SEHOGY. Egy MANAGER minden
   * mas szempontbol jogosult (SERVICE_MANAGE megvan neki), es PONTOSAN a
   * torlesi jog hianyzik -- tehat ha a hivatkozas megjelenne, az CSAK a
   * jog-ellenorzes hibaja lehetne.
   */
  it("SERVICE_ASSET_DELETE nélkül a törlés-hivatkozás MEG SEM jelenik", async () => {
    const dialog = await open("MANAGER");
    expect(dialog.textContent).toContain("Kivezeted");
    expect(
      screen.queryByText("Ez az eszköz téves felvitel? Végleges törlés."),
    ).toBeNull();
  });

  /**
   * A SZERVER VISSZAUTASITASA SZO SZERINT MEGY TOVABB. Egy "az eszkoz nem
   * torolheto" mondat ugyanannyit mondana, mint a semmi: a szerver harom kulon
   * szamlalot ad, es epp az mondja meg, hol nezzen utana a felhasznalo.
   */
  it("a visszautasítás szövege megnevezi, MI tartja vissza", async () => {
    api.remove.mockRejectedValue(
      new Error(
        "Az eszköz nem törölhető, mert tartozik hozzá: 3 munkalapsor, 1 alárendelt eszköz.",
      ),
    );
    await open();
    fireEvent.click(
      await screen.findByText("Ez az eszköz téves felvitel? Végleges törlés."),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Végleges törlés" }),
    );
    expect(await screen.findByText(/3 munkalapsor/)).toBeTruthy();
    expect(screen.getByText(/1 alárendelt eszköz/)).toBeTruthy();
  });

  /**
   * A TOROLT ESZKOZ ADATAI NEM MARADNAK A KEPERNYON.
   *
   * Balazs eles hasznalatbol jelezte (2026-09-02): "ha letorlom, akkor nem a
   * listahoz ugrik vissza hanem a torolt eszkoz adatai maradnak a kepernyon".
   *
   * A visszateres-kartya MAR MUKODOTT; az adatlapot mutato blokk feltetele nem
   * tudott a torlesrol. Ket egymasnak ellentmondo dolog allt egy kepernyon.
   *
   * MINDKET IRANY EGY ALLITASBAN: a kartya OTT VAN, es az adatlap NINCS. A
   * masodik onmagaban akkor is teljesulne, ha az egesz oldal ures lenne -- es
   * epp a torles utan ez a legkonnyebben elhiheto tevedes.
   */
  it("törlés után a törölt eszköz adatai eltűnnek a képernyőről", async () => {
    const dialog = await open();
    fireEvent.click(
      await screen.findByText("Ez az eszköz téves felvitel? Végleges törlés."),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Végleges törlés" }),
    );

    await waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith("token-1", "asset-1"),
    );
    await screen.findByText(/Az eszköz törölve/);

    // A FEJLEC: a nev es a leltari szam.
    expect(screen.queryByText("Cápasuli kompresszor")).toBeNull();
    expect(screen.queryByText("ESZ-0001")).toBeNull();

    // ES AZ ADATLAP-BLOKK, KULON. A ket helyet KULON kell allitani: a fenti ket
    // ertek CSAK a fejlecben all, tehat onmagukban akkor is teljesulnenek, ha az
    // adatlap-blokk ottmaradna. Merve 2026-09-02: a `!deleted` kivetele a blokk
    // feltetelebol NULLA tesztet dontott pirosra, amig ez a ket sor nem allt itt.
    expect(screen.queryByText("Fánk Kft.")).toBeNull();
    expect(screen.queryByText("Tulajdonos")).toBeNull();
    void dialog;
  });

  /**
   * A MAR KIVEZETETT ESZKOZNEL VAN KOZVETLEN UT A TORLESHEZ.
   *
   * Balazs kerdese: "A Kivezetettet szandekosan nem lehet torolni csak ugy ha
   * elobb ujra aktivva teszem es utana torlom ki?" A valasz: nem szandekos. A
   * szerver megengedne (a harom akadalya kozott a RETIRED nincs ott); az utat a
   * felulet zarta el, mert a torles egyetlen bejarata a kivezetes ablaka volt,
   * az a gomb pedig kivezetett eszkoznel tiltott.
   *
   * A DONTES (2026-09-02 12:43): "igen legyen kozvetlenul elerheto a torles".
   *
   * A KONTROLL A HARMADIK SOR: ugyanez a gomb AKTIV eszkoznel NINCS ott. Az
   * allitas enelkul akkor is zold lenne, ha a gomb MINDIG megjelenne -- vagyis
   * ha epp a fenti dontest (a torles ne legyen egyenrangu ut) rontanank el.
   */
  it("a kivezetett eszközön a törlés közvetlenül elérhető", async () => {
    api.detail.mockResolvedValue({ ...asset, status: "RETIRED" });
    auth.session = session("OWNER");
    render(<AssetDetailPage assetId="asset-1" />);
    await waitFor(() => expect(api.detail).toHaveBeenCalled());

    fireEvent.click(
      await screen.findByRole("button", { name: "Végleges törlés" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Véglegesen törlöd");
    expect(dialog.textContent).toContain("Nem vonható vissza");
  });

  it("aktív eszközön ugyanez a közvetlen út NINCS ott", async () => {
    auth.session = session("OWNER");
    render(<AssetDetailPage assetId="asset-1" />);
    await waitFor(() => expect(api.detail).toHaveBeenCalled());

    expect(
      screen.queryByRole("button", { name: "Végleges törlés" }),
    ).toBeNull();
    // KONTROLL: a kivezetes utja viszont ott van, tehat nem egy ures oldalt merek.
    expect(
      screen.getByRole("button", { name: "Eszköz kivezetése" }),
    ).toBeTruthy();
  });

  /**
   * A JOG ITT IS DONT. Egy MANAGER-nek nincs `service-assets.delete` joga, es a
   * kozvetlen ut sem keletkezhet neki -- kulonben a kivezetett eszkoz eppen egy
   * KERULOUT lenne a jogosultsag korul.
   */
  it("SERVICE_ASSET_DELETE nélkül a kivezetett eszközön sincs törlés", async () => {
    api.detail.mockResolvedValue({ ...asset, status: "RETIRED" });
    auth.session = session("MANAGER");
    render(<AssetDetailPage assetId="asset-1" />);
    await waitFor(() => expect(api.detail).toHaveBeenCalled());

    expect(
      screen.queryByRole("button", { name: "Végleges törlés" }),
    ).toBeNull();
    // KONTROLL: a lap betoltodott, csak ez az egy ut hianyzik.
    expect(screen.getByText("Cápasuli kompresszor")).toBeTruthy();
  });
});
