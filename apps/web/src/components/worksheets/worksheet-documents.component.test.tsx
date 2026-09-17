import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorksheetDocuments } from "./worksheet-documents";
import { worksheetsApi } from "@/lib/api/worksheets";

vi.mock("@/lib/api/worksheets", () => ({
  worksheetsApi: {
    documents: vi.fn(),
    downloadDocument: vi.fn(),
  },
}));

const api = vi.mocked(worksheetsApi);

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

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

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

    render(<WorksheetDocuments worksheetId="ws-1" token="t" canView />);

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

    await waitFor(() => expect(api.documents).not.toHaveBeenCalled());
    expect(screen.queryByText("Csatolmányok")).toBeNull();
  });
});
