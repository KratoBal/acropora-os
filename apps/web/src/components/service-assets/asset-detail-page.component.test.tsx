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
  downloadDocument: vi.fn(),
  downloadDocumentThumbnail: vi.fn(),
  setDocumentCaption: vi.fn(),
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
  api.downloadDocument.mockResolvedValue(new Blob(["kep"]));
  /*
    A CSEMPE A BELYEGKEP-AGAT HIVJA (2026-09-18 ota), a `downloadDocument`
    pedig a MENTESE marad. Mind a kettot fel kell venni: egy hianyzo mock
    ugyanugy ures csempet adna, mint a valodi hiba.
  */
  api.downloadDocumentThumbnail.mockResolvedValue(new Blob(["kep"]));
  api.setDocumentCaption.mockResolvedValue({ ok: true });
});

/**
 * A FENYKEP KEPKENT, A PDF LETOLTHETOKENT.
 *
 * Balazs kerese (2026-09-17): a feltoltott fenykepeket sehol nem lehet
 * megnezni. Ezen a lapon eddig egy `Letoltes` gomb allt minden csatolmany
 * mellett -- a telefonrol feltoltott fenykepet csak letoltes utan lehetett
 * megnezni.
 *
 * A KETTOT EGY FIXTURABAN merjuk, mert a hiba pont a SZETVALASZTASBAN lenne:
 * ha a lap mindenre kepet rajzolna, a PDF-bol torott csempe lenne (ami ugyanugy
 * nez ki, mint egy be nem toltott fenykep); ha semmire, akkor nincs galeria.
 */
const ketCsatolmany = {
  ...asset,
  documents: [
    {
      id: "doc-2",
      type: "OTHER",
      fileName: "medence.jpg",
      contentType: "image/jpeg",
      sizeBytes: 204800,
      sha256: "def",
      caption: null,
      createdAt: "2026-09-17T09:00:00.000Z",
    },
    ...(asset.documents ?? []),
  ],
} as unknown as AssetDetail;

describe("AssetDetailPage csatolmány-galéria", () => {
  it("a fénykép képként látszik, a PDF letölthető marad", async () => {
    api.detail.mockResolvedValue(ketCsatolmany);
    render(<AssetDetailPage assetId="asset-1" />);

    const kep = await screen.findByAltText("medence.jpg");
    expect(kep.getAttribute("src")).toMatch(/^blob:/);
    // A PDF-BOL NEM LESZ KEP...
    expect(screen.queryByAltText("szamla-2026-08.pdf")).toBeNull();
    // ...ES A NEVEN MEGTALALHATO MARAD.
    expect(screen.getByText("szamla-2026-08.pdf")).toBeTruthy();
  });

  /**
   * A FAJTA NEM TUNHET EL A GALERIAVAL.
   *
   * A korabbi, kezzel rajzolt lista kiirta (`Szamla · szamla-2026-08.pdf`), es
   * az eszkozon NEGY fajta all: a fajlnev nem kulonbozteti meg oket. Egy szamla
   * es egy garancialevel ugyanugy `szamla-2026.pdf` lehet.
   */
  it("a dokumentum fajtája a galériában is kiírva marad", async () => {
    api.detail.mockResolvedValue(ketCsatolmany);
    render(<AssetDetailPage assetId="asset-1" />);

    await screen.findByAltText("medence.jpg");
    expect(screen.getByText(/Számla ·/)).toBeTruthy();
    // A MASIK CSATOLMANY FAJTAJA IS, a kep-csempen.
    expect(screen.getByText(/Egyéb ·/)).toBeTruthy();
  });

  /**
   * A FELIRAT A SZERVERRE MEGY, ES A LAP UTANA UJRATOLT.
   *
   * MIERT A UJRATOLTES IS ALLITAS: a csempe a SZERVER szerinti allapotot
   * mutassa. Ha csak a helyi allapotot irnank at, egy elutasitott mentes utan a
   * kepernyo a begepelt szoveget mutatna tovabb, mintha mentve lenne.
   */
  it("a felirat mentése a szerverre megy, és utána újratölt", async () => {
    /**
     * CSAK A FENYKEP ALL A FIXTURABAN, ES EZT EGY KALIBRACIO KENYSZERITETTE KI.
     *
     * A ket csatolmanyos fixturaval ez az allitas AKKOR IS pirosra valtott,
     * amikor a kep/nem-kep szetvalasztast rontottam el: ott a PDF-bol is csempe
     * lett, tehat KET "Felirat" gomb allt a lapon, es a valaszto ezen hasalt el.
     * Egy allitas, ami MAS hibatol is pirosodik, nem mondja meg, mit mert.
     */
    api.detail.mockResolvedValue({
      ...asset,
      documents: [ketCsatolmany.documents[0]],
    } as unknown as AssetDetail);
    render(<AssetDetailPage assetId="asset-1" />);
    await screen.findByAltText("medence.jpg");
    expect(api.detail).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Felirat" }));
    fireEvent.change(screen.getByPlaceholderText("Mit látunk a képen?"), {
      target: { value: "A hármas medence" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mentés" }));

    await waitFor(() =>
      expect(api.setDocumentCaption).toHaveBeenCalledWith(
        "token-1",
        "asset-1",
        "doc-2",
        "A hármas medence",
      ),
    );
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
  });
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

  /**
   * A TELJESITMENY AZ ADATLAPON, A MERTEKEGYSEGEVEL EGYUTT (Balazs kerese,
   * 2026-09-16). A mezo eddig csak a SZERKESZTOBEN letezett: be lehetett irni,
   * es utana sehol nem latszott.
   *
   * EGY MEZO, NEM KETTO: az ertek es a jele egy adat. Ket kulon soron a szam
   * elszakadna a jeletol, es egy "500" onmagaban talalgatasra hivas.
   */
  it("kiírja a teljesítményt a mértékegységével, egy mezőben", async () => {
    api.detail.mockResolvedValue({
      ...asset,
      performance: "500",
      performanceUnit: { id: "uom-1", code: "m3/h", name: "köbméter per óra" },
    });

    render(<AssetDetailPage assetId="asset-1" />);

    expect(await screen.findByText("500 m3/h")).toBeTruthy();
  });

  /**
   * ES A MERTEKEGYSEG NELKULI ERTEK NEM ESIK EL.
   *
   * A tablan parositasi feltetel all, tehat ez a kombinacio ma nem tud
   * keletkezni -- egy regebbi sor vagy egy kozvetlen adatbazis-iras viszont
   * eloallithatja. Olyankor a puszta szam TOBBET er a gondolatjelnel: a kezelo
   * legalabb latja, hogy van ertek, es hogy hianyos. Az elnyelt adat csendben
   * tunne el, es epp azt nem venne eszre senki.
   */
  it("a mértékegység nélküli értéket is kiírja, nem nyeli el", async () => {
    api.detail.mockResolvedValue({ ...asset, performance: "500" });

    render(<AssetDetailPage assetId="asset-1" />);

    expect(await screen.findByText("500")).toBeTruthy();
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

/**
 * A MATRICAKOD LATSZIK AZ ADATLAPON.
 *
 * A MERT HIANY (nautilus, 2026-09-17): a matricat FEL lehetett vinni -- a
 * szerkesztoben van mezo, es a mentes el is kuldi --, de aki ranezett egy gepre,
 * amin ott a matrica, a rendszerben NEM tudta szemre visszakeresni. Egyetlen
 * adatlapon sem jelent meg. Beolvasassal mar mukodott, szemre nem.
 *
 * EZ NEM DONTES VOLT, HANEM HIANY: nem kepzelheto olyan olvasat, amiben
 * szandekos, hogy egy felvitt azonosito sehol nem latszik.
 */
describe("az eszköz matricakódja az adatlapon", () => {
  it("kiírja a matricakódot a többi azonosító közé", async () => {
    api.detail.mockResolvedValue({
      ...asset,
      labelCode: "V2196",
    } as unknown as AssetDetail);
    render(<AssetDetailPage assetId="asset-1" />);

    expect(await screen.findByText("Matricakód")).toBeTruthy();
    expect(screen.getByText("V2196")).toBeTruthy();
  });

  /**
   * MATRICA NELKUL A MEZO OTT MARAD, GONDOLATJELLEL.
   *
   * MI PIROSIT: ha a mezot csak akkor rajzolnank ki, amikor van erteke. Az
   * ELREJTES ugyanugy nez ki, mint a mai hiba: a kezelo nem tudna megmondani,
   * hogy ezen a gepen NINCS matrica, vagy a lap nem mutatja. A tobbi
   * kitoltetlen mezo (sorozatszam, leltari szam) is gondolatjelet ir.
   */
  it("matrica nélkül a mező ott marad, gondolatjellel", async () => {
    render(<AssetDetailPage assetId="asset-1" />);

    expect(await screen.findByText("Matricakód")).toBeTruthy();
    // A FIXTURE-ON NINCS `labelCode`, tehat a mezo erteke gondolatjel. Tobb
    // kitoltetlen mezo is van a lapon, ezert a DARABSZAMRA nem allitunk -- a
    // mezo LETEZESE az allitas.
    const cimke = screen.getByText("Matricakód");
    expect(cimke.nextElementSibling?.textContent).toBe("—");
  });

  /**
   * A QR-PANEL A SAJAT KODJAT MUTATJA, NEM A MATRICAKODOT.
   *
   * A lapon KET kod all. A QR a `qrToken`-en (128 bit), a matricakod egy kiadott
   * keszletbol jon -- 260 ezer lehetoseg, amit egy belepett partner
   * vegigprobalhatna. Ezert nem cserelheto fel a ketto.
   *
   * MI PIROSIT: ha valaki a QR-panelbe teszi ki a matricakodot, vagy a
   * kirajzolt kodot arra csereli. Kivulrol mind a ketto ugy nez ki, mintha a
   * lap rendben lenne.
   *
   * === ES AZ ELSO VALTOZATA HALOTT VOLT, EZERT ALL ITT MASKEPP ===
   *
   * Eloszor a `assetsApi.qr(...)` ARGUMENTUMAIRA allitottam, hogy a matricakod
   * nem megy at. Lemertem: a QR-hivas AKKOR indul, amikor az eszkoz MEG NINCS
   * betoltve, tehat ott a matricakod nem is letezik -- egy szandekos "szivarogtato"
   * rontas is `undefined`-ot adott volna at, es az allitas ZOLD maradt. Nem a
   * kod volt jo: az allitas nem tudott elbukni.
   */
  it("a QR-panel a saját kódját mutatja, nem a matricakódot", async () => {
    api.detail.mockResolvedValue({
      ...asset,
      labelCode: "V2196",
    } as unknown as AssetDetail);
    render(<AssetDetailPage assetId="asset-1" />);

    const panel = await screen.findByLabelText("ESZ-0001 QR-kódja");
    // POZITIV KONTROLL: a panel a VEGPONT valaszat rajzolja ki. Enelkul az alabbi
    // tagadas egy URES panelre is teljesulne.
    expect(panel.querySelector("svg")).toBeTruthy();
    expect(panel.textContent).not.toContain("V2196");
  });
});
