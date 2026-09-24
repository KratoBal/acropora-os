import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ServiceJobListResponse, Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
import { ServiceJobListPage } from "./service-job-list-page";

const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/lib/api/service-jobs", () => ({ serviceJobsApi: api }));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-sanyi",
    email: "sanyi@acropora.local",
    displayName: "Szerelő Sándor",
    nickname: "Sanyi",
    role: "SERVICE",
    customerId: null,
    supplierId: null,
  },
};

function response(
  overrides: Partial<ServiceJobListResponse> = {},
): ServiceJobListResponse {
  return {
    items: [
      {
        id: "job-1",
        jobNumber: "HJ-2026-001",
        title: "Cápasuli szivattyú leállt",
        kind: "REPAIR",
        // A BELSŐ és a LÁTSZÓ állapot szándékosan NEM ugyanaz ebben a
        // mintában: pont az a kérdés, hogy a lista mind a kettőt kiírja-e.
        status: "WAITING_FOR_PARTS",
        partnerStatus: "IN_PROGRESS",
        partnerStatusLabel: "Feldolgozás alatt",
        customerName: "Fővárosi Állat- És Növénykert",
        departmentPath: ["Biodóm", "Fókamedence", "Fóka nagymedence"],
        departmentCode: "FOK",
        assignees: [],
        worksheetCount: 2,
        createdAt: "2026-09-01T08:00:00.000Z",
        hidden: false,
      },
    ],
    /**
     * A SZÁMOK SZÁNDÉKOSAN NAGYOBBAK, MINT AMENNYI SOR JÖN.
     *
     * Egy sor érkezik, és a számlálók tizenhármat mondanak. Ha a felület a
     * betöltött lapból számolna, mindhárom doboz egyest vagy nullát mutatna -
     * vagyis ez a fixtúra megkülönbözteti a két számolást. Egyforma számokkal a
     * lapból számoló változat is zöld maradna.
     */
    counts: {
      NEW: 3,
      TRIAGED: 0,
      SCHEDULED: 1,
      IN_PROGRESS: 2,
      WAITING_FOR_PARTS: 1,
      WAITING_FOR_CUSTOMER: 2,
      COMPLETED: 3,
      CANCELLED: 1,
    },
    truncated: false,
    ...overrides,
  };
}

describe("ServiceJobListPage", () => {
  beforeEach(() => {
    auth.session = session;
    api.list.mockReset().mockResolvedValue(response());
  });

  /**
   * A KEZELŐNEK TUDNIA KELL, MIT OLVAS A MÁSIK FÉL. Ha csak a belső állapot
   * látszana, egy alkatrészre váró jegyről azt hinné, hogy a partner is ezt
   * látja - holott a partner „Feldolgozás alatt" szöveget kap.
   */
  it("a belső állapot mellett kiírja azt is, amit a partner lát", async () => {
    render(<ServiceJobListPage />);

    expect(await screen.findByText("Alkatrészre vár")).toBeTruthy();
    expect(
      screen.getByText("A partner ezt látja: Feldolgozás alatt"),
    ).toBeTruthy();
  });

  /**
   * A HELYSZIN TELJES UTJA A PARTNER ALA.
   *
   * EZ A LISTA EDDIG SEMMIT nem mondott a helyszinrol, csak a partnert. Ket
   * jegy ugyanannal a partnernel tehat megkulonboztethetetlen volt pont azon a
   * kepernyon, ahol valasztani kell kozuluk. Balazs 2026-09-16-an a
   * munkalap-listara kerte a teljes utat, es ugyanabban a mondatban ide is.
   */
  it("a partner alá kiírja a helyszín teljes útját", async () => {
    render(<ServiceJobListPage />);

    expect(
      await screen.findByText("Biodóm / Fókamedence / Fóka nagymedence"),
    ).toBeTruthy();
  });

  /**
   * A LEZÁRTAKAT A SZERVERTŐL KELL KÉRNI, NEM A BETÖLTÖTTBŐL KISZŰRNI.
   *
   * A `Nyitott` hatókör épp a lezártakat hagyja ki, tehát egy kliensoldali
   * szűrés ezen a fülön MINDIG üres listát adna - és az üres lista nem
   * hibaüzenet, hanem szabályos válasznak látszik.
   */
  it("a lezárt fül a teljes halmazt kéri a szervertől", async () => {
    render(<ServiceJobListPage />);
    await screen.findByText("Alkatrészre vár");
    expect(api.list.mock.calls.at(-1)?.[1]).toBe("open");

    fireEvent.click(screen.getByRole("tab", { name: "Lezárt" }));

    await waitFor(() => expect(api.list.mock.calls.at(-1)?.[1]).toBe("all"));
  });

  /**
   * ÉS A PÁRJA: A VÁRAKOZÓ FÜL NEM KÉR ÚJAT. A váró jegyek a nyitottak
   * részhalmaza, tehát a már betöltött válaszban benne állnak. Enélkül az előző
   * állítás egy olyan megvalósításnál is zöld lenne, ami minden fülváltásnál
   * újratölt - és a fülváltás lassabb lenne, mint a lista.
   */
  it("a várakozó fül nem tölt újra, mert a nyitottak között áll", async () => {
    render(<ServiceJobListPage />);
    await screen.findByText("Alkatrészre vár");
    const hivasok = api.list.mock.calls.length;

    fireEvent.click(screen.getByRole("tab", { name: "Várakozik" }));

    await screen.findByText("Alkatrészre vár");
    expect(api.list.mock.calls.length).toBe(hivasok);
  });

  /**
   * A HÁROM SZÁM A TELJES HALMAZBÓL JÖN, NEM A BETÖLTÖTT LAPBÓL.
   *
   * Egyetlen sor érkezik, és a dobozoknak mégis a számlálók összegét kell
   * mutatniuk. Ez a különbség a lényeg: egy lapból számoló felület ugyanígy
   * nézne ki, amíg a lista rövid, és csendben kezdene hazudni, amint hosszú.
   */
  it("a dobozok a szerver számlálóit mutatják, nem a sorok számát", async () => {
    render(<ServiceJobListPage />);
    await screen.findByText("Alkatrészre vár");

    // nyitott: 3 + 1 + 2 + 1 + 2 = 9, várakozó: 1 + 2 = 3, lezárt: 3 + 1 = 4
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  /**
   * A VÁGOTT LISTA NEM HALLGAT. A `truncated` a szervertől jön; ha a felület
   * elhallgatná, a kétszáz sor pontosan úgy nézne ki, mint a teljes lista.
   */
  it("vágott listánál kimondja, hogy van több", async () => {
    api.list.mockResolvedValue(response({ truncated: true }));
    render(<ServiceJobListPage />);

    expect(await screen.findByText(/van több/)).toBeTruthy();
  });

  it("üres listán megmondja, hogy a lezártak külön kérhetők", async () => {
    api.list.mockResolvedValue(response({ items: [] }));
    render(<ServiceJobListPage />);

    expect(
      await screen.findByText(
        "Nyitott hibajegy jelenleg nincs. A lezártakat a fenti füleken nézheted meg.",
      ),
    ).toBeTruthy();
  });

  /**
   * A SAV A LAP ALLAPOTAROL BESZEL, NEM A KAPCSOLATROL -- ES EZT KET ALLITAS
   * MERI, NEM EGY.
   *
   * A komponens tipusa CSAK azt kenyszeriti ki, hogy a lap VALASSZON a harom
   * mondat kozul; azt nem, hogy JOL valasszon. Egy lap, ami allandoan
   * `loaded`-ot ad, a tipusellenorzesen atmegy -- es hideg betolteskor azt
   * allitana, hogy "a legutobb betoltott adatokat latod", holott a kepernyo
   * ures. A ket allitas EGYUTT fogja meg: az egyik rogzul-`loaded`-re, a masik
   * rogzul-`empty`-re pirosodik.
   */
  it("kapcsolat nélkül, betöltött lista mellett a frissítésről beszél", async () => {
    setOnLine(false);
    render(<ServiceJobListPage />);
    await screen.findByText("Alkatrészre vár");

    expect(await savotMond("loaded")).toBeTruthy();
  });

  it("kapcsolat nélkül, üres képernyőn azt mondja, hogy ezért nincs adat", async () => {
    // SOHA NEM TELJESULO valasz: a lap a "meg semmi nem toltodott be"
    // allapotban marad, vagyis pont abban, amirol a masodik mondat szol.
    setOnLine(false);
    api.list.mockReturnValue(new Promise(() => {}));
    render(<ServiceJobListPage />);

    expect(await savotMond("empty")).toBeTruthy();
  });
});

/**
 * A KAPCSOLATOT VISSZA KELL ADNI, PEDIG A FAJL UTOLSO TESZTJEI OFFLINE FUTNAK.
 *
 * MERVE 2026-09-15: amikor ez a sor egy atalakitas kozben kiesett, a keszlet
 * ZOLD MARADT -- mert az offline tesztek eppen a fajl vegen allnak, tehat nem
 * fut utanuk semmi. A lyuk nem ma latszana, hanem annak, aki ide egy uj
 * tesztet ir: az halozat nelkuli vilagban indulna, es a pirosa nem arrol
 * szolna, amit megirt.
 */
afterEach(() => setOnLine(true));
