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
