import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  HUMAN_ROLES,
  MACHINE_ROLES,
  partnerMembership,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLES,
} from "./auth.js";
import type { UserRole } from "./auth.js";

describe("role permission mapping", () => {
  it("defines a permission set for every role", () => {
    assert.deepEqual(
      Object.keys(ROLE_PERMISSIONS).sort(),
      [...USER_ROLES].sort(),
    );
  });

  it("grants every permission to owner and admin", () => {
    const permissionCount = Object.keys(PERMISSIONS).length;
    assert.equal(ROLE_PERMISSIONS.OWNER.length, permissionCount);
    assert.equal(ROLE_PERMISSIONS.ADMIN.length, permissionCount);
  });

  it("keeps closed-worksheet amendment away from the service role", () => {
    assert.ok(ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.SERVICE_MANAGE));
    assert.ok(
      !ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );
    assert.ok(
      !ROLE_PERMISSIONS.MANAGER.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );
    assert.ok(
      ROLE_PERMISSIONS.OWNER.includes(PERMISSIONS.SERVICE_WORKSHEET_AMEND),
    );

    /**
     * A LATHATOSAGI HOZZARENDELES UGYANEZ AZ ALAK, DE MAS OKBOL.
     *
     * A `service.worksheet.amend` egy VESZELYES MUVELET; ez viszont azt
     * szabalyozza, KI MIT LAT. A ket tevedes sulya is mas: egy rossz javitas a
     * naploban latszik, egy rossz hozzarendeles CSENDBEN tobb jegyet mutat.
     *
     * ES A KIZARAS AZERT KAP SAJAT ALLITAST, mert a MANAGER lista TILTOLISTA az
     * osszes jogkor felett: egy uj kulcs MAGATOL a MANAGER-hez kerul. Ha valaki
     * a kizarast kiveszi, semmi nem hibazik -- a vezetok csendben megkapjak a
     * jogot, es a lista tobb sort ad, ami helyes valasznak nez ki.
     */
    assert.ok(
      !ROLE_PERMISSIONS.MANAGER.includes(PERMISSIONS.SERVICE_VISIBILITY_ASSIGN),
      "a láthatósági hozzárendelés bekerült a MANAGER jogai közé -- " +
        "a tiltólistából kiesett, és ez csendben bővíti a vezetők látókörét",
    );
    assert.ok(
      ROLE_PERMISSIONS.OWNER.includes(PERMISSIONS.SERVICE_VISIBILITY_ASSIGN),
    );
  });

  it("lets the service role see partners without editing them", () => {
    assert.ok(ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.PARTNERS_VIEW));
    assert.ok(!ROLE_PERMISSIONS.SERVICE.includes(PERMISSIONS.PARTNERS_MANAGE));
  });

  /**
   * Partner access used to hang off the purchasing permissions, and the
   * supplier endpoints were moved onto the new pair. Anyone who could reach
   * partners before must still reach them, otherwise the split quietly takes
   * away access that nobody decided to take away -- and the only symptom would
   * be a colleague locked out of a screen they used yesterday.
   */
  it("takes partner access away from nobody who had it", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      if (permissions.includes(PERMISSIONS.PURCHASING_VIEW)) {
        assert.ok(
          permissions.includes(PERMISSIONS.PARTNERS_VIEW),
          `${role} could see partners before and cannot now`,
        );
      }
      if (permissions.includes(PERMISSIONS.PURCHASING_MANAGE)) {
        assert.ok(
          permissions.includes(PERMISSIONS.PARTNERS_MANAGE),
          `${role} could edit partners before and cannot now`,
        );
      }
    }
  });

  it("keeps warehouse permissions scoped to warehouse work", () => {
    assert.ok(
      ROLE_PERMISSIONS.WAREHOUSE.includes(PERMISSIONS.INVENTORY_MANAGE),
    );
    assert.ok(!ROLE_PERMISSIONS.WAREHOUSE.includes(PERMISSIONS.FINANCE_MANAGE));
  });
});

describe("permission helpers", () => {
  it("checks one permission", () => {
    assert.equal(hasPermission("SERVICE", PERMISSIONS.SERVICE_MANAGE), true);
    assert.equal(hasPermission("SERVICE", PERMISSIONS.USERS_MANAGE), false);
  });

  it("checks whether any permission is available", () => {
    assert.equal(
      hasAnyPermission("SALES", [
        PERMISSIONS.SETTINGS_MANAGE,
        PERMISSIONS.ORDERS_MANAGE,
      ]),
      true,
    );
    assert.equal(
      hasAnyPermission("VIEWER", [
        PERMISSIONS.SETTINGS_MANAGE,
        PERMISSIONS.USERS_MANAGE,
      ]),
      false,
    );
  });

  it("checks whether every permission is available", () => {
    assert.equal(
      hasAllPermissions("WAREHOUSE", [
        PERMISSIONS.INVENTORY_VIEW,
        PERMISSIONS.INVENTORY_MANAGE,
      ]),
      true,
    );
    assert.equal(
      hasAllPermissions("WAREHOUSE", [
        PERMISSIONS.INVENTORY_MANAGE,
        PERMISSIONS.FINANCE_MANAGE,
      ]),
      false,
    );
  });
});

/**
 * A SZEREPEK, AMIKET A "mindenki" ALOL KIVETTUNK, ES MIERT.
 *
 * SERVICE -- Balazs 2026-09-02 08:39-i menu-listaja, ami TELJES lista, es az AI
 * teszt nincs rajta. Ez a 2026-08-26-i dontesben kimondott szukitesi feltetel
 * bekovetkezese, nem a felulirasa.
 */
const SZUKITETT: readonly UserRole[] = ["SERVICE"];

describe("AI_TEST_VIEW", () => {
  it("is held by every role, because that is what was asked for", () => {
    /**
     * "Most kapja meg mindenki" (Balázs, 2026-08-26), és ez NEM ugyanaz, mint
     * nem tenni semmit.
     *
     * A MANAGER az összes jogot megkapja egy tiltólista kivételével, tehát egy
     * új kulcs magától az OWNER, ADMIN és MANAGER kezébe kerül - a többi
     * szerepkör tételes listát kap. Ha csak az alapértelmezésre hagyatkoznánk,
     * a "mindenki" csendben háromra szűkülne, és senki nem venné észre, mert
     * a menüpont ott is látszana, ahol nézzük.
     *
     * A szűkítés feltételét is ő mondta ki: amikor a felhasználói
     * jogosultságokat rendezzük.
     *
     * EZ A FELTÉTEL 2026-09-02-ÁN TELJESÜLT, A SERVICE SZEREPRE. Balázs aznap
     * megadta a szervizes teljes menü-listáját ("ezen kívül nem kell másnak
     * látszania"), és az AI teszt nincs rajta. Ezért a SERVICE kikerült a
     * szabály alól -- nem a döntés felülírása, hanem a benne kimondott
     * feltétel bekövetkezése.
     *
     * A GÉPI SZEREPEK ugyanígy kivételt képeznek (`MACHINE_ROLES`): a mondat a
     * kollégákról szólt, gépi fiók akkor még nem létezett.
     *
     * AMIÉRT A KIVÉTEL-LISTA MELLÉ ÁLLÍTÁS IS KELL: egy kivétel-lista magától
     * nem tud elbukni, tehát egy odaírt szerep csendben kivenne bárkit. Ezért
     * az alsó állítás megköveteli, hogy a listán CSAK olyan szerep álljon, ami
     * tényleg nem kapja meg a jogot -- egy elavult vagy indokolatlan bejegyzés
     * így pirosít.
     */
    // A "MINDENKI" EMBERI SZEREPET JELENT, es ez most mar kiirva all
    // (`MACHINE_ROLES`), nem ennek a ciklusnak a belsejeben. A dontes 2026-08-26-an
    // szuletett, amikor gepi szerep meg nem letezett; egy agens-fiok, ami magatol
    // kap egy feluletet, csendben tagabb lenne, mint amiert letrehoztuk.
    //
    // A DARABSZAM ALLITAS NEM DISZ: enelkul egy elszabadult `MACHINE_ROLES`
    // kiuritene a ciklust, es az ures ciklus ZOLD. Igy viszont az a hiba is
    // pirosit, ami eppen a merest kapcsolna ki.
    assert.equal(HUMAN_ROLES.length, USER_ROLES.length - MACHINE_ROLES.length);
    assert.ok(HUMAN_ROLES.length > 0);

    const vart = HUMAN_ROLES.filter((role) => !SZUKITETT.includes(role));
    assert.ok(
      vart.length >= 4,
      `Csak ${vart.length} szerepre maradt allitas. Ez a kivetel-lista hibaja.`,
    );

    for (const role of vart) {
      assert.equal(
        hasPermission(role, PERMISSIONS.AI_TEST_VIEW),
        true,
        `${role} nem kapta meg az AI teszt-felület jogát`,
      );
    }

    // A KIVETEL-LISTA SEM AVULHAT EL: ha egy szerep ott all, de KAPJA a jogot,
    // akkor a bejegyzes indokolatlan, es a kovetkezo olvaso azt hinne, hogy
    // valaki szandekosan vette ki. (Ugyanaz az alak, mint a mobil tukornel a
    // bennragadt megfeleltetes.)
    const bennragadt = SZUKITETT.filter((role) =>
      hasPermission(role, PERMISSIONS.AI_TEST_VIEW),
    );
    assert.deepEqual(
      bennragadt,
      [],
      "Ezek a szerepek a szukitesi listan allnak, de MEGKAPJAK a jogot: " +
        bennragadt.join(", "),
    );
  });
});

/**
 * Minden teszthez oda van irva, MI PIROSITANA. Enelkul egy zold sor csak annyit
 * mond, hogy a kod lefutott -- nem azt, hogy megfog valamit. Ahol a hiba iranya
 * szamit, az is ki van irva: a "szeles" irany az, ami tobb sort engedne at.
 */
describe("partnerMembership", () => {
  it("a sajat kollegank egyik partnerhez sem tartozik", () => {
    // PIROSIT: ha a fuggveny egy hianyzo azonositot partner-hovatartozasnak
    // olvasna, vagy ha a ket NULL-t ketertelmunek nezne.
    assert.deepEqual(
      partnerMembership({ customerId: null, supplierId: null }),
      { kind: "internal" },
    );
  });

  it("a vevo-oldali fiok a vevo azonositojat viszi tovabb", () => {
    // PIROSIT: ha az azonosito elveszne az uton, vagy ha a masik oszlopot
    // olvasna. Az azonositora azert allitunk, es nem csak a kind-ra, mert a
    // szuro EZT az erteket fogja hasznalni.
    assert.deepEqual(
      partnerMembership({ customerId: "cus_1", supplierId: null }),
      { kind: "customer", customerId: "cus_1" },
    );
  });

  it("a partner-oldali fiok a partner azonositojat viszi tovabb", () => {
    // PIROSIT: ha a supplier ag atesne az internal agra. Ez a SZELES irany:
    // egy partner-fiok igy a mi kollegankent viselkedne.
    assert.deepEqual(
      partnerMembership({ customerId: null, supplierId: "sup_1" }),
      { kind: "supplier", supplierId: "sup_1" },
    );
  });

  it("mindket oszlop kitoltve: ketertelmu, es NEM valaszt egyet sem", () => {
    // PIROSIT: ha a fuggveny csendben valasztana az egyiket, vagy ha
    // internal-ra esne. Az adatbazis CHECK constraintje ezt az allapotot
    // tiltja, tehat ide jutni annyit tesz, hogy a megszoritas nincs meg vagy
    // az ertek nem az adatbazisbol jott -- es ilyenkor a legrosszabb valasz
    // az internal, mert egy torott sorbol a legszelesebb hozzaferest csinalna.
    assert.deepEqual(
      partnerMembership({ customerId: "cus_1", supplierId: "sup_1" }),
      { kind: "ambiguous" },
    );
  });

  it("az ures azonosito NEM olvasodik hianynak", () => {
    // PIROSIT: ha a fuggveny igazsagertek szerint dontene (`if (id)`), mert
    // akkor az ures sztring hianynak latszana, a hianyzo hovatartozas pedig a
    // mi kollegankat jelenti -- vagyis a legszelesebb hozzaferest. Jelenletre
    // vizsgalva olyan hovatartozas lesz belole, amire egy partner sem
    // illeszkedik, tehat a szuro semmit nem ad vissza. Mindket olvasat teved
    // az ertekrol; csak az egyik teved a BIZTONSAGOS iranyba.
    assert.deepEqual(partnerMembership({ customerId: "", supplierId: null }), {
      kind: "customer",
      customerId: "",
    });
  });

  it("a hianyzo mezo (undefined) hianynak szamit", () => {
    // PIROSIT: ha egy JSON-hataron atjott, mezo nelkuli objektum kivetelt
    // dobna, vagy ha a ket hianyzo mezot ketertelmunek nezne. A tipus nem
    // engedi az undefined-et, a futasido viszont talalkozhat vele.
    assert.deepEqual(
      partnerMembership({
        customerId: undefined,
        supplierId: undefined,
      } as unknown as { customerId: string | null; supplierId: string | null }),
      { kind: "internal" },
    );
  });
});

describe("a MANAGER jogkör-készlete rögzítve van", () => {
  /**
   * ALLAPOT, NEM SZABALY -- ES EZ SZANDEKOS.
   *
   * A kezenfekvo alak egy szabaly lett volna: "minden SZUK jogkor legyen kizarva
   * a MANAGER listabol". A baj vele, hogy a "szuk" fogalom A KODBAN NEM LETEZIK,
   * tehat egy ilyen allitas egy KEZZEL TARTOTT listat olvasna arrol, mi szamit
   * szuknek -- es akkor ugyanaz a hiba all elo egy szinttel feljebb: a kovetkezo
   * ember felvesz egy szuk jogkort, elfelejti felvenni a "szuk" listara, es az
   * allitas CSENDBEN atengedi.
   *
   * Egy orzo, ami kezzel tartott listat olvas, pontosan azt a hibat nem fogja
   * meg, ami letrehozta. (acrobot erve, 2026-09-03, es jobb, mint az enyem volt.)
   *
   * EZ HELYETTE A TENYLEGES KESZLETET rogziti, nev szerint. Egy UJ jogkor
   * felvetele ezt a sort PIROSRA donti -- barmelyik iranyba --, es a fejlesztonek
   * VALASZTANIA kell: felveszi ide, vagy kizarja a MANAGER listajabol.
   *
   * AZ ARA, KIMONDVA: minden jogkor-felvetelnel piros lesz ez a teszt. Ez nem
   * zaj, hanem a kikenyszeritett dontes -- es ha valaki zajnak erzi, az azt
   * jelenti, hogy ugy vesz fel jogkort, hogy nem gondolja vegig, ki kapja meg.
   *
   * ES A DIFFBEN IS LATSZIK: aki a listat bovíti, az a MANAGER korét bovíti, es
   * az atnezo ezt egy sorbol latja.
   */
  it("pontosan ezeket a jogokat tartalmazza, se többet, se kevesebbet", () => {
    assert.deepEqual(
      [...ROLE_PERMISSIONS.MANAGER].sort(),
      [
        "ai-test.view",
        "aquariums.manage",
        "aquariums.view",
        "content.manage",
        "content.view",
        "customers.manage",
        "customers.view",
        "dashboard.view",
        "finance.manage",
        "finance.view",
        "icp.manage",
        "icp.view",
        "inventory.manage",
        "inventory.view",
        "orders.manage",
        "orders.view",
        "partners.manage",
        "partners.view",
        "products.manage",
        "products.view",
        "purchasing.manage",
        "purchasing.view",
        "service.manage",
        "service.view",
        "tasks.view",
      ],
      "a MANAGER jogkör-készlete elmozdult -- ha új jogkör került be, döntsd el, " +
        "hogy a vezetők megkapják-e, és vezesd át itt VAGY a tiltólistán",
    );
  });
});
