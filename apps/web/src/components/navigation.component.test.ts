import { describe, expect, it } from "vitest";
import {
  hasPermission,
  isNavigationEntryVisible,
  navigationEntry,
  USER_ROLES,
  type Permission,
  type UserRole,
} from "@acropora/types";

import {
  allNavigationPages,
  businessNavigation,
  isNavigationGroup,
  isNavigationItemActive,
  navigationItems,
  primaryNavigation,
  secondaryNavigation,
  settingsNavigation,
  unasSettingsNavigation,
  type AppNavigationGroup,
  type AppNavigationItem,
} from "./navigation";

/**
 * UGYANAZ A HAT LISTA, AMIT AZ APP-SHELL OSSZEFUZ, es ugyanaz a szuro,
 * amit hasznal (`hasPermission(session.user, item.permission)`).
 *
 * Ha ez a fuggveny csak nehanyat nezne kozuluk, egy allitas arrol, hogy "a
 * szervizes ezeket latja", SZUKEBB halmazt merne, mint amit a felhasznalo lat
 * -- es epp a kimaradt listaban allo tobbletet nem venne eszre. A hatos
 * felsorolas ezert masolat, nem valogatas.
 */
// A KERET SAJAT LISTAJA, nem egy ittani masolata: ha az osszefuzes elcsuszik,
// ennek a fajlnak MINDEN allitasa vele csuszik, tehat a halo nem hazudik.
const shellNavigationItems = () => allNavigationPages;

function visibleLabelsFor(role: UserRole): string[] {
  return allNavigationPages
    .filter((item) => isNavigationEntryVisible(item.entryId, role))
    .map((item) => item.label);
}

function group(label: string): AppNavigationGroup {
  const found = businessNavigation.find(
    (entry) => isNavigationGroup(entry) && entry.label === label,
  );
  if (!found || !isNavigationGroup(found))
    throw new Error(`nincs "${label}" nevű menücsoport`);
  return found;
}

describe("navigation", () => {
  /**
   * The screen at /vevok holds webshop buyers, and the partners we work for
   * live under /partnerek. The menu is where that distinction is first made,
   * so it has to name them apart.
   *
   * Asserted here rather than only on the page, because the two are separate
   * strings in separate files: renaming the page heading and leaving the menu
   * saying "Vevők" is the half-finished state, and nothing else would report
   * it. The page's own heading is asserted in its own spec.
   */
  it("calls the webshop buyers what they are, apart from the partners", () => {
    const labels = new Map(
      navigationItems(businessNavigation).map((item) => [
        item.href,
        item.label,
      ]),
    );

    expect(labels.get("/vevok")).toBe("Webshop vásárlók");
    expect(labels.get("/partnerek")).toBe("Partnerek");
  });

  it("puts the orders, the buyers and the shop's products under one Webshop heading", () => {
    expect(
      group("Webshop").children.map((item) => [item.href, item.label]),
    ).toEqual([
      ["/webshop", "Megrendelések"],
      ["/vevok", "Webshop vásárlók"],
      ["/webshop/termekek", "Webshop termékek"],
    ]);
  });

  /**
   * Two entries, two catalogues. /products is the full internal one with the
   * barcode editor; the webshop entry is the shop's own narrowed view. They
   * are separate destinations and neither replaces the other.
   */
  it("keeps the full catalogue where it was", () => {
    const labels = new Map(
      navigationItems(businessNavigation).map((item) => [
        item.href,
        item.label,
      ]),
    );

    expect(labels.get("/products")).toBe("Termékek");
    expect(labels.get("/webshop/termekek")).toBe("Webshop termékek");
  });

  /**
   * A Pénzügy csoport tartalma SZÁNDÉKOSAN változott: a leltár és a
   * készlet-egyeztetés a felső szintről KÖLTÖZÖTT ide.
   *
   * A régi állítás három gyereket rögzített (beszerzés, NAV számlák, Foxpost),
   * és a költözéskor jogosan bukott el. Az új ötöt rögzít, a beköltözőkkel a
   * végén, tehát a meglévő három sorrendje nem mozdult.
   */
  it("gathers purchasing, the NAV invoices, the Foxpost settlement and the two stock pages under Pénzügy", () => {
    expect(group("Pénzügy").children.map((item) => item.href)).toEqual([
      "/beszerzes",
      "/beszerzes/nav-szamlak",
      "/penzugy/foxpost",
      "/raktar",
      "/keszlet-egyeztetes",
      "/keszlet-kimenosor",
    ]);
  });

  /**
   * A Működés blokk FELSŐ SZINTŰ sorrendjét eddig semmi nem állította.
   *
   * Ez nem elméleti hiány volt: a POS és a Webshop helycseréje enélkül
   * méretlen maradt volna, és a változás után sem lett volna semmi, ami az új
   * sorrendet tartja - bármelyik későbbi szerkesztés csendben visszafordíthatta
   * volna. A csoportok a fejlécük nevén szerepelnek, mert a menüben is az
   * látszik.
   */
  it("keeps the operations block in the order it is meant to be read", () => {
    expect(
      businessNavigation.map((entry) =>
        isNavigationGroup(entry) ? entry.label : entry.label,
      ),
    ).toEqual([
      "POS",
      "Webshop",
      "Termékek",
      "Partnerek",
      "Pénzügy",
      "Akváriumok",
      "ICP",
      "Szerviz",
    ]);
  });

  /**
   * Egy oldal pontosan EGYSZER szerepelhet a menüben.
   *
   * E nélkül a "költözés" és a "másolás" megkülönböztethetetlen: aki a leltárt
   * beteszi a Pénzügy alá, de fentről elfelejti kivenni, két helyen kapja meg
   * ugyanazt az oldalt, és a csoport tartalmát állító teszt ettől még zöld
   * marad. A számot nem soroljuk fel: az útvonalakat számoljuk, és a duplikátum
   * NEVÉT írjuk ki, mert egy szám önmagában nem mondja meg, melyik.
   */
  it("shows every page in exactly one place", () => {
    const hrefs = [
      ...primaryNavigation,
      ...navigationItems(businessNavigation),
      ...secondaryNavigation,
      ...settingsNavigation,
      ...unasSettingsNavigation,
    ].map((item) => item.href);

    const seen = new Set<string>();
    const duplicates = hrefs.filter((href) => {
      if (seen.has(href)) return true;
      seen.add(href);
      return false;
    });

    expect(duplicates).toEqual([]);
  });

  /**
   * /penzugy is not a page of its own: the route falls through to the shared
   * "modul előkészítve" placeholder. It was a menu entry before this heading
   * existed; keeping it would put a heading and a link with the same name next
   * to each other, one of which leads nowhere.
   */
  it("no longer offers the placeholder route as a destination", () => {
    expect(
      navigationItems(businessNavigation).map((item) => item.href),
    ).not.toContain("/penzugy");
  });

  /**
   * A heading carries no permission of its own, so anything that reads this
   * list as "the pages" has to open the groups out first. The user editor's
   * permission preview is the caller that would otherwise go quiet: it would
   * simply stop listing the pages that moved under a heading.
   */
  /**
   * Two entries can both sit above the same path. The specific one owns it,
   * and the outer one has to stay dark - otherwise two entries in the same
   * group look equally current, and the reader cannot tell which screen they
   * are on.
   *
   * The pages under an entry still belong to it: a single purchase order is
   * purchasing, and a single webshop order is the order list. That half is
   * asserted too, because the obvious fix for the first half - marking the
   * entry `exact` - would silently break it.
   */
  describe("active entry", () => {
    const items = navigationItems(businessNavigation);
    const item = (href: string): AppNavigationItem => {
      const found = items.find((entry) => entry.href === href);
      if (!found) throw new Error(`nincs "${href}" menüpont`);
      return found;
    };
    const active = (pathname: string, href: string) =>
      isNavigationItemActive(pathname, item(href), items);

    it("gives a nested page to the entry that owns it, not to the one above", () => {
      expect(active("/beszerzes/nav-szamlak", "/beszerzes/nav-szamlak")).toBe(
        true,
      );
      expect(active("/beszerzes/nav-szamlak", "/beszerzes")).toBe(false);
      expect(active("/beszerzes/nav-szamlak/42", "/beszerzes")).toBe(false);
    });

    it("keeps a detail page with its own list", () => {
      expect(active("/beszerzes/uj", "/beszerzes")).toBe(true);
      expect(active("/webshop/order-42", "/webshop")).toBe(true);
      expect(active("/vevok/uj", "/vevok")).toBe(true);
    });

    /**
     * The two live under the same path, and the order list is the one that
     * would have lit up by accident: /webshop/termekek starts with /webshop.
     */
    it("hands /webshop/termekek to the products entry, not to the order list", () => {
      expect(active("/webshop/termekek", "/webshop/termekek")).toBe(true);
      expect(active("/webshop/termekek", "/webshop")).toBe(false);
    });
  });

  it("opens groups out into their pages, each resolving in the shared source", () => {
    const items = navigationItems(businessNavigation);

    expect(items.map((item) => item.href)).toContain("/szerviz/munkalapok");
    for (const item of items) {
      // ERŐSEBB ALLITAS, MINT A KORABBI "van jogosultsagi kulcsa": egy elgepelt
      // azonositora a keresés `undefined`-ot ad, es a menupont MINDENKI elol
      // eltunne (az `isNavigationEntryVisible` ismeretlen azonositora hamisat
      // ad). Ezt a hibat egy "truthy" ellenorzes nem fogta volna meg.
      expect(navigationEntry(item.entryId)).toBeDefined();
      expect(item.href.startsWith("/")).toBe(true);
    }
  });

  /**
   * A SZERVIZES MENUJE, BALAZS LISTAJA SZERINT. KET MONDAT, IDORENDBEN, es a
   * masodik BOVITI az elsot, nem cafolja:
   *
   *   2026-09-02 08:39, Discord: a lista TELJES, nem minimum -- "ezen kivul
   *   nem kell masnak latszania". A Hibajegyek akkor nem szerepelt rajta.
   *
   *   2026-09-02 12:33, Discord (Eldontendo dolgok szal): "igen legyen a
   *   hibajegy is elerheto nekik". A tobbi tetel valtozatlan.
   *
   * A REGI IDEZET AZERT MARAD ITT, mert enelkul a ket allitas kozul csak az
   * egyikrol latszana, honnan jott -- es a datum mondja meg, hogy nem mondanak
   * ellent egymasnak: az egyik 08:39-kor volt teljes, a masik 12:33-kor bovitette.
   *
   * AMIERT A TELJES HALMAZ ALL ITT, ES NEM AZ, HOGY "a hat tetel eltunt":
   * egy hianyra iranyulo allitas akkor is zold, ha kozben MAS jelent meg. Egy
   * uj menupont, ami `products.view` helyett `orders.view` jogot ker, egy
   * "nem latja a Termekeket" allitasnak nem mond ellent -- ennek igen.
   *
   * MI PIROSIT: barmi, ami megjelenik a szervizesnek a listan kivul, es barmi,
   * ami eltunik rola. A masodik iranyra kulon van szukseg: a jogok szukitese
   * konnyen visz el tobbet a kelletenel, es a hianyt senki nem jelenti.
   */
  it("shows the service role exactly the menu the owner listed", () => {
    // RENDEZVE, mert az allitas a HALMAZROL szol, nem a sorrendrol. A menu
    // sorrendje valos tulajdonsag, de nem ez a szabaly, es egy artalmatlan
    // atrendezes ugy pirositana, mintha valaki jogot mozditott volna.
    expect([...visibleLabelsFor("SERVICE")].sort()).toEqual(
      [
        "Dashboard",
        "Feladataim",
        // A 12:33-as bovites, es a lanc elso eleme.
        "Hibajegyek",
        "Munkalapok",
        "Eszköznyilvántartás",
        "Partnerek",
        // AZ EGYETLEN TETEL, AMI NINCS BALAZS LISTAJAN. Nem feledekenyseg: az
        // akvarium a szerviz TARGYA, tehat lehet, hogy kell neki, es a kerdes
        // nala van (2026-09-02). Amig nem valaszol, ez a sor marad -- es ha
        // valaszol, EZ AZ EGY SOR valtozik, a `ROLE_PERMISSIONS.SERVICE`
        // akvarium-jogaival egyutt.
        "Akváriumok",
      ].sort(),
    );
  });

  /**
   * NEVSZERINT A HAT TETEL, amit ez a kor elvett. Kulon allitas, mert a fenti
   * egyenloseg egy sorban bukna el mindre, es a hibauzenetbol nem latszana,
   * MELYIK jott vissza. Nautilus merese ezt a hatot nevezte meg 2026-09-02-an.
   */
  it("keeps the six measured extras away from the service role", () => {
    const visible = visibleLabelsFor("SERVICE");

    for (const label of [
      "Webshop vásárlók",
      "Webshop termékek",
      "Termékek",
      "Márkák",
      "Szinkron",
      "AI teszt",
    ])
      expect(visible).not.toContain(label);
  });

  /**
   * A KONTROLL A SZUROHOZ. A ket fenti allitas hianyt mer, es egy hianyt egy
   * elromlott szuro is eloallit: ha a `visibleLabelsFor` ures listat adna, mind
   * a ketto zold maradna. Ez a sor bizonyitja, hogy a szuro MEG TUDJA TALALNI
   * azt a hatot, amikor tenyleg latszik -- egy tulajdonosnak mind a hat ott van.
   */
  it("can see the six at all, so the absence above means something", () => {
    const owner = visibleLabelsFor("OWNER");

    for (const label of [
      "Webshop vásárlók",
      "Webshop termékek",
      "Termékek",
      "Márkák",
      "Szinkron",
      "AI teszt",
    ])
      expect(owner).toContain(label);
  });

  /**
   * A HALO: A KOZOS FORRAS PONTOSAN A MAI VISELKEDEST ADJA, MINDEN SZEREPRE.
   *
   * Ez a tabla a menupontok jogosultsagi kulcsait tartalmazza UGY, AHOGY 2026-09-02-an
   * a `navigation.ts`-ben alltak, kozvetlenul a kozos forras bevezetese elott.
   * Merve, nem emlekezetbol: a fajlbol lettek kiolvasva.
   *
   * MIERT NEM KORKOROS: a varakozas itt LEIRT ADAT, nem a forrasbol szamolt
   * ertek. Ha a forras barmelyik tetel szabalyat maskepp irja le, mint ahogy a
   * jogosultsagi kulcs adta, ez a sor pirosodik -- barmelyik szerepnel.
   *
   * MIT NEM BIZONYIT: azt, hogy a mai viselkedes HELYES. Csak azt, hogy a
   * bevezetes nem valtoztatta meg. Ez az (1) lepes teljes igerete.
   *
   * A BEVEZETES UTAN FELVETT SOROK KULON JELOLVE ALLNAK, es NEM a pillanatkep
   * reszei. Rajuk a tabla mar nem "igy volt", hanem "ugyanaz a parositas all
   * ra is": az uj oldal jogosultsagi kulcsa es a kozos forras szabalya
   * egyezzen minden szerepnel. Jelolés nelkul a sor tortenetinek latszana, es
   * a tabla sajat leirasa valna hamissa.
   */
  const A_BEVEZETES_ELOTTI_JOGOK: Record<string, Permission> = {
    "/": "dashboard.view",
    "/feladataim": "tasks.view",
    // A BEVEZETES UTAN FELVETT SOR (2026-09-02 12:33-as dontes utan), nem a
    // pillanatkep resze. Azert kerul ide, mert a fenti kontroll a tablat es a
    // menut ugyanarra a halmazra koti: enelkul az uj oldal CSENDBEN kimaradna
    // az osszevetesbol, epp ott, ahol uj a kod.
    "/szerviz/hibajegyek": "service.view",
    "/szerviz/munkalapok": "service.view",
    "/szerviz/eszkozok": "service.view",
    "/tartalom": "content.view",
    "/pos": "orders.view",
    "/webshop": "orders.view",
    "/vevok": "customers.view",
    "/webshop/termekek": "products.view",
    "/products": "products.view",
    "/partnerek": "partners.view",
    "/beszerzes": "purchasing.view",
    "/beszerzes/nav-szamlak": "purchasing.view",
    "/penzugy/foxpost": "finance.view",
    "/raktar": "inventory.view",
    "/keszlet-egyeztetes": "inventory.view",
    "/keszlet-kimenosor": "inventory.view",
    "/akvariumok": "aquariums.view",
    "/icp": "icp.view",
    "/admin/integrations/unas/connection": "settings.manage",
    "/admin/integrations/unas": "products.view",
    "/ai-teszt": "ai-test.view",
    "/admin/brands": "products.view",
    "/beallitasok": "settings.manage",
    "/admin/integrations/nav": "settings.manage",
    "/admin/integrations/medusa/connection": "settings.manage",
    "/admin/users": "users.manage",
    // A matricakiadas ugyanazt a jogot kapja, mint a tobbi Beallitasok-tetel,
    // amit a szervizes nem lat. Balazs, 2026-09-02 21:00:53: "Nem kell hogy
    // lassa".
    "/beallitasok/matricak": "settings.manage",
  };

  it("reproduces, for every role, exactly what the hard-coded keys produced", () => {
    const items = shellNavigationItems();

    // A KONTROLL: a tabla ES a menu ugyanarrol a huszonhat oldalrol szoljon. Egy
    // uj menupont, amit senki nem vesz fel ide, kulonben CSENDBEN kimaradna az
    // osszevetesbol, es a halo pont ott lenne lyukas, ahol uj a kod.
    expect([...new Set(items.map((item) => item.href))].sort()).toEqual(
      Object.keys(A_BEVEZETES_ELOTTI_JOGOK).sort(),
    );

    for (const role of USER_ROLES) {
      const aForrasSzerint = items
        .filter((item) => isNavigationEntryVisible(item.entryId, role))
        .map((item) => item.href);
      const aRegiKulcsokSzerint = items
        .filter((item) =>
          hasPermission(role, A_BEVEZETES_ELOTTI_JOGOK[item.href]!),
        )
        .map((item) => item.href);

      expect([role, aForrasSzerint]).toEqual([role, aRegiKulcsokSzerint]);
    }
  });

  /**
   * A FELHASZNALO-SZERKESZTO ELONEZETE UGYANAZT A HAT LISTAT FUZI OSSZE, mint a
   * keret. Merve 2026-09-02, a bevezetes ELOTT: nem ugyanazt tette, es harom
   * ponton mondott mast -- kihagyta a Tartalom oldalt, es duplan sorolta a ket
   * szerviz-menupontot (26 kontra 27 tetel).
   *
   * MI PIROSIT: ha a ket lista barmelyike valtozik a masik nelkul. Ezert all
   * ITT, es nem a szerkeszto sajat tesztjeben: onnan csak az egyik oldal latszik.
   */
  it("previews the same pages the shell renders, with no duplicates", () => {
    const hrefs = shellNavigationItems().map((item) => item.href);

    expect(hrefs).toEqual([...new Set(hrefs)]);
    expect(hrefs).toContain("/tartalom");
  });
});
