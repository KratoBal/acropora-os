import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ServiceJobListResponse, Session } from "@acropora/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  savotMond,
  setOnLine,
} from "@/components/service/service-offline-notice.testing";
import { urlNavigation } from "@/test/url-navigation";

import {
  MAINTENANCE_JOB_COLUMNS,
  MAINTENANCE_JOB_TABLE_MIN_WIDTH,
  ServiceJobListPage,
} from "./service-job-list-page";

const api = vi.hoisted(() => ({ list: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock(
  "next/navigation",
  async () => (await import("@/test/url-navigation")).nextNavigationModule,
);
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
    urlNavigation.reset("/szerviz/karbantartas");
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

  /*
    A KARBANTARTÁS-LISTA SORA MINDIG A KARBANTARTÁSI LAPOT NYITJA (Luca, 2026-11-18 14:43:46 UTC, acrobot 55968: „a karbantartási lapra kattintva ne a munkalapra vigyen, hanem magára
    a lapra”; ez felváltja az 55781-es megoldást, ahol az egyetlen munkalapos sor a munkalapot nyitotta). MI PIROSÍT: ha a sor a hibajegy-adatlapra visz; ha az egyetlen
    munkalapos sor a munkalapot nyitja a lap helyett.
  */
  it("a sor mindig a karbantartási lapot nyitja (egy, több és nulla munkalapnál is), soha a munkalapot vagy a hibajegyet", async () => {
    const base = response().items[0]!;
    api.list.mockResolvedValue(
      response({
        items: [
          {
            ...base,
            id: "job-1",
            title: "Egy munkalapos karbantartás",
            kind: "MAINTENANCE",
            worksheetCount: 1,
          },
          {
            ...base,
            id: "job-2",
            title: "Két munkalapos karbantartás",
            kind: "MAINTENANCE",
            worksheetCount: 2,
          },
          {
            ...base,
            id: "job-3",
            title: "Munkalap nélküli karbantartás",
            kind: "MAINTENANCE",
            worksheetCount: 0,
          },
        ],
      }),
    );
    render(<ServiceJobListPage />);
    const href = async (name: string) =>
      (await screen.findByRole("link", { name })).getAttribute("href");
    expect(await href("Egy munkalapos karbantartás")).toBe(
      "/szerviz/karbantartas/job-1",
    );
    expect(await href("Két munkalapos karbantartás")).toBe(
      "/szerviz/karbantartas/job-2",
    );
    expect(await href("Munkalap nélküli karbantartás")).toBe(
      "/szerviz/karbantartas/job-3",
    );
    for (const link of screen.getAllByRole("link"))
      expect(link.getAttribute("href")).not.toMatch(/hibajegyek\/job-/);
  });

  /*
    A KARBANTARTÁS-LISTA SORA IS NYIT (Luca, 2026-11-19; nautilus OS hibakör): eddig csak a cím-link vitt a lapra, a hibajegy- és a munkalap-lista
    sora viszont nyit. MI PIROSÍT: ha a sor kattintása nem a karbantartási lapra visz (egy, több és nulla munkalapnál is); ha a cím-link kattintása
    a sort is aktiválja (kétszeri lépés a lapra, a buborékozó kattintás miatt); ha a billentyűzet (a sorra fókuszálva Enter) nem nyit; ha a
    link Entere a SORT nyitja a link helyett; ha a sornak nincs megnyitás-felirata (a képernyőolvasó nem tudja, mit nyit).
  */
  it("a sorra kattintva a karbantartási lap nyílik (egy, több és nulla munkalapnál is), soha a munkalap vagy a hibajegy", async () => {
    const base = response().items[0]!;
    api.list.mockResolvedValue(
      response({
        items: [
          {
            ...base,
            id: "job-1",
            title: "Egy munkalapos",
            kind: "MAINTENANCE",
            worksheetCount: 1,
          },
          {
            ...base,
            id: "job-2",
            title: "Két munkalapos",
            kind: "MAINTENANCE",
            worksheetCount: 2,
          },
          {
            ...base,
            id: "job-3",
            title: "Munkalap nélküli",
            kind: "MAINTENANCE",
            worksheetCount: 0,
          },
        ],
      }),
    );
    render(<ServiceJobListPage kind="MAINTENANCE" />);
    const rows = await screen.findAllByTestId("maintenance-job-row");
    expect(rows).toHaveLength(3);
    for (const [index, id] of ["job-1", "job-2", "job-3"].entries()) {
      urlNavigation.push.mockClear();
      // a click on a plain cell (the partner column), not on the title link
      fireEvent.click(rows[index]!.querySelectorAll("td")[1]!);
      expect(urlNavigation.push).toHaveBeenCalledTimes(1);
      expect(urlNavigation.push).toHaveBeenCalledWith(
        `/szerviz/karbantartas/${id}`,
      );
    }
  });

  it("a cím-link kattintása nem aktiválja a sort is (a link maga visz a lapra, egyszer)", async () => {
    api.list.mockResolvedValue(
      response({
        items: [
          {
            ...response().items[0]!,
            id: "job-1",
            title: "Linkes cím",
            kind: "MAINTENANCE",
          },
        ],
      }),
    );
    render(<ServiceJobListPage kind="MAINTENANCE" />);
    const link = await screen.findByRole("link", { name: "Linkes cím" });
    urlNavigation.push.mockClear();
    fireEvent.click(link);
    expect(urlNavigation.push).not.toHaveBeenCalled();
  });

  it("a billentyűzettel is nyit: a sorra fókuszálva Enter, a linken álló Enter viszont a linké, nem a soré", async () => {
    api.list.mockResolvedValue(
      response({
        items: [
          {
            ...response().items[0]!,
            id: "job-1",
            title: "Billentyűs sor",
            kind: "MAINTENANCE",
          },
        ],
      }),
    );
    render(<ServiceJobListPage kind="MAINTENANCE" />);
    const row = (await screen.findAllByTestId("maintenance-job-row"))[0]!;
    urlNavigation.push.mockClear();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(urlNavigation.push).toHaveBeenCalledWith(
      "/szerviz/karbantartas/job-1",
    );
    urlNavigation.push.mockClear();
    fireEvent.keyDown(screen.getByRole("link", { name: "Billentyűs sor" }), {
      key: "Enter",
    });
    expect(urlNavigation.push).not.toHaveBeenCalled();
  });

  it("a sor megnyitás-feliratot visel: sorszám, cím, megnyitása", async () => {
    api.list.mockResolvedValue(
      response({
        items: [
          {
            ...response().items[0]!,
            id: "job-1",
            jobNumber: "KT-2026-007",
            title: "Feliratos sor",
            kind: "MAINTENANCE",
          },
        ],
      }),
    );
    render(<ServiceJobListPage kind="MAINTENANCE" />);
    const row = (await screen.findAllByTestId("maintenance-job-row"))[0]!;
    expect(row.getAttribute("aria-label")).toBe(
      "KT-2026-007 Feliratos sor megnyitása",
    );
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  /*
    A KARBANTARTÁS-LISTA NEM MUTAT HIBAJEGY-ÁLLAPOTOT (Balázs, 2026-11-18 11:31; acrobot 55782): az állapot a munkalapok aláírásából jön
    (minden aláírva = Kész, különben Folyamatban), nincs partner-állapot sor, és nincs hibajegy-állapot szerinti csempe vagy fül. MI PIROSÍT:
    ha a sor a hibajegy állapotát (Alkatrészre vár) vagy a partner-állapotot mutatja; ha a Kész/Folyamatban felcserélődik; ha a hibajegy-állapot szerinti csempék a karbantartási listán megjelennek (a fülek külön, későbbi
    kör: a szűrő a szerveren a hibajegy-állapoton áll).
  */
  /*
    A KÖZÖS SZAVAK (kártya 7f23785c, picasso 9. pont): Lezárt, mellette „minden munkalap aláírva", különben Folyamatban. Az első sor a
    szerver `commonStatus`-át viszi, és SZÁNDÉKOSAN ellentmond a régi `maintenanceDone`-nak: ha a cella a régi mezőt olvasná,
    Folyamatbant írna. A második és a harmadik sor régi válasz (nincs `commonStatus`): ott a `maintenanceDone` dönt, ugyanazzal a szóval.
  */
  it("az állapot a szerver közös állapota (Lezárt / Folyamatban), nincs hibajegy-állapot és csempe", async () => {
    const base = response().items[0]!;
    api.list.mockResolvedValue(
      response({
        items: [
          {
            ...base,
            id: "job-1",
            title: "Aláírt karbantartás",
            kind: "MAINTENANCE",
            maintenanceDone: false,
            commonStatus: "CLOSED",
            commonReason: null,
          },
          {
            ...base,
            id: "job-2",
            title: "Folyamatban lévő karbantartás",
            kind: "MAINTENANCE",
            maintenanceDone: false,
          },
          {
            ...base,
            id: "job-3",
            title: "Régi válasz, aláírt",
            kind: "MAINTENANCE",
            maintenanceDone: true,
          },
        ],
      }),
    );
    // a két sor együtt az "Összes" fülön áll: az alapértelmezett "Folyamatban" fül a kész lapot nem mutatja (acrobot 56182)
    urlNavigation.reset("/szerviz/karbantartas", "tab=all");
    render(<ServiceJobListPage kind="MAINTENANCE" />);
    await screen.findAllByTestId("maintenance-job-row");
    const rows = screen.getAllByTestId("maintenance-job-row");
    const statusOf = (row: HTMLElement) =>
      row.querySelector("td[data-label='Állapot']")?.textContent;
    expect(statusOf(rows[0]!)).toBe("Lezártminden munkalap aláírva");
    expect(statusOf(rows[1]!)).toBe("Folyamatban");
    expect(statusOf(rows[2]!)).toBe("Lezártminden munkalap aláírva");
    expect(screen.queryByText(/A partner ezt látja/)).toBeNull();
    expect(screen.queryByText("Alkatrészre vár")).toBeNull();
    expect(
      screen.queryByLabelText("Karbantartások állapot szerint"),
    ).toBeNull();
  });

  // A lista a közös tábla: telefonon minden sor kártya, a cellák a saját oszlopuk feliratát viselik.
  it("minden cella a saját oszlopa feliratát viseli, és az oszlopok belefér a minimumba", async () => {
    render(<ServiceJobListPage />);
    await screen.findAllByTestId("maintenance-job-row");
    const row = screen.getAllByTestId("maintenance-job-row")[0]!;
    expect(
      [...row.querySelectorAll("td")].map((td) =>
        td.getAttribute("data-label"),
      ),
    ).toEqual([
      "Karbantartási lap",
      "Partner",
      "Állapot",
      "Munkalap",
      "Létrehozva",
    ]);
    const sum = MAINTENANCE_JOB_COLUMNS.reduce(
      (acc, c) => acc + Number(/^(\d+)px$/.exec(c.width ?? "")?.[1]),
      0,
    );
    expect(sum).toBeLessThanOrEqual(MAINTENANCE_JOB_TABLE_MIN_WIDTH);
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

  /*
    A KARBANTARTÁSI LISTA A SAJÁT SZAVAIT HASZNÁLJA (acrobot 2. söprés, hibak-aa): az első csempe "Nyitott
    hibajegy" volt a karbantartási lapok listáján is. MI PIROSÍT: ha a karbantartási lista csempéje vagy üres
    üzenete újra "hibajegy", vagy a hibajegy-lista szavai megváltoznak.
  */
  it("a karbantartási lista nyitott csempéje és üres üzenete karbantartási lapot mond", async () => {
    api.list.mockResolvedValue(response({ items: [] }));
    render(<ServiceJobListPage kind="MAINTENANCE" />);

    expect(
      await screen.findByText(
        "Folyamatban lévő karbantartási lap jelenleg nincs. A készeket a fenti füleken nézheted meg.",
      ),
    ).toBeTruthy();
    // a hibajegy-állapot szerinti csempék a karbantartási listán nem jelennek meg (nincs állapotgép; Balázs, 2026-11-18)
    expect(screen.queryByText("Nyitott karbantartási lap")).toBeNull();
    expect(screen.queryByText("Nyitott hibajegy")).toBeNull();
  });

  /*
    A KARBANTARTÁS FÜLEI A JELVÉNY LOGIKÁJÁVAL (Balázs, 2026-11-18 11:31 UTC; acrobot 56182): Folyamatban / Kész / Összes, a
    `maintenanceDone` szerint; a hibajegy fülei (Nyitott, Várakozik, Lezárt) a karbantartáson nincsenek. A stage-bejárás lelete: a
    "Nyitott" fül alatt "Kész" jelvényű lap állt. MI PIROSÍT: ha a régi fülek jönnek vissza; ha a Kész fül alatt nem kész lap áll, vagy
    fordítva; ha a lista nem mindent kér (a fülek a kliensen szűrnek).
  */
  it("a karbantartás fülei Folyamatban, Lezárt, Összes, és a SZERVERTŐL kérik a jelvény szerinti szűrést", async () => {
    const base = response().items[0]!;
    const kesz = {
      ...base,
      id: "kt-kesz",
      jobNumber: "KT-2026-005",
      kind: "MAINTENANCE" as const,
      maintenanceDone: true,
    };
    const fut = {
      ...base,
      id: "kt-fut",
      jobNumber: "KT-2026-004",
      kind: "MAINTENANCE" as const,
      maintenanceDone: false,
    };
    // a szerver szűr (f4590db6): a hetedik argumentum a fül, a válasz annak megfelelő
    api.list.mockImplementation(async (...args: unknown[]) => {
      const state = args[6];
      return response({
        items:
          state === "done"
            ? [kesz]
            : state === "progress"
              ? [fut]
              : [kesz, fut],
        maintenanceCounts: { progress: 7, done: 12 },
      });
    });
    render(<ServiceJobListPage kind="MAINTENANCE" />);

    expect(await screen.findByText("KT-2026-004")).toBeTruthy();
    expect(screen.queryByText("KT-2026-005")).toBeNull();
    expect(screen.getByRole("tab", { name: "Folyamatban" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Nyitott" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Várakozik" })).toBeNull();
    // the maintenance's own three tabs; its done tab says Lezárt since card 7f23785c (it was Kész), the ticket tabs stay away
    expect(
      screen.getAllByRole("tab").map((tab) => tab.textContent?.trim()),
    ).toEqual(["Folyamatban", "Lezárt", "Összes"]);
    expect(api.list.mock.calls.at(-1)?.[1]).toBe("all");
    expect(api.list.mock.calls.at(-1)?.[6]).toBe("progress");
    // a lábléc a szerver számát mondja, nem a betöltött sorokét
    expect(await screen.findByText(/^7 találat/)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Lezárt" }));
    expect(await screen.findByText("KT-2026-005")).toBeTruthy();
    expect(screen.queryByText("KT-2026-004")).toBeNull();
    expect(api.list.mock.calls.at(-1)?.[6]).toBe("done");

    fireEvent.click(screen.getByRole("tab", { name: "Összes" }));
    expect(await screen.findByText("KT-2026-004")).toBeTruthy();
    expect(screen.getByText("KT-2026-005")).toBeTruthy();
    expect(api.list.mock.calls.at(-1)?.[6]).toBeUndefined();
  });

  it("a hibajegy-lista csempéje Nyitott hibajegy marad", async () => {
    api.list.mockResolvedValue(response({ items: [] }));
    render(<ServiceJobListPage />);

    expect(await screen.findByText("Nyitott hibajegy")).toBeTruthy();
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

/*
  A LISTA ÁLLAPOTA AZ URL-BEN (Balázs kérése, 2026-09-30): a jegyről
  visszalépve a Karbantartás ugyanazon a fülön, ugyanazzal a kereséssel áll.
  MI PIROSÍT: ha a fül, a keresés vagy a rejtettek kapcsolója megint helyi
  állapot lenne (az URL-t sem nem olvasná, sem nem írná).
*/
describe("ServiceJobListPage -- állapot az URL-ben", () => {
  beforeEach(() => {
    auth.session = session;
    api.list.mockReset().mockResolvedValue(response());
  });

  it("az URL füléből, kereséséből és rejtett-kapcsolójából indul", async () => {
    urlNavigation.reset("/szerviz/karbantartas", "tab=closed&q=pumpa&hidden=1");
    render(<ServiceJobListPage kind="MAINTENANCE" />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    const [, scope, , search, includeHidden] = api.list.mock.calls.at(-1)!;
    expect([scope, search, includeHidden]).toEqual(["all", "pumpa", true]);
    expect(
      (screen.getByLabelText("Karbantartás keresése") as HTMLInputElement)
        .value,
    ).toBe("pumpa");
  });

  it("a fülváltás és a keresés az URL-be íródik", async () => {
    urlNavigation.reset("/szerviz/karbantartas");
    render(<ServiceJobListPage kind="MAINTENANCE" />);
    await screen.findByText("Alkatrészre vár");

    // a karbantartás fülei: Folyamatban / Kész / Összes (acrobot 56182)
    fireEvent.click(screen.getByRole("tab", { name: "Lezárt" }));
    await waitFor(() => expect(urlNavigation.search).toBe("tab=done"));

    fireEvent.change(screen.getByLabelText("Karbantartás keresése"), {
      target: { value: "szűrő" },
    });
    await waitFor(() =>
      expect(new URLSearchParams(urlNavigation.search).get("q")).toBe("szűrő"),
    );
    expect(new URLSearchParams(urlNavigation.search).get("tab")).toBe("done");
  });
});

/*
  A KARBANTARTÁSI LISTA SZAVAI (hibajegy-maradek lista, acrobot 56117; Balázs 2026-11-18): a betöltés, a hiba és a jogosultság hiánya a karbantartási lapot nevezi meg, a hibajegy-lista a hibajegyet.
  MI PIROSÍT: ha a karbantartási listán újra "hibajegyek" áll ezekben a mondatokban; ha a hibajegy-lista mondatai megváltoznak.
*/
describe("ServiceJobListPage -- a lista szavai fajtánként", () => {
  beforeEach(() => {
    urlNavigation.reset("/szerviz/karbantartas");
    auth.session = session;
    api.list.mockReset();
  });

  it("betöltés közben a karbantartási lista a karbantartási lapokat nevezi meg", async () => {
    api.list.mockReturnValue(new Promise(() => undefined));
    render(<ServiceJobListPage kind="MAINTENANCE" />);
    expect(
      await screen.findByText("Karbantartási lapok betöltése..."),
    ).toBeTruthy();
    expect(screen.queryByText(/Hibajegyek betöltése/)).toBeNull();
  });

  it("a hibajegy-lista betöltése hibajegyet mond", async () => {
    api.list.mockReturnValue(new Promise(() => undefined));
    render(<ServiceJobListPage />);
    expect(await screen.findByText("Hibajegyek betöltése...")).toBeTruthy();
  });

  it("a betöltés hibája (nem Error) a fajta szerint szól", async () => {
    api.list.mockRejectedValue("nem megy");
    const { unmount } = render(<ServiceJobListPage kind="MAINTENANCE" />);
    expect(
      await screen.findByText("A karbantartási lapok nem tölthetők be."),
    ).toBeTruthy();
    unmount();
    render(<ServiceJobListPage />);
    expect(
      await screen.findByText("A hibajegyek nem tölthetők be."),
    ).toBeTruthy();
  });

  it("jogosultság nélkül a cím a fajta szerint szól", async () => {
    auth.session = null;
    const { unmount } = render(<ServiceJobListPage kind="MAINTENANCE" />);
    expect(
      screen.getByText("Nincs hozzáférésed a karbantartási lapokhoz"),
    ).toBeTruthy();
    unmount();
    render(<ServiceJobListPage />);
    expect(screen.getByText("Nincs hozzáférésed a hibajegyekhez")).toBeTruthy();
  });
});
