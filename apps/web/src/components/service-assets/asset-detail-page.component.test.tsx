import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AssetDetail, AssetQrCode, Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
import { AssetDetailPage } from "./asset-detail-page";

/**
 * A MEGERŐSÍTÉS MEGMONDJA, MI TÖRTÉNIK.
 *
 * Ez az oldal két visszafordíthatatlan műveletet kínál, és mindkettő a
 * böngésző `window.confirm` ablakán ment: a dokumentum törlésénél a teljes
 * kérdés annyi volt, hogy „Biztosan törlöd ezt a dokumentumot?". Az a mondat
 * nem mondja meg, hogy a fájl a tárolóból is eltűnik, és azt sem, hogy nincs
 * visszaút. Ez a fájl azt méri, hogy a kérdés MEGNEVEZI a következményt, és
 * hogy a „Mégsem" tényleg nem csinál semmit.
 */

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const api = vi.hoisted(() => ({
  detail: vi.fn(),
  qr: vi.fn(),
  update: vi.fn(),
  rotateQr: vi.fn(),
  deleteDocument: vi.fn(),
  uploadDocument: vi.fn(),
  documentUrl: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/szerviz/eszkozok/asset-1",
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
  documents: [
    {
      id: "doc-1",
      type: "INVOICE",
      fileName: "szamla-2026-08.pdf",
      contentType: "application/pdf",
      sizeBytes: 12345,
      sha256: "abc",
      createdAt: "2026-08-25T10:00:00.000Z",
      uploadedBy: { id: "user-1", displayName: "Balázs" },
    },
  ],
} as unknown as AssetDetail;

const qr = {
  assetId: "asset-1",
  assetNumber: "ESZ-0001",
  value: "acropora-os://assets/scan/qr-1",
  svg: "<svg />",
  labelSizeMm: 30,
} as AssetQrCode;

beforeEach(() => {
  vi.clearAllMocks();
  api.detail.mockResolvedValue(asset);
  api.qr.mockResolvedValue(qr);
  api.documentUrl.mockReturnValue("https://pelda.invalid/doc-1");
});

async function openDocumentConfirm() {
  render(<AssetDetailPage assetId="asset-1" />);
  const remove = await screen.findByRole("button", { name: "Törlés" });
  fireEvent.click(remove);
  return await screen.findByRole("dialog");
}

describe("AssetDetailPage megerősítései", () => {
  it("names what is lost and whether it can be recovered", async () => {
    const dialog = await openDocumentConfirm();

    // A fájl NEVE benne van: nem „ezt a dokumentumot", hanem melyiket.
    expect(dialog.textContent).toMatch(/szamla-2026-08\.pdf/);
    // MI VÉSZ EL: nem csak a listáról tűnik el.
    expect(dialog.textContent).toMatch(/tárolóból is törlődik/);
    // HONNAN SZEREZHETŐ VISSZA: itt sehonnan, és ezt ki is mondja.
    expect(dialog.textContent).toMatch(/Nem vonható vissza/);
  });

  /**
   * A KÉRDÉS ÖNMAGÁBAN NEM TÖRÖL. Ez a `window.confirm`-nál magától értetődő
   * volt, egy saját ablaknál viszont ez az a hiba, amit könnyű bevinni: a
   * gomb megnyitja a kérdést ÉS elindítja a műveletet.
   */
  it("does not delete anything just by asking", async () => {
    await openDocumentConfirm();

    expect(api.deleteDocument).not.toHaveBeenCalled();
  });

  /**
   * A MERET KIIRASAT SEMMI NEM MERTE, ES EZT EGY KALIBRACIO TALALTA MEG.
   *
   * A `formatFileSize` 2026-09-14 ota KOZOS fuggveny (`lib/format/file-size`),
   * mert a hibajegy csatolmanyainak ugyanez kellett. A kozos alakot egy
   * kalibracio igazolta volna: a kerekites elrontasakor MINDKET kepernyo
   * allitasanak pirosra kellene valtania.
   *
   * MERVE: csak az EGYIK valtott (a hibajegye). Ez a lap a `sizeBytes: 12345`
   * erteket MAR a fixturaban hordozta, de a KIIRT alakrol nem allitott semmit
   * -- vagyis a kozos fuggveny itteni hasznalata meretlen volt. Egy elmozdulo
   * kerekites ezen a kepernyon csendben valtoztatott volna.
   *
   * 12345 / 1024 = 12.06, kerekitve 12.
   */
  it("shows the file size in the shared format", async () => {
    render(<AssetDetailPage assetId="asset-1" />);

    expect(await screen.findByText(/12 kB/)).toBeTruthy();
  });

  it("does nothing when the answer is no", async () => {
    await openDocumentConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Mégsem" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(api.deleteDocument).not.toHaveBeenCalled();
  });

  it("deletes exactly the document that was named", async () => {
    api.deleteDocument.mockResolvedValue(undefined);
    await openDocumentConfirm();

    fireEvent.click(screen.getByRole("button", { name: "Végleges törlés" }));

    await waitFor(() =>
      expect(api.deleteDocument).toHaveBeenCalledWith(
        "token-1",
        "asset-1",
        "doc-1",
      ),
    );
  });

  /**
   * A QR-CSERE a másik visszafordíthatatlan művelet ugyanezen az oldalon, és a
   * következménye MÁS: nem adat vész el, hanem a kinyomtatott matrica válik
   * használhatatlanná. A két kérdés szövege ezért nem lehet ugyanaz.
   */
  it("says something different about the QR label, because the loss is different", async () => {
    render(<AssetDetailPage assetId="asset-1" />);
    const rotate = await screen.findByRole("button", {
      name: "QR-kód lecserélése",
    });
    fireEvent.click(rotate);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/matricán lévő kód azonnal érvénytelen/);
    expect(dialog.textContent).toMatch(/ki kell nyomtatni/);
    expect(api.rotateQr).not.toHaveBeenCalled();
  });
});

/**
 * AZ ADATLAP FEJLECE, Balazs 2026-09-15-i designjabol.
 *
 * Ket dolgot merunk, es mind a ketto olyan, aminek az elromlasa NEMA lenne.
 */
describe("AssetDetailPage fejléc", () => {
  /**
   * A LAP CIME AZ ESZKOZ NEVE, a szama a folotte allo kis sor. Forditva volt.
   * Az allitas a SZEREPRE megy (`heading`), nem arra, hogy a szoveg valahol
   * megjelenik: az eszkozszam tovabbra is ott all, csak nem cimkent.
   */
  it("a lap címe az eszköz neve, az eszközszám a fölötte álló sor", async () => {
    render(<AssetDetailPage assetId="asset-1" />);

    const cim = await screen.findByRole("heading", { level: 1 });
    expect(cim.textContent).toBe("Cápasuli kompresszor");
    expect(screen.getAllByText("ESZ-0001").length).toBeGreaterThan(0);
  });

  /**
   * AZ ALLAPOT-JELVENY PONTOSAN EGYSZER all a lapon.
   *
   * A fejlecbe kerult, es a lenti kartyabol ezert ki kellett venni. Ket jelveny
   * egy kepernyon nem hiba, amig ugyanabbol a mezobol jon -- de ha az egyik
   * valaha mas forrasra allna at, a ketto ellentmondana egymasnak, es semmi nem
   * szolna rola.
   *
   * A VALASZTO SORAIT KI KELL HAGYNI, ES EZ NEM A MERES GYENGITESE. Az
   * allapot-allito legordulo felsorolja MIND A NEGY allapotot, koztuk az
   * aktualisat -- az egy MASIK dolog: nem azt mondja, mi az eszkoz allapota,
   * hanem azt, mire lehet allitani. Az elso valtozatom ezt is beleszamolta, es
   * ezert bukott el egy helyes lapon.
   */
  it("az állapot-jelvény pontosan egyszer szerepel a lapon", async () => {
    render(<AssetDetailPage assetId="asset-1" />);
    await screen.findByRole("heading", { level: 1 });

    const jelvenyek = screen
      .getAllByText("Aktív")
      .filter((elem) => elem.tagName !== "OPTION");
    expect(jelvenyek).toHaveLength(1);
  });
});

/**
 * A SAV A LAP ALLAPOTAROL BESZEL, NEM A KAPCSOLATROL -- ES A HELYES SZAM NEM
 * EGY, HANEM ANNYI, AHANY ALLAPOTBA A LAP BE TUD KERULNI.
 *
 * Ez a lap kettobe: `asset ? loaded : empty`. A ket allitas EGYUTT fogja meg a
 * rogzult valasztast; kulon-kulon egyik sem. Egy adatlap, ami mindig
 * `loaded`-ot ad, a tipusellenorzesen ES az elso allitason is atmegy, es hideg
 * betolteskor azt mondana, hogy "a legutobb betoltott adatokat latod",
 * miközben a kepernyo ures.
 */
describe("AssetDetailPage kapcsolat nélkül", () => {
  beforeEach(() => setOnLine(false));

  afterEach(() => setOnLine(true));

  it("betöltött eszközlapon a frissítésről beszél", async () => {
    render(<AssetDetailPage assetId="asset-1" />);
    await screen.findByText("Cápasuli kompresszor");

    expect(await savotMond("loaded")).toBeTruthy();
  });

  it("üres képernyőn azt mondja, hogy ezért nincs adat", async () => {
    // SOHA NEM TELJESULO valasz: a lap a "meg semmi nem toltodott be"
    // allapotban marad, vagyis pont abban, amirol a masodik mondat szol.
    api.detail.mockReturnValue(new Promise(() => {}));
    render(<AssetDetailPage assetId="asset-1" />);

    expect(await savotMond("empty")).toBeTruthy();
  });
});
