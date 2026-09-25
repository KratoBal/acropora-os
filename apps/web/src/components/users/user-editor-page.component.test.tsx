import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Session } from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
