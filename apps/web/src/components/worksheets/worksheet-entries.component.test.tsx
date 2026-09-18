import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, WorksheetEntryDetail } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorksheetEntries } from "./worksheet-entries";

const api = vi.hoisted(() => ({
  entries: vi.fn(),
  addEntry: vi.fn(),
  updateEntry: vi.fn(),
}));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "owner@acropora.local",
    displayName: "Tulaj Tibor",
    nickname: null,
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

function entry(over: Partial<WorksheetEntryDetail> = {}): WorksheetEntryDetail {
  return {
    id: "entry-1",
    body: "Szivattyú csere",
    authorName: "Szerelő Sándor",
    createdAt: "2026-09-04T08:00:00.000Z",
    updatedAt: "2026-09-04T08:00:00.000Z",
    canEdit: true,
    editRefusal: null,
    ...over,
  };
}

beforeEach(() => {
  auth.session = session;
  api.entries.mockResolvedValue({ items: [entry()] });
  api.addEntry.mockResolvedValue({
    items: [entry(), entry({ id: "entry-2" })],
  });
});

describe("a munkalap munkanaplója a weben", () => {
  it("a MEZŐ a gombra nyílik, nem áll ott mindig", async () => {
    /*
      Balazs igy kerte, es van oka: egy allando szovegdoboz minden lapon ott
      allna, es a lap tobbi reszet nyomna el.

      MI PIROSIT: ha a szovegmezo feltetel nelkul rendezodne ki.
    */
    render(<WorksheetEntries worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/Szivattyú csere/));
    expect(screen.queryByLabelText("Mit csináltál")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bejegyzés" }));
    expect(screen.getByLabelText("Mit csináltál")).toBeTruthy();
  });

  it("a CSUPA SZÓKÖZ nem megy el a szerverre", async () => {
    /*
      Egy ures bejegyzes sort foglalna a listan, szerzot es idopontot kapna, es
      ugy nezne ki, mintha valaki dolgozott volna. A szerver ugyanigy szur -- ha
      itt atengednenk, a felhasznalo egy technikai hibauzenetet latna a sajat
      ures mezoje helyett.

      MI PIROSIT: a levagas elhagyasa. A `toHaveBeenCalledTimes(0)` az allitas
      lenyege: nem az, hogy hibat mutatunk, hanem hogy a keres EL SEM MEGY.
    */
    render(<WorksheetEntries worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/Szivattyú csere/));
    fireEvent.click(screen.getByRole("button", { name: "Bejegyzés" }));
    fireEvent.change(screen.getByLabelText("Mit csináltál"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rögzítés" }));
    await waitFor(() => screen.getByText("Írd le, mit csináltál."));
    expect(api.addEntry).toHaveBeenCalledTimes(0);
  });

  it("a RÖGZÍTÉS a LEVÁGOTT szöveget küldi, és bezárja a mezőt", async () => {
    render(<WorksheetEntries worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/Szivattyú csere/));
    fireEvent.click(screen.getByRole("button", { name: "Bejegyzés" }));
    fireEvent.change(screen.getByLabelText("Mit csináltál"), {
      target: { value: "  Új bejegyzés  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rögzítés" }));
    await waitFor(() =>
      expect(api.addEntry).toHaveBeenCalledWith(
        "token-1",
        "w-1",
        "Új bejegyzés",
      ),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Mit csináltál")).toBeNull(),
    );
  });

  it("aki NEM írhat, gombot sem lát", async () => {
    /*
      TESTVER-KONTROLL: egy valtozat, ami a gombot feltetel nelkul kirajzolja, a
      fenti allitasokon atmenne -- es a felulet olyat igerne, amit a szerver
      utana elutasit.
    */
    render(<WorksheetEntries worksheetId="w-1" canWrite={false} />);
    await waitFor(() => screen.getByText(/Szivattyú csere/));
    expect(screen.queryByRole("button", { name: "Bejegyzés" })).toBeNull();
  });

  it("az ISMERETLEN szerzőt KIMONDJA, nem hagyja üresen", async () => {
    /*
      A szerzo azonositoja a szerveren `SetNull` a torleskor: a bejegyzes
      megmarad, a nev nelkul. Egy ures hely a nev helyen betoltesi hibanak
      latszik.
    */
    api.entries.mockResolvedValue({ items: [entry({ authorName: null })] });
    render(<WorksheetEntries worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/Ismeretlen szerző/));
  });

  it("az ÜRES lista MÁST mond annak, aki írhat, és annak, aki nem", async () => {
    /*
      Egy "a Bejegyzes gombbal irhatod le" mondat ott, ahol nincs gomb,
      ugy nez ki, mint hiba a programban.

      MI PIROSIT: kozos szoveg a ket agra.
    */
    api.entries.mockResolvedValue({ items: [] });
    const { unmount } = render(<WorksheetEntries worksheetId="w-1" canWrite />);
    await waitFor(() => screen.getByText(/A Bejegyzés gombbal/));
    unmount();
    render(<WorksheetEntries worksheetId="w-1" canWrite={false} />);
    await waitFor(() => screen.getByText(/a lapon dolgozó kollégák írják/));
  });
  /**
   * A TERMELESI MUNKAMENET ALAKJA: NINCS KLIENS OLDALON OLVASHATO TOKEN.
   *
   * MI PIROSIT: ha a kapu visszakerul a `!token` alakra. Ez a hiba eles
   * kornyezetben MINDIG fennall es fejlesztoiben SOHA -- a helyi futas tehat
   * magatol nem cafolja. Balazs 2026-09-18-an jelentette: a mentett bejegyzes
   * frissites utan eltunik.
   *
   * AZ ALLITAS A HIVAST MERI, NEM A KEPERNYOT: a `!token` kapu mellett a
   * lekerdezes EL SEM INDUL, es egy kepernyo-allitas (ures lista) MAS okbol
   * is zold lehetne.
   */
  it("URES TOKENU munkamenettel is elindul a lekerdezes (httpOnly sütis alak)", async () => {
    auth.session = { ...session, token: undefined };
    /*
      A MOCKOT ITT KELL NULLAZNI, ES EZ NEM FORMASAG. A `beforeEach` csak a
      visszateresi erteket allitja be, a hivas-listat nem -- vagyis a
      `mock.calls` a KORABBI tesztek hivasait is tartalmazza. Enelkul a lenti
      ket allitas AKKOR IS ZOLD, ha ez a rendereles egyaltalan nem hiv semmit:
      egy allitas, ami nem tud elbukni.
    */
    api.entries.mockClear();
    render(<WorksheetEntries worksheetId="w-1" canWrite />);
    await waitFor(() => expect(api.entries).toHaveBeenCalled());
    /*
      A TOKEN URESEN, DE ATADVA megy tovabb: az apiRequest-ben dol el, hogy
      Bearer fejlec megy-e vagy a suti. Ha itt `undefined` allna, az MAS hiba
      lenne -- es a fenti allitas ettol meg zold maradna.
    */
    expect(api.entries.mock.lastCall?.[0]).toBe("");
  });
});
