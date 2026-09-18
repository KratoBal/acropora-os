import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session, WorksheetEntryDetail } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
import { WorksheetEntryPage } from "./worksheet-entry-page";

const api = vi.hoisted(() => ({ entries: vi.fn(), updateEntry: vi.fn() }));
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
  api.updateEntry.mockResolvedValue({ items: [entry({ body: "Javított" })] });
});

describe("egy bejegyzés saját lapja", () => {
  it("FELÜL van vissza gomb a munkalapra", async () => {
    /*
      Balazs kifejezetten ezt kerte, es a bongeszo sajat visszalepese nem
      helyettesiti: aki kozvetlen linkbol erkezik, annak nincs hova
      visszalepnie.
    */
    render(<WorksheetEntryPage worksheetId="w-1" entryId="entry-1" />);
    const vissza = await screen.findByRole("link", {
      name: /Vissza a munkalapra/,
    });
    expect(vissza.getAttribute("href")).toBe("/szerviz/munkalapok/w-1");
  });

  it("a SZERKESZTÉS a szerver válaszából engedélyezett, nem saját számolásból", async () => {
    /*
      EZ A LEGFONTOSABB ALLITAS. A szabaly (a lap keszitoje vagy a hibajegy
      letrehozoja) JOGOSULTSAGI szabaly, es a szerver a kerest is elutasitja. Ha
      a felulet ujraszamolna, ket masolat allna ugyanarra.

      MI PIROSIT: barmilyen sajat feltetel a `canEdit` helyett.
    */
    render(<WorksheetEntryPage worksheetId="w-1" entryId="entry-1" />);
    await waitFor(() => screen.getByText("Szivattyú csere"));
    fireEvent.click(screen.getByRole("button", { name: "Szerkesztem" }));
    fireEvent.change(screen.getByLabelText("A bejegyzés szövege"), {
      target: { value: "  Javított  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rögzítés" }));
    await waitFor(() =>
      expect(api.updateEntry).toHaveBeenCalledWith(
        "token-1",
        "w-1",
        "entry-1",
        "Javított",
      ),
    );
  });

  it("aki NEM szerkesztheti, INDOKLÁST lát a gomb helyén", async () => {
    /*
      Egy magyarazat nelkul hianyzo gomb ugy nez ki, mint hiba a programban -- es
      ket kulon eset van (van kit megkerni, vagy senki nem szerkesztheti). A
      mondat a SZERVERTOL jon, hogy a ket felulet ugyanazt mondja.

      MI PIROSIT: az `editRefusal` kirajzolasanak elhagyasa.
    */
    api.entries.mockResolvedValue({
      items: [
        entry({
          canEdit: false,
          editRefusal:
            "Ezt a bejegyzést a munkalap készítője tudja szerkeszteni.",
        }),
      ],
    });
    render(<WorksheetEntryPage worksheetId="w-1" entryId="entry-1" />);
    await waitFor(() =>
      screen.getByText(/a munkalap készítője tudja szerkeszteni/),
    );
    expect(screen.queryByRole("button", { name: "Szerkesztem" })).toBeNull();
  });

  it("a HIÁNYZÓ bejegyzést KIMONDJA, nem üres lappal", async () => {
    /*
      Ha a lista betoltodott es a sor nincs benne, az ures lap ugy nezne ki,
      mintha nem tortent volna semmi -- pedig vagy megszunt, vagy rossz
      azonositoval nyilt meg.
    */
    api.entries.mockResolvedValue({ items: [] });
    render(<WorksheetEntryPage worksheetId="w-1" entryId="nincs" />);
    await waitFor(() => screen.getByText(/nem találjuk ezen a munkalapon/));
  });

  /**
   * A SAV A LAP ALLAPOTAROL BESZEL, NEM A KAPCSOLATROL -- ES A HELYES SZAM NEM
   * EGY, HANEM ANNYI, AHANY ALLAPOTBA A LAP BE TUD KERULNI.
   *
   * Ez a lap kettobe: `entries ? loaded : empty`. A ket allitas EGYUTT fogja
   * meg a rogzult valasztast -- kulon-kulon egyik sem. Egy lap, ami mindig
   * `loaded`-ot ad, a tipusellenorzesen ES az elso allitason is atmegy, es
   * hideg betolteskor azt mondana, hogy "a legutobb betoltott adatokat latod",
   * miközben a kepernyo ures.
   */
  it("kapcsolat nélkül, betöltött bejegyzésnél a frissítésről beszél", async () => {
    setOnLine(false);
    render(<WorksheetEntryPage worksheetId="w-1" entryId="entry-1" />);
    await screen.findByText("Szivattyú csere");

    expect(await savotMond("loaded")).toBeTruthy();
  });

  it("kapcsolat nélkül, üres képernyőn azt mondja, hogy ezért nincs adat", async () => {
    // SOHA NEM TELJESULO valasz: a lap a "meg semmi nem toltodott be"
    // allapotban marad, vagyis pont abban, amirol a masodik mondat szol.
    setOnLine(false);
    api.entries.mockReturnValue(new Promise(() => {}));
    render(<WorksheetEntryPage worksheetId="w-1" entryId="entry-1" />);

    expect(await savotMond("empty")).toBeTruthy();
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
    render(<WorksheetEntryPage worksheetId="w-1" entryId="entry-1" />);
    await waitFor(() => expect(api.entries).toHaveBeenCalled());
    /*
      A TOKEN URESEN, DE ATADVA megy tovabb: az apiRequest-ben dol el, hogy
      Bearer fejlec megy-e vagy a suti. Ha itt `undefined` allna, az MAS hiba
      lenne -- es a fenti allitas ettol meg zold maradna.
    */
    expect(api.entries.mock.lastCall?.[0]).toBe("");
  });
});

afterEach(() => setOnLine(true));
