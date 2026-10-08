import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isNavigationEntryVisible,
  navigationEntry,
  navigationIdsFor,
  NAVIGATION_ENTRIES,
  servedNavigationFeatures,
  visibleNavigationFor,
} from "./navigation.js";

describe("a menü közös forrása", () => {
  it("minden azonosítója egyedi", () => {
    const ids = NAVIGATION_ENTRIES.map((entry) => entry.id);

    // KONTROLL: a lista be is toltodott. Egy ures lista minden alabbi
    // allitason atmenne, es a "nincs utkozes" akkor semmit nem jelentene.
    assert.ok(
      ids.length >= 20,
      `Csak ${ids.length} tétel. Ez a betöltés hibája.`,
    );
    assert.deepEqual(ids, [...new Set(ids)]);
  });

  it("minden tétel legalább egy felületen megjelenik", () => {
    const sehol = NAVIGATION_ENTRIES.filter(
      (entry) => entry.surfaces.length === 0,
    ).map((entry) => entry.id);

    assert.deepEqual(
      sehol,
      [],
      "Ezek a tételek egyik felületen sem jelennek meg, tehát a szabályuk " +
        "senkire nem hat: " +
        sehol.join(", "),
    );
  });

  // Draft review is deliberately OWNER/ADMIN-only: SERVICE_MANAGE also belongs
  // to managers and partner accounts, who must not read original staff reports.
  // Keep both role exceptions explicit until a dedicated review permission exists.
  it("a két szerep-listás kivétel megnevezi, mi szünteti meg", () => {
    const szereplistasak = NAVIGATION_ENTRIES.filter(
      (entry) => entry.visibility.kind === "roles",
    );

    assert.deepEqual(
      szereplistasak.map((entry) => entry.id),
      ["service-drafts", "nav-integration-mobile"],
    );

    for (const entry of szereplistasak) {
      const rule = entry.visibility;
      assert.equal(rule.kind, "roles");
      if (rule.kind !== "roles") continue;
      assert.ok(
        rule.retiredBy.length > 40,
        `A(z) ${entry.id} szerep-listás ága nem mondja meg, mi szünteti meg.`,
      );
      assert.ok(rule.roles.length > 0, `A(z) ${entry.id} szerep-listája üres.`);
    }
  });

  /**
   * ISMERETLEN AZONOSÍTÓ: NEM LÁTSZIK.
   *
   * Ez NEM mond ellent annak, hogy egy új oldal alapértelmezetten látszik. Az a
   * szabály a menü-ADAT hiányáról szól (ott a jog dönt). Itt a kérdés maga
   * értelmetlen: egy azonosító, ami nincs a forrásban, nem egy tétel, amiről
   * nincs adatunk, hanem egyáltalán nem tétel.
   *
   * ÉS A POZITÍV KONTROLL MELLETTE: ugyanez a hívás IGAZAT ad egy létező
   * tételre. Enélkül a fenti sor akkor is zöld lenne, ha a függvény MINDIG
   * hamisat adna -- vagyis ha az egész menü eltűnt volna.
   */
  it("ismeretlen azonosítóra nem ad láthatóságot, ismertre igen", () => {
    assert.equal(
      isNavigationEntryVisible("nincs-ilyen-tetel", { role: "OWNER" }),
      false,
    );
    assert.equal(
      isNavigationEntryVisible("dashboard", { role: "OWNER" }),
      true,
    );
    assert.equal(navigationEntry("nincs-ilyen-tetel"), undefined);
  });

  /**
   * A SZŰKÍTÉS MAGA, MINDKÉT ÁGON, ÉS EZ A FÁJLBÓL HIÁNYZOTT.
   *
   * Mérve 2026-09-02: amikor a jog-ellenőrzés eredményét hatástalanná tettem
   * (`... || true`), ennek a csomagnak MIND A 31 tesztje zöld maradt. A hibát a
   * webes csomag háló-tesztje fogta meg -- vagyis épp ott nem volt állítás,
   * ahol a függvény lakik.
   *
   * AZ OK NEM FIGYELMETLENSÉG, HANEM AZ ÁLLÍTÁSOK IRÁNYA: minden korábbi sor a
   * MEGENGEDETT esetet nézte (létező azonosító, helyes felület), és egy
   * megengedett eset akkor is átmegy, ha MINDEN meg van engedve. A szűkítést
   * csak egy tiltott eset méri.
   *
   * MINDKÉT PÁR EGYÜTT ÁLL, mert a tagadás önmagában egy üres világon is igaz:
   * a `false` mellett ott a `true` ugyanarra a tételre, egy másik szereppel.
   */
  it("szűkít: akinek nincs joga, nem látja -- akinek van, igen", () => {
    // JOG-ALAPÚ ÁG. A SERVICE szerepnek nincs `users.manage` joga, az OWNER-nek van.
    assert.equal(isNavigationEntryVisible("users", { role: "SERVICE" }), false);
    assert.equal(isNavigationEntryVisible("users", { role: "OWNER" }), true);

    // SZEREP-LISTÁS ÁG. A SALES nincs a NAV-csempe listáján, az ADMIN igen.
    assert.equal(
      isNavigationEntryVisible("nav-integration-mobile", { role: "SALES" }),
      false,
    );
    assert.equal(
      isNavigationEntryVisible("nav-integration-mobile", { role: "ADMIN" }),
      true,
    );
  });

  /**
   * A "calculators" TÉTEL UGYANAZT A JOGOT HASZNÁLJA, MINT AZ "aquariums" --
   * szándékosan, ld. a `navigation.ts` "calculators" bejegyzésének
   * fejlécét. Ez az állítás a mai egybeesést méri, nem azt garantálja,
   * hogy a kettő örökre együtt marad.
   */
  it("a Kalkulátorok tétel ugyanazt a jogot nézi, mint az Akváriumok", () => {
    assert.equal(
      isNavigationEntryVisible("calculators", { role: "OWNER" }),
      true,
    );
    assert.equal(
      isNavigationEntryVisible("calculators", { role: "WAREHOUSE" }),
      false,
    );
    assert.equal(
      isNavigationEntryVisible("calculators", { role: "OWNER" }),
      isNavigationEntryVisible("aquariums", { role: "OWNER" }),
    );
  });

  it("felületenként külön szűr", () => {
    const web = navigationIdsFor({ role: "OWNER" }, "web");
    const mobil = navigationIdsFor({ role: "OWNER" }, "mobile");

    assert.ok(web.includes("dashboard"));
    assert.equal(mobil.includes("dashboard"), false);
    assert.ok(mobil.includes("nav-integration-mobile"));
    assert.equal(web.includes("nav-integration-mobile"), false);
  });

  it("a kapcsolós tétel csak bekapcsolt kapcsolóval és joggal látszik", () => {
    const on = new Set(["jev-product-enrichment"] as const);
    // KONTROLL: a tétel létezik, és kapcsolót vár
    assert.equal(
      navigationEntry("product-data-quality")?.feature,
      "jev-product-enrichment",
    );
    assert.equal(
      isNavigationEntryVisible("product-data-quality", { role: "OWNER" }),
      false,
    );
    assert.equal(
      isNavigationEntryVisible("product-data-quality", { role: "OWNER" }, on),
      true,
    );
    // a kapcsoló nem írja felül a jogot (SERVICE: nincs products.view)
    assert.equal(
      isNavigationEntryVisible("product-data-quality", { role: "SERVICE" }, on),
      false,
    );
    assert.ok(
      !navigationIdsFor({ role: "OWNER" }, "web").includes(
        "product-data-quality",
      ),
    );
    assert.ok(
      navigationIdsFor({ role: "OWNER" }, "web", on).includes(
        "product-data-quality",
      ),
    );
  });

  it("az Árajánlatok és a szövegrészlet-kezelő a `quotes` kapcsoló és a saját joga mögött áll", () => {
    const on = new Set(["quotes"] as const);
    for (const id of ["quotes", "quote-snippets", "quote-templates"]) {
      assert.equal(navigationEntry(id)?.feature, "quotes");
      assert.equal(isNavigationEntryVisible(id, { role: "OWNER" }), false);
      assert.equal(isNavigationEntryVisible(id, { role: "OWNER" }, on), true);
    }
    // SALES írhat ajánlatot, de szövegrészletet nem kezel
    assert.equal(
      isNavigationEntryVisible("quotes", { role: "SALES" }, on),
      true,
    );
    assert.equal(
      isNavigationEntryVisible("quote-snippets", { role: "SALES" }, on),
      false,
    );
    assert.equal(
      isNavigationEntryVisible("quote-templates", { role: "SALES" }, on),
      false,
    );
    // a kapcsoló nem ad jogot: VIEWER-nek nincs quotes.view
    assert.equal(
      isNavigationEntryVisible("quotes", { role: "VIEWER" }, on),
      false,
    );
  });

  it("a kliens a kiszolgált menüből olvassa vissza a kapcsolót, máshonnan nem", () => {
    const on = new Set(["jev-product-enrichment"] as const);
    assert.deepEqual([...servedNavigationFeatures(undefined)], []);
    assert.deepEqual(
      [...servedNavigationFeatures(visibleNavigationFor({ role: "OWNER" }))],
      [],
    );
    assert.deepEqual(
      [
        ...servedNavigationFeatures(
          visibleNavigationFor({ role: "OWNER" }, on),
        ),
      ],
      ["jev-product-enrichment"],
    );
    // ismeretlen azonosító nem kapcsol be semmit
    assert.deepEqual(
      [...servedNavigationFeatures([{ id: "nincs-ilyen" }])],
      [],
    );
  });
});
