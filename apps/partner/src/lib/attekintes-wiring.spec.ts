import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/*
  AZ ÁTTEKINTÉS A PORTÁL KEZDŐLAPJA (kártya 28f31715). A forrás szövegét olvassa, mint a szomszéd wiring specek: renderelő ehhez a
  csomaghoz ma nincs. MI PIROSÍT: a gyökér, a belépés vagy a logó nem az áttekintésre visz; nincs Áttekintés menüpont az első
  helyen; az oldal nem a szerver összesítőjét kéri; a lap nem mutatja meg az üres állapotot vagy a "mind" linket.
*/
const GYOKER = join(process.cwd(), "src");
const kod = (...ut: string[]) => readFileSync(join(GYOKER, ...ut), "utf8");

describe("az áttekintés bekötése", () => {
  it("a gyökér, a belépés és a logó az áttekintésre visz", () => {
    assert.match(kod("app", "page.tsx"), /redirect\("\/attekintes"\)/);
    const login = kod("app", "login", "page.tsx");
    assert.equal(
      (login.match(/router\.replace\("\/attekintes"\)/g) ?? []).length,
      2,
    );
    assert.doesNotMatch(login, /router\.replace\("\/hibajegyek"\)/);
    assert.match(
      kod("components", "portal-shell.tsx"),
      /<Link\s+href="\/attekintes"/,
    );
  });

  it("az Áttekintés az első menüpont, a Hibajegyek megmarad", () => {
    const menu = kod("components", "portal-shell.tsx");
    const elso = menu.indexOf('href: "/attekintes", label: "Áttekintés"');
    const hibajegy = menu.indexOf('href: "/hibajegyek", label: "Hibajegyek"');
    assert.ok(
      elso >= 0 && hibajegy > elso,
      "az Áttekintés a Hibajegyek előtt áll",
    );
  });

  it("az oldal a szerver összesítőjét kéri, és megmutatja az üres állapotot és a teljes lista linkjét", () => {
    assert.match(
      kod("lib", "api.ts"),
      /request<PartnerOverview>\("\/service\/partner-overview"\)/,
    );
    assert.match(
      kod("app", "(portal)", "attekintes", "page.tsx"),
      /<PartnerOverviewPage \/>/,
    );
    const lap = kod("components", "partner-overview.tsx");
    assert.match(lap, /partnerApi\.overview\(\)/);
    assert.match(lap, /Nincs teendője/);
    assert.match(lap, /todo\.count > todo\.items\.length/);
    assert.match(lap, /href=\{todo\.listHref\}/);
  });
});

// PR 2 (Újdonságok): a két lista megnyitása a látogatás, az áttekintés megmutatja az újakat
describe("az újdonságok bekötése", () => {
  it("a hibajegy- és a munkalap-lista megnyitáskor rögzíti a látogatást", () => {
    assert.match(
      kod("components", "ticket-list.tsx"),
      /partnerApi\.markSeen\("TICKETS"\)/,
    );
    assert.match(
      kod("components", "worksheet-list.tsx"),
      /partnerApi\.markSeen\("WORKSHEETS"\)/,
    );
    assert.match(kod("lib", "api.ts"), /"\/service\/partner-overview\/seen"/);
  });

  it("az áttekintés megmutatja az újdonságokat, és a teljes lista linkjét", () => {
    const lap = kod("components", "partner-overview.tsx");
    assert.match(lap, /data\?\.news\?\.length/);
    assert.match(lap, /href=\{news\.listHref\}/);
  });
});
