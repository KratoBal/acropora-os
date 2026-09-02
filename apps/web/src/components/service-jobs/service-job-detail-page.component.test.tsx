import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ServiceJobDetail, Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceJobDetailPage } from "./service-job-detail-page";

const api = vi.hoisted(() => ({ detail: vi.fn(), move: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));

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
    allowedSteps: ["SCHEDULED", "CANCELLED"],
    events: [
      {
        id: "event-1",
        fromStatus: null,
        toStatus: "NEW",
        note: null,
        actorName: "Szerelő Sándor",
        createdAt: "2026-09-01T08:00:00.000Z",
      },
      {
        id: "event-2",
        fromStatus: "NEW",
        toStatus: "TRIAGED",
        note: "Megnéztük, alkatrész kell hozzá.",
        actorName: "Szerelő Sándor",
        createdAt: "2026-09-03T08:00:00.000Z",
      },
    ],
    worksheets: [
      {
        id: "worksheet-1",
        number: "BIO-2026-004",
        createdAt: "2026-09-02T08:00:00.000Z",
        handedOverAt: null,
      },
    ],
    assets: [],
    ...overrides,
  };
}

describe("ServiceJobDetailPage", () => {
  beforeEach(() => {
    auth.session = sessionAs("SERVICE");
    api.detail.mockReset().mockResolvedValue(detail());
    api.move.mockReset().mockResolvedValue({ ok: true });
  });

  /**
   * A NAPLÓ HÁROM FORRÁSBÓL ÁLL, ÉS EGY IDŐRENDBEN OLVASSUK.
   *
   * A minta úgy van összeállítva, hogy a munkalap a KÉT állapotváltás KÖZÉ
   * essen: forrásonként fűzve a sorrend más lenne, tehát ez az állítás azt
   * méri, hogy tényleg összefésülünk, nem csak kiírunk három listát.
   */
  it("a három forrást egy időrendbe fésüli, legújabb felül", async () => {
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
