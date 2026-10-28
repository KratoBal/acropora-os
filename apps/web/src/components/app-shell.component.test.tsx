import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  isNavigationEntryVisible,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Session,
} from "@acropora/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import { allNavigationPages } from "./navigation";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
const auth = vi.hoisted(() => ({ session: null as Session | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock("./auth/auth-provider", () => ({
  useAuth: () => ({ session: auth.session }),
}));
// az olvasatlan-szam lekerese: a teszt ne menjen halozatra
vi.mock("@/lib/api/messages", () => ({
  messagesApi: {
    unread: vi.fn().mockResolvedValue({ total: 0, conversations: 0 }),
  },
  MESSAGE_STREAM_URL: "/api/messages/stream",
}));
// the menu numbers (card 4a6813db): no network in a test
const counters = vi.hoisted(() => ({
  fetch: vi.fn(),
}));
vi.mock("@/lib/api/navigation-counters", () => ({
  navigationCountersApi: { counters: counters.fetch },
}));
// the favourites (Kedvencek): no network in a test
const favoritesApiMock = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue({ items: [] }),
  add: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/api/favorites", () => ({ favoritesApi: favoritesApiMock }));
vi.mock("./auth/user-menu", () => ({
  UserMenu: () => <div>Felhasználói menü</div>,
}));
const searchProps = vi.hoisted(() => ({ tokens: [] as string[] }));
vi.mock("./global-search", () => ({
  // The mock keeps the real control's role and name (type="search",
  // aria-label="Keresés"), so tests that locate the top bar through its
  // search box still find it. It records the token it was given.
  GlobalSearch: ({ token }: { token: string }) => {
    searchProps.tokens.push(token);
    return <input type="search" aria-label="Keresés" />;
  },
}));

const ownerSession: Session = {
  id: "owner-session",
  token: "owner-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: {
    id: "owner",
    email: "owner@acropora.local",
    displayName: "Owner",
    role: "OWNER",
    customerId: null,
    supplierId: null,
  },
};

describe("AppShell settings navigation", () => {
  beforeEach(() => {
    counters.fetch.mockReset().mockResolvedValue({
      "service-jobs": 0,
      worksheets: 0,
      "material-requests-pending": 0,
    });
    favoritesApiMock.list.mockReset().mockResolvedValue({ items: [] });
    auth.session = ownerSession;
    navigation.pathname = "/";
  });

  it("nests NAV and users below settings, and no longer UNAS or Medusa", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Beállítások" }));

    expect(screen.getByRole("link", { name: "NAV" })).toHaveAttribute(
      "href",
      "/admin/integrations/nav",
    );
    expect(screen.getByRole("link", { name: "Felhasználók" })).toHaveAttribute(
      "href",
      "/admin/users",
    );
    // 2026-10-26 (msg 1564263673932026020): the UNAS and Medusa settings live
    // on the Webshop beállítások page, not twice
    expect(screen.queryByRole("button", { name: "UNAS" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Medusa kapcsolat" }),
    ).not.toBeInTheDocument();
  });

  it("opens Webshop and marks the webshop settings on a UNAS settings page", () => {
    navigation.pathname = "/admin/integrations/unas/connection";

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.getByRole("button", { name: "Webshop" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("link", { name: "Webshop beállítások" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Beállítások" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("AppShell értesítési jelzés", () => {
  it("nem állít olvasatlan értesítést, amíg nincs annak adatforrása", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.queryByRole("button", { name: "Értesítések" })).toBeNull();
  });
});

describe("AppShell business navigation groups", () => {
  beforeEach(() => {
    auth.session = ownerSession;
    navigation.pathname = "/";
  });

  it("keeps a group's pages behind its heading until it is opened", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.queryByRole("link", { name: "UNAS Megrendelések" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Webshop" }));

    expect(
      screen.getByRole("link", { name: "UNAS Megrendelések" }),
    ).toHaveAttribute("href", "/webshop");
    expect(screen.getByRole("link", { name: "Vevők" })).toHaveAttribute(
      "href",
      "/vevok",
    );
    // a Márkák 2026-10-26 óta itt áll (a Kezdőlapot a szerver kapcsolója is
    // rejti, és ez a munkamenet nem hoz kiadott listát)
    expect(screen.getByRole("link", { name: "Márkák" })).toHaveAttribute(
      "href",
      "/admin/brands",
    );
  });

  it("gathers the NAV invoices and the settlements under Pénzügy, and purchasing under Raktár és beszerzés", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    fireEvent.click(
      screen.getByRole("button", { name: "Raktár és beszerzés" }),
    );
    expect(screen.getByRole("link", { name: "Beszerzés" })).toHaveAttribute(
      "href",
      "/beszerzes",
    );

    fireEvent.click(screen.getByRole("button", { name: "Pénzügy" }));
    expect(
      screen.getByRole("link", { name: "NAV számla lekérés" }),
    ).toHaveAttribute("href", "/beszerzes/nav-szamlak");
    expect(screen.getByRole("link", { name: "Elszámolások" })).toHaveAttribute(
      "href",
      "/penzugy/elszamolasok",
    );
    expect(
      screen.queryByRole("link", { name: "Foxpost elszámolás" }),
    ).toBeNull();
  });

  /*
    AZ ELSZÁMOLÁSOK A RÉGI ÚTVONALAKON IS AKTÍV (Balázs, 2026-09-30): a fülek a
    saját útvonalukon élnek, és ott a menüpont a jelenlegi. MI PIROSÍT: ha az
    `alsoActiveOn` elveszne, és a GLS oldalon egyik menüpont sem lenne aktív.
  */
  it("marks Elszámolások on each of the three settlement pages", () => {
    for (const pathname of [
      "/penzugy/foxpost",
      "/penzugy/gls",
      "/penzugy/simplepay",
    ]) {
      navigation.pathname = pathname;
      const { unmount } = render(<AppShell>Oldaltartalom</AppShell>);
      expect(
        screen.getByRole("link", { name: "Elszámolások" }),
      ).toHaveAttribute("aria-current", "page");
      unmount();
    }
  });

  /**
   * Opening the app on a page inside a group has to show where you are. A
   * closed group on the page it contains looks like the menu forgot the
   * screen you are reading.
   */
  it("opens the group that holds the current page, and marks it", () => {
    navigation.pathname = "/beszerzes/nav-szamlak";

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.getByRole("button", { name: "Pénzügy" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("link", { name: "NAV számla lekérés" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Webshop" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  /**
   * Two entries in one group both sat above /beszerzes/nav-szamlak, and both
   * lit up: purchasing and the NAV invoices, one under the other, equally
   * current. The nested page belongs to the entry that owns it.
   */
  it("marks only the entry that owns the page, not the one above it", () => {
    navigation.pathname = "/beszerzes/nav-szamlak";

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.getByRole("link", { name: "NAV számla lekérés" }),
    ).toHaveAttribute("aria-current", "page");
    // Beszerzés now lives in another main menu (Raktár és beszerzés), closed here
    fireEvent.click(
      screen.getByRole("button", { name: "Raktár és beszerzés" }),
    );
    expect(screen.getByRole("link", { name: "Beszerzés" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  /**
   * EZ A KETTO KORABBAN EGY TESZT VOLT, es a szetvalasztas nem stilus: a
   * szervizes szerep 2026-09-02-an elvesztette a `products.view` es a
   * `customers.view` jogat, tehat a Webshop csoportbol MAR EGY oldalt sem lat.
   * Egy szerep, ami egyszerre mutatja a szukulest ES az eltunest, ma nincs
   * (merve: a Webshop csoport csak a WAREHOUSE-nal szukul, az viszont latja a
   * Penzugyet). A ket allitas tehat ket szereppel all, egyenkent.
   *
   * AMI AZ EREDETI TESZTBOL ATJON: a kontroll. Egy "nem latszik" allitas akkor
   * is zold, ha a menu MINDENT elrejtett -- ezert mindkettoben all egy pozitiv
   * sor is, ami bizonyitja, hogy a menu egyaltalan rajzol valamit.
   */
  it("drops a heading when no page under it is in reach", () => {
    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "SERVICE" },
    };

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.queryByRole("button", { name: "Pénzügy" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Webshop" }),
    ).not.toBeInTheDocument();

    // A KONTROLL: a menu nem ures, csak ez a ket fejlec hianyzik.
    fireEvent.click(screen.getByRole("button", { name: "Szerviz" }));
    expect(
      screen.getByRole("link", { name: "Munkalapok" }),
    ).toBeInTheDocument();
  });

  it("narrows a heading to the pages in reach", () => {
    // A RAKTAROS latja a megrendeleseket es a bolt termeklistajat, a webshop
    // vasarloit viszont nem -- ezert rajta latszik, hogy a fejlec megmarad, es
    // csak a nem elerheto sor tunik el alola.
    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "WAREHOUSE" },
    };

    render(<AppShell>Oldaltartalom</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Webshop" }));

    expect(
      screen.getByRole("link", { name: "UNAS Megrendelések" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Termékek a webshopban" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Vevők" }),
    ).not.toBeInTheDocument();
  });
});

/**
 * HÁROM ÉLES REGRESSZIÓ A #1122 (Codex ÚJ WEB-KERET) UTÁN, BALÁZS
 * KÉPERNYŐFOTÓI ALAPJÁN (acrobot, msg_id 23608, 2026-09-25).
 *
 * === 1. A NAV NEM GÖRGETHETŐ, KIBONTOTT BEÁLLÍTÁSOKKAL ELÉRHETETLEN SOROK ===
 *
 * Az `<aside>` `flex h-full flex-col`, a `<nav>` `flex-1 min-h-0` volt, DE
 * `overflow-y-auto` NÉLKÜL -- a standard flexbox-görgetés mintájából épp az
 * egy osztály hiányzott, ami ténylegesen görgethetővé teszi. A `logó` fölötte
 * marad (nem flex-1), tehát a görgetés csak a nav TARTALMÁT mozgatja.
 *
 * === 2/3. `bg-pilot-white` NEM LÉTEZŐ TAILWIND-OSZTÁLY ===
 *
 * A `packages/ui/src/figma-theme.css` `@theme` blokkja SOHA nem definiált
 * `--color-pilot-white`-ot (mérve: a fájlban és a repó egészében nulla
 * találat erre a tokenre). A `bg-pilot-white` ezért nem generál CSS-t
 * EGYÁLTALÁN -- az elem háttere emiatt átlátszó (2. hiba), ÉS a sötét
 * módú felülírás (`[data-theme="dark"] .bg-white { ... }`) sem tud
 * lefutni, mert a szelektor `.bg-white`-ra illeszkedik, `.bg-pilot-white`-
 * ra nem (3. hiba). A javítás a MEGLÉVŐ, helyes osztályra állítja át
 * (`bg-white`), amit a téma-réteg már ismer.
 *
 * === A HATÁR, KIMONDVA ===
 *
 * A `happy-dom` teszt-környezet NEM tölt be CSS-t (lásd `test/setup.ts`
 * fejlécét), tehát a tényleges SZÁMÍTOTT háttérszínt itt nem lehet mérni.
 * Ami mérhető, és amit ez a szakasz mér: (a) a görgetéshez szükséges
 * osztály jelen van a nav-on, (b) a háttér-osztály a VALÓDI, a téma-réteg
 * által ismert `bg-white`, nem a sosem létezett `bg-pilot-white`, és (c)
 * a sötét felülírás szelektorának másik fele -- a `data-theme` attribútum
 * -- ténylegesen az `<aside>`-en áll. E három együtt a CSS-szelektor
 * illeszkedésének STRUKTURÁLIS előfeltétele, nem maga a színe.
 */
describe("AppShell #1122 utáni regressziók", () => {
  beforeEach(() => {
    auth.session = ownerSession;
    navigation.pathname = "/";
    window.localStorage.clear();
  });

  it("a navigáció saját függőleges görgetést kap", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    const nav = screen.getByRole("navigation", { name: "Fő navigáció" });
    expect(nav).toHaveClass("overflow-y-auto");
    expect(nav).toHaveClass("min-h-0");
    expect(nav).toHaveClass("flex-1");
  });

  it("az oldalsáv és a felső sáv a valódi bg-white osztályt viseli, nem a sosem létezett bg-pilot-white-ot", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    const nav = screen.getByRole("navigation", { name: "Fő navigáció" });
    const sidebar = nav.closest("aside");
    expect(sidebar).not.toBeNull();
    expect(sidebar).toHaveClass("bg-white");
    expect(sidebar?.className).not.toMatch(/\bbg-pilot-white\b/);

    const header = screen
      .getByRole("searchbox", { name: "Keresés" })
      .closest("header");
    expect(header).not.toBeNull();
    expect(header?.className).toMatch(/\bbg-white\/95\b/);
    expect(header?.className).not.toMatch(/\bbg-pilot-white\b/);
  });

  it('sötét preferenciánál az oldalsáv data-theme="dark"-ot visel, ami a téma-réteg .bg-white felülírását illesztené', () => {
    window.localStorage.setItem("acropora-theme-preference", "dark");

    render(<AppShell>Oldaltartalom</AppShell>);

    const nav = screen.getByRole("navigation", { name: "Fő navigáció" });
    const sidebar = nav.closest("aside");
    expect(sidebar).toHaveAttribute("data-theme", "dark");
    // A tényleges háttérszínt happy-dom nem tudja megmérni (nincs CSS
    // betöltve) -- ez az állítás a szelektor MÁSIK felét, az osztálynevet
    // ellenőrzi, ami a fenti teszttel együtt a teljes illeszkedést fedi.
    expect(sidebar).toHaveClass("bg-white");
  });
});

describe("AppShell navigation source", () => {
  beforeEach(() => {
    navigation.pathname = "/";
  });

  function visibleSidebarHrefs() {
    const sidebarNavigation = screen.getByRole("navigation", {
      name: "Fő navigáció",
    });

    [
      "Áttekintés",
      "Szerviz",
      "Értékesítés",
      "Webshop",
      "Raktár és beszerzés",
      "Pénzügy",
      "Akvarisztika",
      "Tartalom és tudás",
      "Beállítások",
    ].forEach((label) => {
      const group = within(sidebarNavigation).queryByRole("button", {
        name: label,
      });
      if (group?.getAttribute("aria-expanded") === "false") {
        fireEvent.click(group);
      }
    });

    return within(sidebarNavigation)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .sort();
  }

  it("OWNER oldalsávja pontosan a közös forrás engedélyezett elemeiből áll", () => {
    auth.session = ownerSession;

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(visibleSidebarHrefs()).toEqual(
      allNavigationPages
        .filter((item) =>
          isNavigationEntryVisible(item.entryId, { role: "OWNER" }),
        )
        .map((item) => item.href)
        .sort(),
    );
  });

  it("SERVICE oldalsávja pontosan a közös forrás engedélyezett elemeiből áll", () => {
    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "SERVICE" },
    };

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(visibleSidebarHrefs()).toEqual(
      allNavigationPages
        .filter((item) =>
          isNavigationEntryVisible(item.entryId, { role: "SERVICE" }),
        )
        .map((item) => item.href)
        .sort(),
    );
  });

  /**
   * A SZEMÉLY SAJÁT LISTÁJA DÖNT, NEM A SZEREPE (2026-10-06, a felhasználónkénti
   * eltérés előkészítése). Egy OWNER, akinek a szerver kiadott listájából
   * hiányzik a `users.manage`, nem látja a Felhasználók menüpontot.
   * MI PIROSÍT: ha az oldalsáv újra `session.user.role`-ból számolna.
   */
  it("a szerver által kiadott saját jog-lista dönt, nem a szerep", () => {
    auth.session = {
      ...ownerSession,
      user: {
        ...ownerSession.user,
        permissions: ROLE_PERMISSIONS.OWNER.filter(
          (permission) => permission !== PERMISSIONS.USERS_MANAGE,
        ),
      },
    };

    render(<AppShell>Oldaltartalom</AppShell>);

    const hrefs = visibleSidebarHrefs();
    expect(hrefs).not.toContain("/admin/users");
    expect(hrefs).toContain("/admin/brands");
  });
});

/*
  A KILENC FŐMENÜ A KERETBEN (Balázs, 2026-10-26 16:48 UTC; feladat
  os-menu-kilenc-fomenu). MI PIROSÍT: ha a fejlécek sorrendje vagy száma
  elmozdul, ha az Áttekintés alapból zárva áll (a számlálói ott élnek), ha a
  Beállítások alcsoport-címsorai kimaradnak, vagy ha a QR-kód nyomtatás nem a
  Szervizben áll / a szervizes szerepnek megjelenik.
*/
describe("AppShell the nine main menus", () => {
  beforeEach(() => {
    auth.session = ownerSession;
    navigation.pathname = "/akvariumok";
  });

  const headings = () =>
    within(screen.getByRole("navigation", { name: "Fő navigáció" }))
      .getAllByRole("button")
      .map((button) => button.textContent);

  it("draws the nine headings in the listed order, Beállítások last", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(headings()).toEqual([
      "Áttekintés",
      "Akvarisztika",
      "Értékesítés",
      "Pénzügy",
      "Raktár és beszerzés",
      "Szerviz",
      "Tartalom és tudás",
      "Webshop",
      "Beállítások",
    ]);
  });

  it("keeps Áttekintés open from the start, away from its own pages", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.getByRole("button", { name: "Áttekintés" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // the pages themselves follow the shared visibility rules (the session here
    // is the owner without any served switch); Dashboard is always among them
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/",
    );
    // every other heading starts closed on a page that is not under it
    expect(screen.getByRole("button", { name: "Szerviz" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("puts the QR-kód nyomtatás under Szerviz for the owner, and not at all for the service role", () => {
    render(<AppShell>Oldaltartalom</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Szerviz" }));
    expect(
      screen.getByRole("link", { name: "QR-kód nyomtatás" }),
    ).toHaveAttribute("href", "/beallitasok/matricak");
    cleanup();

    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "SERVICE" },
    };
    render(<AppShell>Oldaltartalom</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Szerviz" }));
    expect(
      screen.queryByRole("link", { name: "QR-kód nyomtatás" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Hibajegyek" }),
    ).toBeInTheDocument();
  });

  it("draws the Árajánlat title once, over its two pages, when the switch is served", () => {
    auth.session = {
      ...ownerSession,
      navigation: [
        { id: "quote-snippets", surfaces: ["web"] as const },
        { id: "quote-templates", surfaces: ["web"] as const },
      ],
    };
    render(<AppShell>Oldaltartalom</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Beállítások" }));

    const nav = screen.getByRole("navigation", { name: "Fő navigáció" });
    expect(within(nav).getAllByText("Árajánlat")).toHaveLength(1);
    expect(
      within(nav).getByRole("link", { name: "Ajánlat szövegrészletek" }),
    ).toHaveAttribute("href", "/beallitasok/ajanlat-szovegreszletek");
    expect(
      within(nav).getByRole("link", { name: "Ajánlatsablonok" }),
    ).toHaveAttribute("href", "/beallitasok/ajanlat-sablonok");
  });

  it("shows the settings subgroup titles once each, above their pages", () => {
    render(<AppShell>Oldaltartalom</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: "Beállítások" }));

    const nav = screen.getByRole("navigation", { name: "Fő navigáció" });
    for (const title of ["Kapcsolatok", "Törzsadatok"])
      expect(within(nav).getAllByText(title)).toHaveLength(1);
    // the quote pages sit behind the `quotes` switch, which this session was not
    // served: their title is not drawn over nothing
    expect(within(nav).queryByText("Árajánlat")).not.toBeInTheDocument();
    // a title is not a menu entry: no link, no button of that name
    expect(
      within(nav).queryByRole("link", { name: "Kapcsolatok" }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("button", { name: "Kapcsolatok" }),
    ).not.toBeInTheDocument();
    // the page order inside Beállítások is the listed one
    const hrefs = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"))
      .filter(
        (href) =>
          href?.startsWith("/beallitasok") ||
          href?.startsWith("/admin/integrations") ||
          href === "/admin/users",
      );
    expect(hrefs).toEqual([
      "/beallitasok",
      "/admin/users",
      "/admin/integrations/nav",
      "/admin/integrations/szamlazz/connection",
      "/beallitasok/mertekegysegek",
      "/beallitasok/eszkoz-kategoriak",
      "/beallitasok/eszkoz-funkciok",
    ]);
  });
});

// THE SEARCH ON A COOKIE SESSION (stage and production, measured 2026-09-30):
// the session carries no client-readable token, and the search box was not
// drawn at all. What must fail: gating the box on the token again; passing
// `undefined` on. The control: no session, no box.
describe("AppShell global search", () => {
  beforeEach(() => {
    navigation.pathname = "/";
    searchProps.tokens.length = 0;
  });

  it("a cookie session without a token still gets the search, with an empty token", () => {
    auth.session = { ...ownerSession, token: undefined };
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.getByRole("searchbox", { name: "Keresés" }),
    ).toBeInTheDocument();
    expect(searchProps.tokens.at(-1)).toBe("");
  });

  it("a session with a token passes it on", () => {
    auth.session = ownerSession;
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(searchProps.tokens.at(-1)).toBe("owner-token");
  });

  it("without a session there is no search (control)", () => {
    auth.session = null;
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.queryByRole("searchbox", { name: "Keresés" })).toBeNull();
  });
});

// JEV 5. fázis: a katalógus adatminőség menüpontja a szerver kapcsolóját
// követi (a munkamenettel kiadott menü), és a szerepjogot is. MI PIROSÍT: ha a
// pont a kapcsoló nélkül is látszana; ha kapcsolóval sem; ha a kiadott menü a
// jogot felülírná. A Termékek a Raktár és beszerzés főmenü tétele (2026-10-26),
// nem külön csoport: kikapcsolva az Adatminőség tétel hiányzik, a Termékek marad.
describe("AppShell catalogue data-quality entry", () => {
  beforeEach(() => {
    navigation.pathname = "/";
  });

  const served = [
    { id: "products", surfaces: ["web", "mobile"] as const },
    { id: "product-data-quality", surfaces: ["web"] as const },
  ];

  it("switch off: Termékek stays a link, the page is not in the menu", () => {
    auth.session = ownerSession;
    render(<AppShell>Oldaltartalom</AppShell>);

    fireEvent.click(
      screen.getByRole("button", { name: "Raktár és beszerzés" }),
    );
    expect(screen.getByRole("link", { name: "Termékek" })).toHaveAttribute(
      "href",
      "/products",
    );
    expect(
      screen.queryByRole("link", { name: "Adatminőség" }),
    ).not.toBeInTheDocument();
  });

  it("switch on, as served: Adatminőség under Termékek", () => {
    auth.session = { ...ownerSession, navigation: served };
    render(<AppShell>Oldaltartalom</AppShell>);

    fireEvent.click(
      screen.getByRole("button", { name: "Raktár és beszerzés" }),
    );
    expect(screen.getByRole("link", { name: "Termékek" })).toHaveAttribute(
      "href",
      "/products",
    );
    expect(screen.getByRole("link", { name: "Adatminőség" })).toHaveAttribute(
      "href",
      "/products/adatminoseg",
    );
  });

  it("the served switch does not override products.view", () => {
    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "SERVICE" },
      navigation: served,
    };
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.queryByRole("link", { name: "Adatminőség" }),
    ).not.toBeInTheDocument();
    // the service role has no right under Raktár és beszerzés at all
    expect(
      screen.queryByRole("button", { name: "Raktár és beszerzés" }),
    ).not.toBeInTheDocument();
  });

  it("on the page itself only Adatminőség is current, not Termékek", () => {
    auth.session = { ...ownerSession, navigation: served };
    navigation.pathname = "/products/adatminoseg";
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.getByRole("link", { name: "Adatminőség" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Termékek" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

/**
 * THE COMPACT PROFILE (Figma 441:2, "Profile" 441:58 and "Header actions"
 * 441:66). Display only: what is measured is what the shell draws, never
 * who may see what.
 */
describe("AppShell kompakt profil", () => {
  const longSession: Session = {
    ...ownerSession,
    user: {
      ...ownerSession.user,
      displayName: "Kitaláltné Hosszúnevű Erzsébet",
      role: "ADMIN",
    },
  };

  beforeEach(() => {
    auth.session = longSession;
    navigation.pathname = "/";
  });

  it("a sidebar alján 32px-es monogram, név és a szerepkör magyarul, finom felső borderrel", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    const profile = screen.getByRole("region", {
      name: "Bejelentkezett felhasználó",
    });
    expect(profile.closest("aside")).not.toBeNull();
    expect(profile).toHaveClass("border-t", "border-pilot-grey-200");

    const monogram = within(profile).getByTestId("profile-monogram");
    expect(monogram).toHaveClass("size-8");
    expect(monogram).toHaveTextContent(/^KH$/);

    const name = within(profile).getByText("Kitaláltné Hosszúnevű Erzsébet");
    expect(name).toHaveClass("truncate", "text-sm");
    const role = within(profile).getByText("Admin");
    expect(role).toHaveClass("truncate", "text-xs", "text-pilot-grey-500");
    expect(within(profile).queryByText("ADMIN")).toBeNull();
  });

  it("munkamenet nélkül nincs profil (kontroll)", () => {
    auth.session = null;
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.queryByRole("region", { name: "Bejelentkezett felhasználó" }),
    ).toBeNull();
  });

  /*
    A MODUL MEGVAN (kartya 51d7aba0): az ikon most mar annak jelenik meg
    alapbol, aki uzenhet (`messages.use`), es az Uzenetek lapjara visz. Akinek
    nincs joga, annak tovabbra sem.
  */
  it("az Üzenetek ikon annak jelenik meg, aki üzenhet, és a lapra visz", async () => {
    render(<AppShell>Oldaltartalom</AppShell>);
    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("link", { name: "Üzenetek" }),
    ).toHaveAttribute("href", "/uzenetek");
  });

  it("akinek nincs `messages.use` joga, annak nincs Üzenetek ikonja", () => {
    auth.session = {
      ...auth.session!,
      user: { ...auth.session!.user, role: "CONTENT_AGENT" },
    };
    render(<AppShell>Oldaltartalom</AppShell>);
    expect(screen.queryByRole("link", { name: /Üzenetek/ })).toBeNull();
  });

  it("POZITÍV KONTROLL: a helye kész, prop-pal 32px-es ikon és olvasatlan-jelvény a fejlécben", () => {
    render(
      <AppShell
        messages={{
          href: "/uzenetek",
          icon: <svg data-testid="glyph" />,
          unreadCount: 3,
        }}
      >
        Oldaltartalom
      </AppShell>,
    );

    const link = screen.getByRole("link", { name: "Üzenetek, 3 olvasatlan" });
    expect(link.closest("header")).not.toBeNull();
    expect(link).toHaveAttribute("href", "/uzenetek");
    expect(link).toHaveClass("size-8");
    expect(within(link).getByTestId("glyph")).toBeInTheDocument();
    expect(link).toHaveTextContent(/^3$/);
  });

  it("olvasatlan nélkül nincs jelvény, kilenc fölött 9+", () => {
    const { rerender } = render(
      <AppShell messages={{ href: "/uzenetek", icon: null, unreadCount: 0 }}>
        Oldaltartalom
      </AppShell>,
    );
    expect(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "Üzenetek",
      }),
    ).toHaveTextContent(/^$/);

    rerender(
      <AppShell messages={{ href: "/uzenetek", icon: null, unreadCount: 12 }}>
        Oldaltartalom
      </AppShell>,
    );
    expect(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "Üzenetek, 12 olvasatlan",
      }),
    ).toHaveTextContent(/^9\+$/);
  });
});

/*
  THE MENU NUMBERS (card 4a6813db). WHAT TURNS RED: the number is not on the
  entry it counts; a zero or a null shows a badge; a big number is not cut to
  "99+"; the screen reader does not hear what is counted.
*/
describe("AppShell menu numbers", () => {
  beforeEach(() => {
    auth.session = ownerSession;
    navigation.pathname = "/";
  });

  const szerviz = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Szerviz" }));
  };

  it("puts each number on its own entry, and none on a zero or a null", async () => {
    counters.fetch.mockReset().mockResolvedValue({
      "service-jobs": 3,
      worksheets: 0,
      "material-requests-pending": null,
    });
    render(<AppShell>Oldaltartalom</AppShell>);
    await szerviz();
    const hibajegyek = await screen.findByRole("link", { name: /Hibajegyek/ });
    expect(
      within(hibajegyek).getByLabelText("3 nekem kiosztott, nyitott hibajegy"),
    ).toHaveTextContent("3");
    expect(
      within(screen.getByRole("link", { name: /Munkalapok/ })).queryByText("0"),
    ).toBeNull();
    expect(
      screen.queryByLabelText(/teendő anyagigény/),
    ).not.toBeInTheDocument();
    expect(counters.fetch).toHaveBeenCalledWith(
      "owner-token",
      expect.anything(),
    );
  });

  it("a number above 99 shows as 99+", async () => {
    counters.fetch.mockReset().mockResolvedValue({
      "service-jobs": 0,
      worksheets: 140,
      "material-requests-pending": 0,
    });
    render(<AppShell>Oldaltartalom</AppShell>);
    await szerviz();
    expect(
      await screen.findByLabelText(
        "140 nekem kiosztott, új vagy folyamatban lévő munkalap",
      ),
    ).toHaveTextContent("99+");
  });
});

/*
  A KEDVENCEK (Balázs, 2026-10-27, msg 1564543075383115838): a csillag gomb
  "Kedvencekbe" felirattal minden menüpont képernyőjén, a megjelölt oldal az
  Áttekintés FÖLÖTTI Kedvencek menüben. MI PIROSÍT: a gomb hiányzik egy menüpont
  oldaláról, vagy megjelenik olyan oldalon, ami nem menüpont; a kattintás nem a
  szervernek szól, vagy a csillag a mentés eredménye nélkül marad bejelölve; a
  Kedvencek menü üres listánál is áll, vagy nem az Áttekintés fölött; a
  láthatatlan menüpont kedvencként megjelenik.
*/
describe("AppShell favourites", () => {
  beforeEach(() => {
    favoritesApiMock.list.mockReset().mockResolvedValue({ items: [] });
    favoritesApiMock.add.mockReset().mockResolvedValue({ items: [] });
    favoritesApiMock.remove.mockReset().mockResolvedValue({ items: [] });
    auth.session = ownerSession;
    navigation.pathname = "/akvariumok";
  });

  const headings = () =>
    within(screen.getByRole("navigation", { name: "Fő navigáció" }))
      .getAllByRole("button")
      .map((button) => button.textContent);

  /** The star is live once the list has arrived (see `useFavorites`). */
  const pressStar = async () => {
    const star = screen.getByRole("button", { name: "Kedvencekbe" });
    await waitFor(() => expect(star).toBeEnabled());
    fireEvent.click(star);
  };

  it("has the star on every menu page, labelled Kedvencekbe", () => {
    for (const page of allNavigationPages.filter((item) =>
      isNavigationEntryVisible(item.entryId, ownerSession.user),
    )) {
      navigation.pathname = page.href;
      const { unmount } = render(<AppShell>Oldaltartalom</AppShell>);
      expect(
        screen.getByRole("button", { name: "Kedvencekbe" }),
        page.href,
      ).toHaveAttribute("aria-pressed", "false");
      unmount();
    }
  });

  it("has no star on a page that is not a menu page", () => {
    navigation.pathname = "/nincs-ilyen-oldal";
    render(<AppShell>Oldaltartalom</AppShell>);
    expect(screen.queryByRole("button", { name: "Kedvencekbe" })).toBeNull();
  });

  it("keeps the star off until the list has arrived, so a late list cannot undo a press", async () => {
    let arrive: (value: { items: string[] }) => void = () => {};
    favoritesApiMock.list.mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    render(<AppShell>Oldaltartalom</AppShell>);

    const star = screen.getByRole("button", { name: "Kedvencekbe" });
    expect(star).toBeDisabled();
    fireEvent.click(star);
    expect(favoritesApiMock.add).not.toHaveBeenCalled();

    arrive({ items: ["/akvariumok"] });
    await waitFor(() => expect(star).toBeEnabled());
    expect(star).toHaveAttribute("aria-pressed", "true");
  });

  it("shows no Kedvencek menu while nothing is marked", async () => {
    render(<AppShell>Oldaltartalom</AppShell>);
    await waitFor(() => expect(favoritesApiMock.list).toHaveBeenCalled());
    expect(headings()).not.toContain("Kedvencek");
  });

  it("saves the mark on the server, fills the star, and lists the page above Áttekintés", async () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    await pressStar();

    // a mentés a kattintások sorába áll, ezért egy mikrofeladattal később indul
    await waitFor(() =>
      expect(favoritesApiMock.add).toHaveBeenCalledWith(
        "owner-token",
        "/akvariumok",
      ),
    );
    expect(screen.getByRole("button", { name: "Kedvencekbe" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const list = headings();
    expect(list.slice(0, 2)).toEqual(["Kedvencek", "Áttekintés"]);
    const favorites = within(
      screen.getByRole("navigation", { name: "Fő navigáció" }),
    ).getByRole("button", { name: "Kedvencek" });
    expect(favorites).toHaveAttribute("aria-expanded", "true");
  });

  it("takes it out again on the second press, and the menu goes with the last one", async () => {
    favoritesApiMock.list.mockResolvedValue({ items: ["/akvariumok"] });
    render(<AppShell>Oldaltartalom</AppShell>);
    await waitFor(() => expect(headings()[0]).toBe("Kedvencek"));
    expect(screen.getByRole("button", { name: "Kedvencekbe" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await pressStar();

    await waitFor(() =>
      expect(favoritesApiMock.remove).toHaveBeenCalledWith(
        "owner-token",
        "/akvariumok",
      ),
    );
    expect(headings()).not.toContain("Kedvencek");
  });

  it("puts back what the server holds when the save fails, and says so", async () => {
    favoritesApiMock.add.mockRejectedValue(new Error("down"));
    render(<AppShell>Oldaltartalom</AppShell>);

    await pressStar();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nem sikerült menteni.",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Kedvencekbe" }),
      ).toHaveAttribute("aria-pressed", "false"),
    );
    expect(headings()).not.toContain("Kedvencek");
  });

  it("keeps a favourite out of the menu when the user may not see that page", async () => {
    // the service role does not see the QR-kód nyomtatás (settings.manage)
    auth.session = {
      ...ownerSession,
      user: { ...ownerSession.user, role: "SERVICE" },
    };
    favoritesApiMock.list.mockResolvedValue({
      items: ["/beallitasok/matricak"],
    });
    render(<AppShell>Oldaltartalom</AppShell>);
    await waitFor(() => expect(favoritesApiMock.list).toHaveBeenCalled());
    expect(headings()).not.toContain("Kedvencek");
  });
});
