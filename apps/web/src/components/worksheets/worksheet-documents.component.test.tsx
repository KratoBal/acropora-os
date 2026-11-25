import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { answered } from "@/test/answered";
import { WorksheetDocuments } from "./worksheet-documents";
import { worksheetsApi } from "@/lib/api/worksheets";

/**
 * A `next/font/local` HÍVÁSA A NEXT.JS FORDÍTÓI MAKRÓJA -- vitest alatt,
 * Next build nélkül nem futtatható, `TypeError: default is not a
 * function`-nal bukik. Ez a modul csak a `PilotCard`/`PilotCardHeader`-en
 * keresztül, TRANZITÍVEN kerül ide (`pilot-ui.tsx` importálja
 * `pilot-font.ts`-ből) -- lásd ugyanezt a mockot a
 * `pilot-theme-root.component.test.tsx`-ben.
 */
vi.mock("next/font/local", () => ({
  default: () => ({ className: "pilot-inter-stub" }),
}));

vi.mock("@/lib/api/worksheets", () => ({
  worksheetsApi: {
    documents: vi.fn(),
    downloadDocument: vi.fn(),
    downloadDocumentThumbnail: vi.fn(),
    regenerateIssuedSheet: vi.fn(),
  },
}));

const api = vi.mocked(worksheetsApi);

/**
 * EGY PANEL ELEME A CIME ALAPJAN. A cim `<h2>`, a panel a kozos oset adja --
 * enelkul a `screen` az EGESZ oldalon keresne, es a hely-allitas ertelmet
 * vesztene.
 */
function szakasz(cim: string): HTMLElement {
  const fejlec = screen.getByText(cim);
  const panel =
    fejlec.closest("section") ?? fejlec.parentElement?.parentElement;
  if (!panel) throw new Error(`nem találtam a panelt: ${cim}`);
  return panel as HTMLElement;
}

function doku(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    type: "PHOTO" as const,
    fileName: "szivattyu.jpg",
    contentType: "image/jpeg" as const,
    sizeBytes: 204800,
    sha256: "a".repeat(64),
    caption: null,
    createdAt: "2026-09-17T09:00:00.000Z",
    ...overrides,
  };
}

/**
 * `clearAllMocks`, NEM CSAK `restoreAllMocks` -- ES EZT EGY PIROS TESZT KERTE.
 *
 * A `vi.mock` gyara MODUL-SZINTU: a benne keszult `vi.fn()` peldanyok a fajl
 * OSSZES tesztjen at ugyanazok, es a `restoreAllMocks` a HIVAS-TORTENETET nem
 * torli. Az utolso allitas ("nem kerdez le semmit") ezert egy KORABBI teszt
 * hivasat latta, es pirosra valtott -- holott a viselkedes helyes volt.
 */
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("WorksheetDocuments", () => {
  /**
   * EZ A LÉNYEG, ÉS EZ VOLT A BEJELENTÉS.
   *
   * Balázs szava (2026-09-17): „a feltoltott fenykepek sehol nem jelnnek meg.
   * marmint nem tudom megnezni se a mobil appban se a weben".
   *
   * MI PIROSÍT: a mai viselkedés. A munkalap lapján a `documents` szó EGYSZER
   * SEM fordult elő, tehát a végpontot senki nem hívta -- ez az állítás azon a
   * kódon elbukik.
   */
  it("lekéri a csatolmányokat, és megjeleníti a képet", async () => {
    api.documents.mockResolvedValue({ items: [doku()] });
    api.downloadDocument.mockResolvedValue(new Blob(["kep"]));
    api.downloadDocumentThumbnail.mockResolvedValue(new Blob(["kep"]));

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

    await answered(api.documents);

    const kep = await screen.findByAltText("szivattyu.jpg");
    expect(kep.getAttribute("src")).toMatch(/^blob:/);
    expect(api.documents).toHaveBeenCalledWith("t", "ws-1", expect.anything());
  });

  /**
   * TÖRLŐ GOMB NINCS, ÉS EZ MÉRÉS: a munkalapon nincs törlő végpont (a
   * controlleren `Post`, két `Get` és egy `Patch` áll, `Delete` nem). Egy gomb,
   * ami olyat ígér, amit a szerver nem tud, rosszabb a hiányzó gombnál.
   *
   * MI PIROSÍT: ha valaki `onDelete`-et adna át a galériának.
   */
  it("nem kínál törlést, mert a szerveren nincs törlő végpont", async () => {
    api.documents.mockResolvedValue({ items: [doku()] });
    api.downloadDocument.mockResolvedValue(new Blob(["kep"]));
    api.downloadDocumentThumbnail.mockResolvedValue(new Blob(["kep"]));

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

    await answered(api.documents);

    await screen.findByAltText("szivattyu.jpg");
    expect(screen.queryByRole("button", { name: "Törlés" })).toBeNull();
  });

  /**
   * AZ ÜRES LISTA KI VAN MONDVA. Egy üres doboz betöltési hibának látszik, és a
   * kezelő megvárja -- ez a mondat kimondja, hogy nincs mire várni.
   */
  it("kimondja, ha nincs csatolmány", async () => {
    api.documents.mockResolvedValue({ items: [] });

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

    await answered(api.documents);

    expect(
      await screen.findByText(/még nincs fénykép vagy fájl csatolva/),
    ).toBeTruthy();
  });

  /**
   * A HIBA NEM UGYANAZ, MINT AZ ÜRES LISTA.
   *
   * Egy közös „nincs csatolmány" mondat azt ÁLLÍTANÁ, hogy nincs -- holott
   * ilyenkor csak nem tudjuk, és a kezelő hiába várna. A kettő teendője
   * ellentétes: az egyikre nincs mit tenni, a másikra újra kell próbálni.
   *
   * MI PIROSÍT: ha a hiba ágán is az üres-mondat jelenne meg.
   */
  it("a betöltési hibát megkülönbözteti az üres listától", async () => {
    api.documents.mockRejectedValue(new Error("A szerver nem érhető el."));

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

    await answered(api.documents);

    expect(await screen.findByText("A szerver nem érhető el.")).toBeTruthy();
    expect(
      screen.queryByText(/még nincs fénykép vagy fájl csatolva/),
    ).toBeNull();
  });

  /**
   * AKI NEM LÁTHATJA A LAPOT, ANNAK A SZAKASZ SEM JELENIK MEG -- és a
   * lekérdezés SEM INDUL EL. Enélkül a lap egy 403-at kérne le minden
   * megnyitáskor, és a hibát ki is írná annak, akinek amúgy sincs dolga vele.
   */
  it("nem kérdez le semmit, ha a néző nem láthatja a lapot", async () => {
    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView={false} />);
    await answered(api.documents);

    await waitFor(() => expect(api.documents).not.toHaveBeenCalled());
    expect(screen.queryByText("Csatolmányok")).toBeNull();
  });

  /**
   * A KIADOTT LAP SAJAT SZAKASZBAN ALL, NEM A CSATOLMANYOK KOZOTT.
   *
   * acrobot dontese, 2026-09-18. Ket indok: a csatolmany az, amit VALAKI
   * FELTOLTOTT, a lap az, amit a RENDSZER ADOTT KI -- es a munkalap-oldal nem
   * ad torles-gombot, tehat ez volt az EGYETLEN fajl a panelben, amit nem lehet
   * eltavolitani.
   */
  it("a KIADOTT lap nem a csatolmányok között jelenik meg", async () => {
    api.documents.mockResolvedValue({
      items: [
        doku(),
        doku({
          id: "lap-1",
          type: "GENERATED_SHEET",
          fileName: "BIO-2026-002-v1.pdf",
          contentType: "application/pdf" as const,
        }),
      ],
    });

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

    await answered(api.documents);

    /*
      A HELY A BIZONYITEK, NEM A LATHATOSAG -- ES EZT A KALIBRACIO KENYSZERITETTE
      KI. Az elso alakom csak annyit allitott, hogy a ket szakasz neve es a
      fajlnev megvan valahol. Amikor a szetvalasztast elrontottam (mind a ket
      szakasz a TELJES listat kapta), az allitas kipirosodott ugyan -- de azert,
      mert a fajlnev KETSZER szerepelt, nem azert, mert rossz helyen allt.

      Ezert a ket szakaszra SZUKITVE keresunk: a lap a sajatjaban van, a
      csatolmanyok kozott pedig NINCS ott.
    */
    await screen.findByText("A kiadott munkalap");
    const kiadott = szakasz("A kiadott munkalap");
    const csatolmanyok = szakasz("Csatolmányok");

    expect(within(kiadott).getByText("BIO-2026-002-v1.pdf")).toBeTruthy();
    expect(within(csatolmanyok).queryByText("BIO-2026-002-v1.pdf")).toBeNull();
    // ES A FENYKEP A MASIK OLDALON: enelkul egy ures csatolmany-szakasz is
    // kielegitene a fenti tagadast.
    expect(within(csatolmanyok).getByText("szivattyu.jpg")).toBeTruthy();
    expect(within(kiadott).queryByText("szivattyu.jpg")).toBeNull();
  });

  // f0b70dbd: the closing-time and the signed sheet share one file name; each says which it is, and an upload says nothing
  it("a két kiadott lap a fajtáját mondja: aláírt, végleges és lezáráskori", async () => {
    api.documents.mockResolvedValue({
      items: [
        doku(),
        doku({
          id: "lap-1",
          type: "GENERATED_SHEET",
          fileName: "munkalap-TST-2026-030.pdf",
          contentType: "application/pdf" as const,
          createdAt: "2026-11-25T13:39:01.000Z",
        }),
        doku({
          id: "lap-2",
          type: "SIGNED_SHEET",
          fileName: "munkalap-TST-2026-030.pdf",
          contentType: "application/pdf" as const,
          createdAt: "2026-11-25T13:39:20.000Z",
        }),
      ],
    });

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

    await answered(api.documents);
    await screen.findByText("A kiadott munkalap");
    const kiadott = szakasz("A kiadott munkalap");
    expect(within(kiadott).getByText(/^Aláírt, végleges · /)).toBeTruthy();
    expect(within(kiadott).getByText(/^Lezáráskori · /)).toBeTruthy();
    const csatolmanyok = szakasz("Csatolmányok");
    expect(within(csatolmanyok).queryByText(/Lezáráskori/)).toBeNull();
    expect(within(csatolmanyok).queryByText(/Aláírt, végleges/)).toBeNull();
  });

  it("piszkozatnál a szakasz ÁLL, és kimondja, miért üres", async () => {
    /*
      MI PIROSIT: ha a szakasz elrejtodik, amikor meg nincs kiadott peldany.
      Akkor a felhasznalo nem tudna, hova fog kerulni -- es a lezaras utan egy
      uj panel jelenne meg magyarazat nelkul.
    */
    api.documents.mockResolvedValue({ items: [doku()] });

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

    await answered(api.documents);

    expect(await screen.findByText("A kiadott munkalap")).toBeTruthy();
    expect(
      screen.getByText(/még nincs lezárva, ezért kiadott példány sem készült/),
    ).toBeTruthy();
  });
});

/*
  A KIADOTT PDF ÚJRAGENERÁLÁSA GOMB (Balázs 2026-11-18 19:17 UTC, kártya 47e07a53; acrobot 56321). MI PIROSÍT: ha a gomb olyannak is megjelenik, aki nem kezelheti a lapot; ha piszkozatnál (nincs kiadott példány) látszik; ha a kattintás nem a lap azonosítójára
  hívja a végpontot; ha a gomb a hívás közben nem tiltott (dupla kattintás); ha a siker után a lista nem töltődik újra (az archív példány a Csatolmányok között csak így jelenne meg); ha a "nem változott" és a "megtörtént" nem különböző mondat;
  ha a szerver okát (409) nem mutatja.
*/
describe("a kiadott PDF újragenerálása", () => {
  const kiadott = () => [
    doku({
      id: "lap-1",
      type: "GENERATED_SHEET",
      fileName: "munkalap-NMD-2026-028.pdf",
      contentType: "application/pdf" as const,
    }),
  ];

  it("a kezelőnek a kiadott lap szakaszában látszik, másnak nem", async () => {
    api.documents.mockResolvedValue({ items: kiadott() });
    const { unmount } = render(
      <WorksheetDocuments worksheetId="ws-1" token="t" canView canRegenerate />,
    );
    await answered(api.documents);
    // a betöltés UTÁN mérünk: a fejléc a betöltés előtt is áll, és a gomb a kiadott sor megérkezésével jelenik meg
    await screen.findByText("munkalap-NMD-2026-028.pdf");
    expect(
      within(szakasz("A kiadott munkalap")).getByRole("button", {
        name: "PDF újragenerálása",
      }),
    ).toBeTruthy();
    unmount();

    api.documents.mockResolvedValue({ items: kiadott() });
    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);
    await screen.findByText("munkalap-NMD-2026-028.pdf");
    expect(
      screen.queryByRole("button", { name: "PDF újragenerálása" }),
    ).toBeNull();
  });

  it("piszkozatnál nincs gomb: nincs kiadott példány", async () => {
    api.documents.mockResolvedValue({ items: [doku()] });
    render(
      <WorksheetDocuments worksheetId="ws-1" token="t" canView canRegenerate />,
    );
    await answered(api.documents);
    // a betöltés UTÁN mérünk: a piszkozat szakasza kimondja, miért üres
    await screen.findByText(
      /még nincs lezárva, ezért kiadott példány sem készült/,
    );
    expect(
      screen.queryByRole("button", { name: "PDF újragenerálása" }),
    ).toBeNull();
  });

  it("a kattintás a lap azonosítójára hív, utána újratölti a listát, és kimondja a változást", async () => {
    api.documents.mockResolvedValue({ items: kiadott() });
    api.regenerateIssuedSheet.mockResolvedValue({ changed: true });
    render(
      <WorksheetDocuments worksheetId="ws-1" token="t" canView canRegenerate />,
    );
    await answered(api.documents);

    fireEvent.click(
      await screen.findByRole("button", { name: "PDF újragenerálása" }),
    );

    await waitFor(() =>
      expect(api.regenerateIssuedSheet).toHaveBeenCalledWith("t", "ws-1"),
    );
    expect(
      await screen.findByText(/újragenerálva.*korábbi példány.*Csatolmányok/i),
    ).toBeTruthy();
    await waitFor(() => expect(api.documents).toHaveBeenCalledTimes(2));
  });

  it("ha nem változott semmi, ezt mondja, és nem azt, hogy megtörtént", async () => {
    api.documents.mockResolvedValue({ items: kiadott() });
    api.regenerateIssuedSheet.mockResolvedValue({ changed: false });
    render(
      <WorksheetDocuments worksheetId="ws-1" token="t" canView canRegenerate />,
    );
    await answered(api.documents);

    fireEvent.click(
      await screen.findByRole("button", { name: "PDF újragenerálása" }),
    );

    expect(await screen.findByText(/már a mostani elrendezésű/i)).toBeTruthy();
    expect(screen.queryByText(/korábbi példány/i)).toBeNull();
    // változatlan tárolt példánynál nincs miért újratölteni a listát
    expect(api.documents).toHaveBeenCalledTimes(1);
  });

  it("a hívás közben a gomb tiltott, hogy a dupla kattintás ne menjen ki kétszer", async () => {
    api.documents.mockResolvedValue({ items: kiadott() });
    let ujraGeneralasKesz: (value: { changed: boolean }) => void = () => {};
    api.regenerateIssuedSheet.mockReturnValue(
      new Promise((resolve) => {
        ujraGeneralasKesz = resolve;
      }),
    );
    render(
      <WorksheetDocuments worksheetId="ws-1" token="t" canView canRegenerate />,
    );
    await answered(api.documents);

    const gomb = await screen.findByRole("button", {
      name: "PDF újragenerálása",
    });
    fireEvent.click(gomb);
    await waitFor(() =>
      expect((gomb as HTMLButtonElement).disabled).toBe(true),
    );
    fireEvent.click(gomb);
    expect(api.regenerateIssuedSheet).toHaveBeenCalledTimes(1);
    ujraGeneralasKesz({ changed: true });
    await waitFor(() =>
      expect((gomb as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("a szerver okát mutatja, ha az újragenerálás elutasított", async () => {
    api.documents.mockResolvedValue({ items: kiadott() });
    api.regenerateIssuedSheet.mockRejectedValue(
      new Error(
        "Az aláírt laphoz nincs végleges PDF, ezért nincs mit újragenerálni.",
      ),
    );
    render(
      <WorksheetDocuments worksheetId="ws-1" token="t" canView canRegenerate />,
    );
    await answered(api.documents);

    fireEvent.click(
      await screen.findByRole("button", { name: "PDF újragenerálása" }),
    );

    expect(await screen.findByText(/nincs végleges PDF/)).toBeTruthy();
    expect(api.documents).toHaveBeenCalledTimes(1);
  });
});
