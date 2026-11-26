import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usersApi } from "@/lib/api/users";
import { UserEditorPage } from "./user-editor-page";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
vi.mock("@/components/navigation-history", () => ({
  useReturnTo: () => ({ href: "/admin/users", fromWithinApp: false }),
}));
vi.mock("@/lib/api/users", () => ({
  usersApi: { create: vi.fn(), detail: vi.fn(), update: vi.fn() },
}));
vi.mock("@acropora/types", () => ({
  PERMISSIONS: { USERS_MANAGE: "users.manage" },
  hasPermission: () => true,
  isNavigationEntryVisible: () => false,
  // a meglévő fiók betöltése (a jelenléti beosztás szakasz) hívja; az új fióknál ez az ág nem fut
  isAttendanceEmployeeRole: (role: string) => role === "STAFF",
  /*
    KEZZEL IRT TUKOR, NEM A VALODI LISTA -- ES EZ SZANDEKOS.

    A `vi.mock` teljesen lecseréli az `@acropora/types` modult, tehat ez a
    tömb NEM a `packages/types/src/notification-roles.ts` tartalma, hanem
    annak egy kézzel karbantartott másolata. Amíg a két oldal elemszáma és
    tartalma egyezik, a lenti tesztek a valós viselkedést mérik; ha
    elcsúsznak, a teszt NEM az igazi listát fedi, hanem a sajátját.

    MI TÖRIK EL, HA ELCSÚSZIK: ha egy elem KIMARAD innen, amit a lap
    ténylegesen olvas, "No export is defined" hibát kapunk a betöltéskor --
    ezt a negyedik elem hozzávétele találta meg elsőként. Ha viszont ELTÉR a
    TARTALMA (rossz felirat, rossz leírás, más sorrend), a teszt CSENDBEN
    fut le: a betöltés nem bukik, csak épp nem azt méri, amit a valódi
    listáról hinnénk.
  */
  NOTIFICATION_ROLES: [
    {
      value: "SERVICE_JOB_OPENED",
      label: "Hibajegy-felelős",
      description: "Push és e-mail értesítést kap.",
    },
    {
      value: "MATERIAL_REQUEST_CREATED",
      label: "Anyagigény-felelős",
      description: "Push és e-mail értesítést kap.",
    },
  ],
  /**
   * A PARJA, UGYANAZZAL A FIGYELMEZTETESSEL, MINT A FENTI TOMB -- ez is
   * KEZZEL KARBANTARTOTT MASOLAT, nem a valodi `service-capabilities.ts`.
   *
   * AZ `audience` MEZO 2026-09-25-TOL KOTELEZO A MOCKBAN IS: a komponens
   * ez alapjan szuri, melyik kepesseget mutassa. Ha ez a mock elmaradna
   * tole, egyik ag sem mutatna SEMMIT (az `undefined === "internal"` es
   * az `undefined === "partner"` egyarant hamis), es a lenti, MEGLEVO
   * tesztek csendben hamis eredmenyt adnanak.
   */
  SERVICE_CAPABILITIES: [
    {
      value: "MATERIAL_REQUEST_MARK_RECEIVED",
      label: "Anyag beérkezésének jelölése",
      description: "Megjelölheti, ha egy anyagigény beérkezett.",
      audience: "internal",
    },
    {
      value: "AQUARIUM_ASSET_ASSIGN",
      label: "Eszköz hozzárendelése akváriumhoz (partner portál)",
      description: "A partner portálon hozzárendelheti az eszközöket.",
      audience: "partner",
    },
  ],
}));
vi.mock("@/components/service-jobs/partner-picker", () => ({
  /**
   * A VALASZTO KET AGA KULON GOMB, es a masodik 2026-09-17-en kerult ide.
   *
   * Az `onClear` addig nem volt a duplaban -- ezert a torles utani allapotot
   * SEMMI nem merte, holott epp az allitott elo egy kotes nelkuli
   * `PARTNER_SERVICE` fiokot. Amit a hivo hasznal, de a teszt-dupla nem ad
   * vissza, az a dupla biztos hibaja.
   */
  PartnerPicker: ({
    onPick,
    onClear,
  }: {
    onPick: (partner: { customerId: string }) => void;
    onClear: () => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onPick({ customerId: "customer-1" })}
      >
        Vevő kiválasztása
      </button>
      <button type="button" onClick={() => onClear()}>
        Vevő törlése
      </button>
    </>
  ),
}));
// a jog-táblázatnak saját tesztje van (`user-permission-table.component.test.tsx`);
// itt a közös csomag részleges dublőre mellett nem töltődhet be
// a dupla SAJÁT állapotot tart (mint a valódi táblázat): ezen látszik, ha egy fülváltás lecsatolja a szakaszt
vi.mock("./user-permission-table", async () => {
  const { useState } = await import("react");
  function UserPermissionTable() {
    const [draft, setDraft] = useState("");
    return (
      <>
        <input
          aria-label="Jog-vázlat"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button">Jogosultságok mentése</button>
      </>
    );
  }
  return { UserPermissionTable };
});
// a munkarendnek is saját tesztje van; itt csak az számít, melyik fülön áll a mentése
vi.mock("./user-attendance-schedule", () => ({
  UserAttendanceSchedule: () => (
    <button type="button">Munkarend mentése</button>
  ),
}));
vi.mock("./role-labels", () => ({
  ROLE_LABELS: {
    VIEWER: "Megtekintő",
    PARTNER_SERVICE: "Partner szerviz",
  },
  ROLE_OPTIONS: [
    { value: "VIEWER", label: "Megtekintő" },
    { value: "PARTNER_SERVICE", label: "Partner szerviz" },
  ],
}));

const session: Session = {
  id: "session-1",
  token: "token-1",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner-1",
    email: "owner@acropora.local",
    displayName: "Tulajdonos",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

describe("UserEditorPage partner szerepköre", () => {
  beforeEach(() => {
    auth.session = session;
    router.push.mockReset();
  });

  /**
   * AZ ERTESITESI JELOLONEGYZET CSAK SAJAT KOLLEGANAL LATSZIK.
   *
   * Balazs kerese, 2026-09-22: „a sajat felhasznaloinkhoz kell egy checkbox".
   *
   * MI PIROSIT: ha a doboz feltetel NELKUL kerul a lapra. Akkor egy
   * partner-fioknal is be lehetne jelolni, es a vevo ertesitest kapna MINDEN
   * MASIK vevo bejelenteserol -- csendes adatszivargas, amit semmi nem jelez.
   *
   * A SORREND A LENYEG: eloszor MEGVAN (sajat kollega, vevo nelkul), aztan
   * vevot valasztunk, es akkor ELTUNIK. Az elso fele nelkul a masodik egy
   * olyan lapon is zold lenne, ahol a doboz SOHA nem jelenik meg.
   */
  it("az értesítési jelölőnégyzet csak saját kollégánál jelenik meg", async () => {
    render(<UserEditorPage />);

    expect(
      screen.getByRole("checkbox", { name: /Hibajegy-felelős/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Vevő kiválasztása" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("checkbox", { name: /Hibajegy-felelős/ }),
      ).toBeNull(),
    );
  });

  /**
   * A KET SZEREP EGYMASTOL FUGGETLENUL JELOLHETO.
   *
   * MI PIROSIT: ha a `notificationRoles` allapot egyetlen erteket tartana
   * tobb helyett (pl. felulirna a masikat), vagy ha a ket jelolonegyzet
   * ugyanarra a mezore lenne kotve. Az elozo teszt csak azt merte, hogy A
   * LAP BETOLTODIK a mai ketelemu listaval -- ez azt, hogy a ketto tenyleg
   * KULON allapot.
   */
  it("a két értesítési szerep egymástól függetlenül kapcsolható", async () => {
    render(<UserEditorPage />);

    const hibajegy = screen.getByRole("checkbox", {
      name: /Hibajegy-felelős/,
    }) as HTMLInputElement;
    const anyagigeny = screen.getByRole("checkbox", {
      name: /Anyagigény-felelős/,
    }) as HTMLInputElement;

    expect(hibajegy.checked).toBe(false);
    expect(anyagigeny.checked).toBe(false);

    fireEvent.click(hibajegy);
    expect(hibajegy.checked).toBe(true);
    expect(anyagigeny.checked).toBe(false);

    fireEvent.click(anyagigeny);
    expect(hibajegy.checked).toBe(true);
    expect(anyagigeny.checked).toBe(true);

    fireEvent.click(hibajegy);
    expect(hibajegy.checked).toBe(false);
    expect(anyagigeny.checked).toBe(true);
  });

  /**
   * A "BELSŐS" KÉPESSÉG (`audience: "internal"`) CSAK SAJÁT KOLLÉGÁNÁL
   * JELENIK MEG -- ugyanaz az ok, mint az értesítéseknél (a szolgáltatás a
   * MI oldalunk munkája, egy partner-fióknál bejelölve MINDEN vevő
   * anyagigényét láthatóvá tenné).
   *
   * EZ A TESZT KORÁBBAN "a képesség jelölőnegyzet" ÁLTALÁNOS ALAKBAN ÁLLT
   * -- 2026-09-25-től a "Képességek" szakasz MÁR NEM EGYETLEN határt visel
   * (lásd `service-capabilities.ts` `audience` mezőjét): az állítást ezért
   * az `audience: "internal"` ELEMRE szűkítve mondjuk ki, a lenti, partner-
   * ágú kontrollal együtt.
   */
  it("a belsős képesség (audience: internal) csak saját kollégánál jelenik meg", async () => {
    render(<UserEditorPage />);

    expect(
      screen.getByRole("checkbox", { name: /Anyag beérkezésének jelölése/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Vevő kiválasztása" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("checkbox", {
          name: /Anyag beérkezésének jelölése/,
        }),
      ).toBeNull(),
    );
  });

  /**
   * A FORDÍTOTT IRÁNY, ÚJ 2026-09-25-TŐL (emlék 1843, 1847): a
   * `AQUARIUM_ASSET_ASSIGN` (`audience: "partner"`) csak PARTNER-FIÓKNÁL
   * jelenik meg, sosem saját kollégánál -- ott a kockázat fordított, mint
   * az anyagigény-jelölésnél: egy internal kollégának bejelölve semmit nem
   * jelentene (ő úgyis `SERVICE_MANAGE`-en át mindent elér), de a jelenléte
   * félrevezetné a szerkesztőt.
   *
   * MI PIROSÍT: ha a "Képességek" szakasz visszatérne az EGYETLEN
   * `customerId === ""` ágra (a régi, most javított hiba), ez az állítás
   * SOSEM látná a jelölőnégyzetet, mert a teszt kezdetben belsős nézetben
   * indul.
   */
  it("a partner-képesség (audience: partner) csak partner-fióknál jelenik meg", async () => {
    render(<UserEditorPage />);

    expect(
      screen.queryByRole("checkbox", {
        name: /Eszköz hozzárendelése akváriumhoz/,
      }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Vevő kiválasztása" }));

    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: /Eszköz hozzárendelése akváriumhoz/,
        }),
      ).toBeInTheDocument(),
    );
  });

  /**
   * A KET KESZLET FUGGETLEN ALLAPOTBAN ALL -- Balazs kifejezett kerese
   * (2026-09-22 20:28:56 UTC, "Nem. Ket kulon jelolo legyen").
   *
   * MI PIROSIT: ha a kepesseg es az ertesitesi szerep UGYANAZT a tombot
   * mozgatna (pl. egy kozos allapotra lennenek kotve). Akkor az egyik
   * bejelolese a masikat is bejelolne, vagy a levetele elvinne a masikat is.
   */
  it("a képesség jelölése nem hat az értesítési szerepekre, és fordítva", async () => {
    render(<UserEditorPage />);

    const anyagigenyErtesules = screen.getByRole("checkbox", {
      name: /Anyagigény-felelős/,
    }) as HTMLInputElement;
    const beerkezesJelolese = screen.getByRole("checkbox", {
      name: /Anyag beérkezésének jelölése/,
    }) as HTMLInputElement;

    fireEvent.click(beerkezesJelolese);
    expect(beerkezesJelolese.checked).toBe(true);
    expect(anyagigenyErtesules.checked).toBe(false);

    fireEvent.click(anyagigenyErtesules);
    expect(beerkezesJelolese.checked).toBe(true);
    expect(anyagigenyErtesules.checked).toBe(true);

    fireEvent.click(beerkezesJelolese);
    expect(beerkezesJelolese.checked).toBe(false);
    expect(anyagigenyErtesules.checked).toBe(true);
  });

  it("vevő kiválasztásakor csak a Partner szerviz szerepet kínálja és megmagyarázza", async () => {
    render(<UserEditorPage />);

    fireEvent.click(screen.getByRole("button", { name: "Vevő kiválasztása" }));

    const role = screen.getByLabelText("Szerepkör") as HTMLSelectElement;
    await waitFor(() => expect(role.value).toBe("PARTNER_SERVICE"));
    expect(within(role).getAllByRole("option")).toHaveLength(1);
    expect(within(role).getByRole("option")).toHaveTextContent(
      "Partner szerviz",
    );
    expect(
      screen.getByText(/szándékosan csak Partner szerviz lehet/i),
    ).toBeInTheDocument();
  });

  /**
   * A PARTNER TORLESE A SZEREPET IS VISSZAVESZI.
   *
   * MI PIROSIT: a korabbi `onClear={() => setCustomerId("")}` alak. Az a vevot
   * vette vissza, a szerepet nem -- es az igy mentett fiok a LEGTAGABB, amit
   * letre lehet hozni: a `PARTNER_SERVICE` JOGAIT kapja, a HATOKORE viszont
   * belsos (a `partnerScopeOf` kotes hianyaban `internal`-t ad), tehat MINDEN
   * vevo szerviz-sorat latna.
   *
   * A SORREND A LENYEG: eloszor valasztunk, hogy a szerep tenyleg elmozduljon
   * -- kulonben a lenti allitas egy olyan kepernyon is zold lenne, ahol a
   * valasztas SEM allitja at a szerepet.
   */
  it("a vevő törlése a szerepkört is visszaveszi", async () => {
    render(<UserEditorPage />);
    const role = screen.getByLabelText("Szerepkör") as HTMLSelectElement;

    fireEvent.click(screen.getByRole("button", { name: "Vevő kiválasztása" }));
    await waitFor(() => expect(role.value).toBe("PARTNER_SERVICE"));

    fireEvent.click(screen.getByRole("button", { name: "Vevő törlése" }));

    await waitFor(() => expect(role.value).toBe("VIEWER"));
    // ES A VALASZTO UJRA A TELJES LISTAT KINALJA: a szerep tudatos dontes marad,
    // nem egy ottfelejtett ertek.
    expect(within(role).getAllByRole("option")).toHaveLength(2);
  });
});

/**
 * A GÉPI / FLOTTA FIÓK JELÖLŐ A SZERKESZTŐBEN (card b2e74712, acrobot 2026-11-25): eddig csak adatbázis-úton volt állítható. MI PIROSÍT: ha a
 * kapcsoló új fióknál vagy partner-fióknál is megjelenik (egy partner nem lehet gép, egy új fiók embernek indul); ha a bejelölés nem megy át a
 * mentésbe; ha egy bejelölt partner-fióknál a mentés mégis igazat küld; ha a betöltött érték nem a jelölőt mutatja.
 */
describe("UserEditorPage gépi fiók jelölő", () => {
  const detail = (over: Record<string, unknown> = {}) => ({
    id: "u1",
    firstName: "Acro",
    lastName: "Bot",
    displayName: "Acro Bot",
    nickname: null,
    email: "bot@acropora.local",
    role: "VIEWER",
    isActive: true,
    hasPassword: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-25T10:00:00.000Z",
    notificationRoles: [],
    serviceCapabilities: [],
    isServiceAccount: false,
    customerId: null,
    supplierId: null,
    ...over,
  });
  const toggle = () =>
    screen.getByRole("checkbox", {
      name: /Gépi \/ flotta fiók/,
    }) as HTMLInputElement;

  beforeEach(() => {
    auth.session = session;
    router.push.mockReset();
    vi.mocked(usersApi.detail).mockReset();
    vi.mocked(usersApi.update).mockReset();
  });

  it("egy új fióknál nincs kapcsoló", () => {
    render(<UserEditorPage />);
    expect(
      screen.queryByRole("checkbox", { name: /Gépi \/ flotta fiók/ }),
    ).toBeNull();
  });

  it("a betöltött jelölőt mutatja, és a bejelölés a mentésben elmegy", async () => {
    vi.mocked(usersApi.detail).mockResolvedValue(
      detail({ isServiceAccount: true }) as never,
    );
    vi.mocked(usersApi.update).mockResolvedValue(detail() as never);
    render(<UserEditorPage userId="u1" />);
    await waitFor(() => expect(toggle().checked).toBe(true));
    fireEvent.click(toggle());
    expect(toggle().checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Változások mentése/ }));
    await waitFor(() => expect(usersApi.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(usersApi.update).mock.calls[0]![2]).toMatchObject({
      isServiceAccount: false,
      expectedUpdatedAt: "2026-11-25T10:00:00.000Z",
    });
  });

  it("a bejelölés igazként megy, és egy partner-fióknál nincs kapcsoló, és a mentés hamisat küld", async () => {
    vi.mocked(usersApi.detail).mockResolvedValue(detail() as never);
    vi.mocked(usersApi.update).mockResolvedValue(detail() as never);
    const first = render(<UserEditorPage userId="u1" />);
    await waitFor(() => expect(toggle().checked).toBe(false));
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: /Változások mentése/ }));
    await waitFor(() => expect(usersApi.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(usersApi.update).mock.calls[0]![2]).toMatchObject({
      isServiceAccount: true,
    });
    first.unmount();

    vi.mocked(usersApi.update).mockClear();
    vi.mocked(usersApi.detail).mockResolvedValue(
      detail({
        customerId: "c1",
        role: "PARTNER_SERVICE",
        isServiceAccount: true,
      }) as never,
    );
    render(<UserEditorPage userId="u1" />);
    // wait until the partner account is really loaded (the save button exists then), THEN look for the switch
    const save = await screen.findByRole("button", {
      name: /Változások mentése/,
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Szerepkör") as HTMLSelectElement).value,
      ).toBe("PARTNER_SERVICE"),
    );
    expect(
      screen.queryByRole("checkbox", { name: /Gépi \/ flotta fiók/ }),
    ).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(usersApi.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(usersApi.update).mock.calls[0]![2]).toMatchObject({
      isServiceAccount: false,
    });
  });
});

describe("UserEditorPage új és meglévő fiók űrlapja (Picasso 3.20)", () => {
  const existing = {
    id: "u9",
    firstName: "Béla",
    lastName: "Nagy",
    displayName: "Nagy Béla",
    nickname: null,
    email: "bela@acropora.local",
    role: "VIEWER",
    isActive: true,
    hasPassword: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-25T10:00:00.000Z",
    notificationRoles: [],
    serviceCapabilities: [],
    isServiceAccount: false,
    customerId: null,
    supplierId: null,
  };

  beforeEach(() => {
    auth.session = session;
    router.push.mockReset();
    vi.mocked(usersApi.detail).mockReset();
  });

  it("új fióknál a gomb a létrehozást mondja, nem a változások mentését", () => {
    render(<UserEditorPage />);
    expect(
      screen.getByRole("button", { name: "Felhasználó létrehozása" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Változások mentése" }),
    ).toBeNull();
  });

  it("meglévő fióknál a gomb a változások mentését mondja", async () => {
    vi.mocked(usersApi.detail).mockResolvedValue(existing as never);
    render(<UserEditorPage userId="u9" />);
    expect(
      await screen.findByRole("button", { name: "Változások mentése" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Felhasználó létrehozása" }),
    ).toBeNull();
  });

  it("a kötelező mezők csillagot kapnak (a felolvasónak kötelező), a becenév nem kötelező; a jelszó is kötelező új fióknál", () => {
    render(<UserEditorPage />);
    for (const name of ["Vezetéknév", "Keresztnév", "E-mail cím", "Jelszó"]) {
      const label = screen.getByText(name, { selector: "label" });
      expect(label.textContent, name).toContain("*");
      expect(label.textContent, name).toContain("(kötelező)");
    }
    const nick = screen.getByText("Becenév", { selector: "label" });
    expect(nick.textContent).toContain("(nem kötelező)");
    expect(nick.textContent).not.toContain("*");
  });

  it("a jelszó az e-mail mellett áll, nem a lap végén", () => {
    render(<UserEditorPage />);
    const email = screen.getByLabelText("E-mail cím");
    const password = screen.getByLabelText("Jelszó");
    const role = screen.getByLabelText("Szerepkör");
    // dokumentum-sorrend: e-mail, jelszó, szerepkör
    expect(
      email.compareDocumentPosition(password) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      password.compareDocumentPosition(role) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("meglévő fióknál nincs jelszó mező az alapadatok között", async () => {
    vi.mocked(usersApi.detail).mockResolvedValue(existing as never);
    render(<UserEditorPage userId="u9" />);
    await screen.findByRole("button", { name: "Változások mentése" });
    expect(screen.queryByLabelText("Jelszó")).toBeNull();
  });

  it("a partner-kötés felirata érthető, és megmondja, mit jelent", () => {
    render(<UserEditorPage />);
    expect(screen.getByText("Partnerhez kötött fiók")).toBeTruthy();
    expect(
      screen.getByText(/csak annak a partnernek az adatait látja/),
    ).toBeTruthy();
    expect(screen.queryByText("Vevő nevében lép be")).toBeNull();
  });
});

/*
  A MEGLÉVŐ FELHASZNÁLÓ NÉGY FÜLÖN, FÜLENKÉNT EGY MENTÉSSEL (picasso leltár 3.23, acrobot 2026-11-26). MI PIROSÍT: egy fülön újra több mentés
  gomb látszik; a fülváltás elveszti a félbehagyott szerkesztést; a Munkarend fül olyan fióknál is ott áll, ahol a szakasz nem jelenik meg;
  egy új felhasználónál fülek jelennek meg.
*/
describe("UserEditorPage fülei", () => {
  const existing = (role: string) => ({
    id: "u1",
    firstName: "Anna",
    lastName: "Kiss",
    displayName: "Kiss Anna",
    nickname: null,
    email: "anna@acropora.local",
    role,
    isActive: true,
    hasPassword: true,
    createdAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-25T10:00:00.000Z",
    notificationRoles: [],
    serviceCapabilities: [],
    isServiceAccount: false,
    customerId: null,
    supplierId: null,
  });
  const saves = () =>
    screen
      .queryAllByRole("button", { name: /mentése$/ })
      .map((button) => button.textContent);

  beforeEach(() => {
    auth.session = session;
    vi.mocked(usersApi.detail).mockReset();
  });

  it("minden fülön egy mentés látszik, és csak az övé", async () => {
    vi.mocked(usersApi.detail).mockResolvedValue(existing("STAFF") as never);
    render(<UserEditorPage userId="u1" />);
    const tablist = await screen.findByRole("tablist", {
      name: "A felhasználó lapjai",
    });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Adatok", "Jogosultságok", "Munkarend", "Biztonság"]);
    expect(saves()).toEqual(["Változások mentése"]);
    for (const [name, save] of [
      ["Jogosultságok", "Jogosultságok mentése"],
      ["Munkarend", "Munkarend mentése"],
      ["Biztonság", "Jelszó mentése"],
    ] as const) {
      fireEvent.click(within(tablist).getByRole("tab", { name }));
      expect(saves()).toEqual([save]);
    }
  });

  it("a fülváltás nem veszti el a félbehagyott szerkesztést (egy szakasz saját állapotát sem)", async () => {
    vi.mocked(usersApi.detail).mockResolvedValue(existing("VIEWER") as never);
    render(<UserEditorPage userId="u1" />);
    const tablist = await screen.findByRole("tablist");
    fireEvent.click(
      within(tablist).getByRole("tab", { name: "Jogosultságok" }),
    );
    fireEvent.change(screen.getByLabelText("Jog-vázlat"), {
      target: { value: "kezelés" },
    });
    fireEvent.click(within(tablist).getByRole("tab", { name: "Biztonság" }));
    fireEvent.click(
      within(tablist).getByRole("tab", { name: "Jogosultságok" }),
    );
    expect(
      (screen.getByLabelText("Jog-vázlat") as HTMLInputElement).value,
    ).toBe("kezelés");
  });

  it("név nélküli fióknál a cím az e-mail, nem üres", async () => {
    vi.mocked(usersApi.detail).mockResolvedValue({
      ...existing("VIEWER"),
      firstName: "",
      lastName: "",
      displayName: "",
      email: "flotta-smoke@acropora.local",
    } as never);
    render(<UserEditorPage userId="u1" />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "flotta-smoke@acropora.local",
      }),
    ).toBeInTheDocument();
  });

  it("a Munkarend fül csak ott áll, ahol a szakasz megjelenne, és egy új felhasználónál nincs fül", async () => {
    vi.mocked(usersApi.detail).mockResolvedValue(existing("VIEWER") as never);
    const first = render(<UserEditorPage userId="u1" />);
    const tablist = await screen.findByRole("tablist");
    expect(
      within(tablist).queryByRole("tab", { name: "Munkarend" }),
    ).toBeNull();
    first.unmount();

    render(<UserEditorPage />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Felhasználó létrehozása" }),
    ).toBeInTheDocument();
  });
});
