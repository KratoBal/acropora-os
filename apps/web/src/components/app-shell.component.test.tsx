import { fireEvent, render, screen, within } from "@testing-library/react";
import { isNavigationEntryVisible, type Session } from "@acropora/types";
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
vi.mock("./auth/user-menu", () => ({
  UserMenu: () => <div>Felhasználói menü</div>,
}));
vi.mock("./global-search", () => ({
  GlobalSearch: () => <div>Kereső</div>,
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
    auth.session = ownerSession;
    navigation.pathname = "/";
  });

  it("nests UNAS, NAV and users below settings", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    expect(
      screen.queryByRole("link", { name: "Kapcsolat" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Beállítások" }));

    expect(screen.getByRole("link", { name: "NAV" })).toHaveAttribute(
      "href",
      "/admin/integrations/nav",
    );
    expect(screen.getByRole("link", { name: "Felhasználók" })).toHaveAttribute(
      "href",
      "/admin/users",
    );

    fireEvent.click(screen.getByRole("button", { name: "UNAS" }));

    expect(screen.getByRole("link", { name: "Kapcsolat" })).toHaveAttribute(
      "href",
      "/admin/integrations/unas/connection",
    );
    expect(screen.getByRole("link", { name: "Szinkron" })).toHaveAttribute(
      "href",
      "/admin/integrations/unas",
    );
  });

  it("automatically expands the active settings hierarchy", () => {
    navigation.pathname = "/admin/integrations/unas/connection";

    render(<AppShell>Oldaltartalom</AppShell>);

    expect(screen.getByRole("button", { name: "Beállítások" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "UNAS" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Kapcsolat" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Szinkron" })).not.toHaveAttribute(
      "aria-current",
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
      screen.queryByRole("link", { name: "Megrendelések" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Webshop" }));

    expect(screen.getByRole("link", { name: "Megrendelések" })).toHaveAttribute(
      "href",
      "/webshop",
    );
    expect(
      screen.getByRole("link", { name: "Webshop vásárlók" }),
    ).toHaveAttribute("href", "/vevok");
  });

  it("gathers purchasing, the NAV invoices and the Foxpost settlement under Pénzügy", () => {
    render(<AppShell>Oldaltartalom</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Pénzügy" }));

    expect(screen.getByRole("link", { name: "Beszerzés" })).toHaveAttribute(
      "href",
      "/beszerzes",
    );
    expect(
      screen.getByRole("link", { name: "NAV számla lekérés" }),
    ).toHaveAttribute("href", "/beszerzes/nav-szamlak");
    expect(
      screen.getByRole("link", { name: "Foxpost elszámolás" }),
    ).toHaveAttribute("href", "/penzugy/foxpost");
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
      screen.getByRole("link", { name: "Megrendelések" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Webshop termékek" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Webshop vásárlók" }),
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
      "Webshop",
      "Partnerek",
      "Pénzügy",
      "Szerviz",
      "Beállítások",
      "UNAS",
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
        .filter((item) => isNavigationEntryVisible(item.entryId, "OWNER"))
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
        .filter((item) => isNavigationEntryVisible(item.entryId, "SERVICE"))
        .map((item) => item.href)
        .sort(),
    );
  });
});
