import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ServiceJobDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceJobDetailPage } from "./service-job-detail-page";

const api = vi.hoisted(() => ({
  detail: vi.fn(),
  move: vi.fn(),
  attachWorksheet: vi.fn(),
  detachWorksheet: vi.fn(),
  setPartner: vi.fn(),
}));
const sheets = vi.hoisted(() => ({ attachable: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));
vi.mock("@/lib/api/worksheets", () => ({ worksheetsApi: sheets }));

function sessionAs(role: Session["user"]["role"]): Session {
  return {
    id: "session-1",
    token: "token-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    user: {
      id: "user-sanyi",
      email: "sanyi@acropora.local",
      displayName: "Szerelő Sándor",
      nickname: "Sanyi",
      role,
      customerId: null,
      supplierId: null,
    },
  };
}

function detail(overrides: Partial<ServiceJobDetail> = {}): ServiceJobDetail {
  return {
    id: "job-1",
    jobNumber: "HJ-2026-001",
    title: "Cápasuli szivattyú leállt",
    description: "A hármas medence szivattyúja nem indul.",
    status: "TRIAGED",
    partnerStatus: "IN_PROGRESS",
    partnerStatusLabel: "Feldolgozás alatt",
    customerName: "Fővárosi Állat- És Növénykert",
    createdAt: "2026-09-01T08:00:00.000Z",
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    allowedSteps: ["SCHEDULED", "CANCELLED"],
    /**
     * A SORRENDET A SZERVER ADJA, ÉS EZ A MINTA SZÁNDÉKOSAN NEM DÁTUM SZERINT
     * ÁLL: ha a komponens újrarendezné, ez a sorrend megváltozna a képernyőn.
     * Így az állítás azt méri, hogy a kliens RAJZOL, nem dönt.
     */
    timeline: [
      {
        kind: "status",
        at: "2026-09-03T08:00:00.000Z",
        sortKey: "event-2",
        event: {
          id: "event-2",
          fromStatus: "NEW",
          toStatus: "TRIAGED",
          note: "Megnéztük, alkatrész kell hozzá.",
          actorName: "Szerelő Sándor",
          createdAt: "2026-09-03T08:00:00.000Z",
        },
      },
      {
        kind: "worksheet",
        at: "2026-09-02T08:00:00.000Z",
        sortKey: "worksheet-1",
        worksheet: {
          id: "worksheet-1",
          number: "BIO-2026-004",
          createdAt: "2026-09-02T08:00:00.000Z",
          handedOverAt: null,
        },
      },
      {
        kind: "status",
        at: "2026-09-01T08:00:00.000Z",
        sortKey: "event-1",
        event: {
          id: "event-1",
          fromStatus: null,
          toStatus: "NEW",
          note: null,
          actorName: "Szerelő Sándor",
          createdAt: "2026-09-01T08:00:00.000Z",
        },
      },
    ],
    ...overrides,
  };
}

describe("ServiceJobDetailPage", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.detail.mockReset().mockResolvedValue(detail());
    api.move.mockReset().mockResolvedValue({ ok: true });
    api.attachWorksheet.mockReset().mockResolvedValue({ ok: true });
    api.detachWorksheet.mockReset().mockResolvedValue({ ok: true });
    api.setPartner.mockReset().mockResolvedValue({ ok: true });
    sheets.attachable.mockReset().mockResolvedValue({
      items: [
        {
          id: "worksheet-9",
          number: null,
          subject: "Helyszínen felvett lap",
          status: "DRAFT",
          customerName: "Fővárosi Állat- És Növénykert",
          createdAt: "2026-08-30T08:00:00.000Z",
          handedOverAt: null,
        },
      ],
    });
  });

  /**
   * A SORREND A SZERVERÉ. A minta szándékosan a munkalapot teszi a két
   * állapotváltás közé; ha a komponens bármilyen saját rendezést végezne, ez a
   * sorrend megváltozna. Az összefésülés szabálya a szerveren áll, mert a
   * mobil nem éri el a közös csomagot, és ott újraíródna.
   */
  it("a szerver sorrendjét rajzolja ki, nem rendezi újra", async () => {
    render(<ServiceJobDetailPage jobId="job-1" />);

    // A NAPLÓ LISTÁJÁN BELÜL kérdezünk, nem az oldal összes listaelemén: a
    // munkalapok is listában állnak, és egy index-alapú állítás csendben
    // arra csúszna át.
    const log = await screen.findByRole("list", { name: "A hibajegy naplója" });
    const text = Array.from(log.querySelectorAll("li")).map(
      (row) => row.textContent ?? "",
    );
    expect(text[0]).toContain("Új → Felmérve");
    expect(text[1]).toContain("Munkalap a jegy alatt: BIO-2026-004");
    expect(text[2]).toContain("A hibajegy létrejött");
  });

  /**
   * A SZŰKÍTÉST MÉRŐ ÁLLÍTÁS, NÉV SZERINT.
   *
   * A `VIEWER` szerepnek van `service.view` joga, de nincs `service.manage`:
   * olvashatja a jegyet, lépnie viszont nem szabad. Enélkül az állítás-készlet
   * csak a megengedett esetet nézné, és akkor is zöld maradna, ha a gombsor
   * mindenkinek megjelenne.
   */
  it("olvasó jognál nem jelenik meg a lépés-gombsor", async () => {
    auth.session = sessionAs("VIEWER");
    render(<ServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("A hibajegy létrejött (Új).");

    expect(screen.queryByText("Következő lépés")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ütemezve" })).toBeNull();
  });

  /**
   * A LÉPÉS UTÁN ÚJRATÖLTÜNK. A `move` csak nyugtát ad; ha abból raknánk össze
   * a képernyőt, a napló új sora hiányozna róla.
   */
  it("lépés után újratölti a jegyet, nem a nyugtából épít", async () => {
    render(<ServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("A hibajegy létrejött (Új).");
    expect(api.detail).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Ütemezve" }));

    await waitFor(() => expect(api.move).toHaveBeenCalledTimes(1));
    expect(api.move.mock.calls[0]?.[2]).toEqual({ to: "SCHEDULED" });
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
  });

  /**
   * A FOLYAMAT MÁSODIK FELE: a lap előbb keletkezett, a jegy utólag, és a
   * felelős hozzáveszi a meglévő lapot.
   */
  it("meglévő munkalapot csatol, és utána újratölt", async () => {
    render(<ServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("A hibajegy létrejött (Új).");

    fireEvent.change(
      await screen.findByLabelText("Meglévő munkalap csatolása"),
      {
        target: { value: "worksheet-9" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Csatolás" }));

    await waitFor(() => expect(api.attachWorksheet).toHaveBeenCalledTimes(1));
    expect(api.attachWorksheet.mock.calls[0]?.[2]).toBe("worksheet-9");
    // A NYUGTÁBÓL NEM ÉPÍTÜNK: a csatolt lap a naplóban is megjelenik, azt
    // csak újratöltésből lehet látni.
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
  });

  /**
   * A VISSZAÚT, ÉS EZÉRT KÜLÖN ÁLLÍTÁS: a csatolás egy legördülőből választ,
   * sorszám nélküli lapok közül is. Enélkül egy rossz választás örökre ott
   * hagyná a lapot - a saját ütközés-őrzőnk még egy másik csatolással sem
   * engedné javítani.
   */
  it("a csatolt lapot le lehet választani, és utána újratölt", async () => {
    render(<ServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("A hibajegy létrejött (Új).");
    expect(api.detail).toHaveBeenCalledTimes(1);

    // A TORLES-ALAKU MUVELET ELOTT KERDEZUNK, es a kerdes a sajat
    // ConfirmDialog-unke: a bongeszo ablaka egy sorba zsufolna mindent.
    fireEvent.click(screen.getByRole("button", { name: "Leválasztás" }));
    expect(api.detachWorksheet).not.toHaveBeenCalled();

    // A PARBESZEDEN BELUL keressuk a megerositest: a sor gombja ugyanigy hivjak,
    // es egy index-alapu valasztas csendben a rossz gombra csuszna.
    const kerdes = screen.getByRole("dialog");
    fireEvent.click(
      within(kerdes).getByRole("button", { name: "Leválasztás" }),
    );

    await waitFor(() => expect(api.detachWorksheet).toHaveBeenCalledTimes(1));
    expect(api.detachWorksheet.mock.calls[0]?.[2]).toBe("worksheet-1");
    await waitFor(() => expect(api.detail).toHaveBeenCalledTimes(2));
  });

  /**
   * A SZŰKÍTÉST MÉRŐ ÁLLÍTÁS: olvasó jognál nincs csatolás, és a választó
   * listát le sem kérjük. A második fele külön számít - egy rejtett doboz
   * mögött lekért lista fölösleges kérés, és azt semmi nem mondaná meg.
   */
  it("olvasó jognál nincs csatoló doboz, és a listát sem kéri le", async () => {
    auth.session = sessionAs("VIEWER");
    render(<ServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("A hibajegy létrejött (Új).");

    expect(screen.queryByText("Meglévő munkalap csatolása")).toBeNull();
    expect(sheets.attachable).not.toHaveBeenCalled();
    // A VISSZAUT IS KEZELOI JOG: olvaso jognal a levalasztas gombja sem all ott.
    expect(screen.queryByRole("button", { name: "Leválasztás" })).toBeNull();
  });

  /**
   * A HIÁNY MELLETT A KIÚT. A partner nélküli jegy ma nem tud lapot fogadni;
   * enélkül a doboz nélkül ezt csak a csatolásnál tudná meg a felhasználó -
   * egy másik képernyőn, és kiút nélkül.
   */
  it("partner nélküli jegyen felkínálja a partner beállítását", async () => {
    api.detail.mockResolvedValue(detail({ customerName: null }));
    render(<ServiceJobDetailPage jobId="job-1" />);

    expect(await screen.findByText("Partner beállítása")).toBeTruthy();
    expect(
      screen.getByText(
        /Ehhez a hibajegyhez még nincs partner, ezért munkalapot sem lehet/,
      ),
    ).toBeTruthy();
  });

  /**
   * A SZŰKÍTÉST MÉRŐ ÁLLÍTÁS: akinek MÁR van partnere, annál a doboz NEM
   * jelenik meg. A partner cseréje átsorolás, arra ma nincs út - egy megjelenő
   * mező azt ígérné, hogy van.
   */
  it("partneres jegyen NEM kínálja fel a partner beállítását", async () => {
    render(<ServiceJobDetailPage jobId="job-1" />);
    await screen.findByText("A hibajegy létrejött (Új).");

    expect(screen.queryByText("Partner beállítása")).toBeNull();
  });

  /**
   * EGY ELTŰNT GOMBSOR ÚGY NÉZ KI, MINT EGY BETÖLTÉSI HIBA. A lezárt jegyen
   * ezért nem üres a doboz, hanem meg van mondva, miért nincs több lépés.
   */
  it("lezárt jegyen megmondja, hogy nincs több lépés", async () => {
    api.detail.mockResolvedValue(
      detail({ status: "CANCELLED", allowedSteps: [] }),
    );
    render(<ServiceJobDetailPage jobId="job-1" />);

    expect(
      await screen.findByText("Ez a hibajegy lezárult, nincs több lépése."),
    ).toBeTruthy();
  });
});
