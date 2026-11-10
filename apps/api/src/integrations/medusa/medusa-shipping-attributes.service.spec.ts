import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";
import type { MedusaShippingFlags } from "./medusa-shipping-attributes.policy.js";

const CSUPA_HAMIS: MedusaShippingFlags = {
  pickup_only: false,
  foxpost_forbidden: false,
  is_heavy: false,
  is_frozen: false,
};

/**
 * A NEGY ERTEK SZANDEKOSAN NEM EGYFORMA, es ezt egy kalibracio mondta meg.
 *
 * Merve (2026-09-07): amig a profil `isHeavy` es `isFrozen` mezoje EGYARANT
 * hamis volt, a ket mezo FELCSERELESE ezen a szinten lathatatlan maradt -- a
 * rontas csak a leképezes sajat tesztjet dontotte el. Ket azonos ertekű mezo
 * egy fixtureben annyi, mintha csak egy lenne.
 */
const PROFIL = {
  pickupOnly: true,
  foxpostForbidden: false,
  isHeavy: true,
  isFrozen: false,
};

function fakes(options: {
  link?: { productId: string; medusaProductId: string } | null;
  current?: MedusaShippingFlags;
}) {
  const hivasok: string[] = [];
  const kikuldott: MedusaShippingFlags[] = [];

  const links = {
    findByProductId: async () => {
      hivasok.push("findLink");
      return options.link === undefined
        ? { productId: "prod-os-1", medusaProductId: "prod_medusa_1" }
        : options.link;
    },
  } as unknown as MedusaProductLinkRepository;

  const medusa = {
    fetchShippingAttributes: async (productId: string) => {
      hivasok.push("fetch");
      return {
        id: null,
        product_id: productId,
        ...(options.current ?? CSUPA_HAMIS),
      };
    },
    setShippingAttributes: async (
      _productId: string,
      flags: MedusaShippingFlags,
    ) => {
      hivasok.push("set");
      kikuldott.push(flags);
      return { id: "shpatt_1", product_id: "prod_medusa_1", ...flags };
    },
  } as unknown as MedusaAdminClient;

  return {
    service: new MedusaShippingAttributesService(links, medusa),
    hivasok,
    kikuldott,
  };
}

/**
 * A HALLGATAS ITT DRAGA: a bolt szallitasi osztalya ezekbol a zaszlokbol dol
 * el, es egy at nem vitt `pickup_only` azt jelenti, hogy egy elo allat
 * FUTARRAL indulna el. Ezert a szolgaltatas minden agra NEVET ad, nem logikai
 * erteket -- a futtato ki tudja irni, MI tortent.
 */
describe("a szállítási jellemzők átvitele", () => {
  it("profil nélkül NEM ír, és megmondja, miért", async () => {
    const f = fakes({});

    const outcome = await f.service.project("prod-os-1", null, true);

    assert.deepEqual(outcome, { action: "skipped", reason: "no-profile" });
    // A BIZONYITEK: egyetlen halozati hivas sem tortent.
    assert.deepEqual(f.hivasok, []);
  });

  /**
   * A "NINCS PROFIL" ES A "MINDEN HAMIS" KET KULONBOZO ALLAPOT, es a
   * kulonbseg nem elmeleti: az elso azt jelenti, hogy SENKI NEM VIZSGALTA MEG
   * a terméket. Csupa hamisat kikuldeni azt allitana, hogy megneztuk, es nincs
   * korlatozas.
   */
  it("nincs bolti leképezés: sem olvasás, sem írás", async () => {
    const f = fakes({ link: null });

    const outcome = await f.service.project("prod-os-1", PROFIL, true);

    assert.deepEqual(outcome, { action: "skipped", reason: "no-link" });
    assert.deepEqual(f.hivasok, ["findLink"]);
  });

  it("az --apply nélküli futás olvas, de NEM ír", async () => {
    const f = fakes({});

    const outcome = await f.service.project("prod-os-1", PROFIL, false);

    assert.equal(outcome.action, "planned");
    assert.deepEqual(f.hivasok, ["findLink", "fetch"]);
    assert.deepEqual(f.kikuldott, []);
  });

  it("--apply mellett a NÉGY zászló megy ki, leképezve", async () => {
    const f = fakes({});

    const outcome = await f.service.project("prod-os-1", PROFIL, true);

    assert.equal(outcome.action, "applied");
    assert.deepEqual(f.kikuldott, [
      {
        pickup_only: true,
        foxpost_forbidden: false,
        is_heavy: true,
        is_frozen: false,
      },
    ]);
  });

  // a82ed229 C3: WHAT TURNS THIS RED: the OS row's locker flag not reaching a shop that knows it; the field sent
  // to a shop before commerce #677 (its strict validator would refuse the whole write); that loss left unsaid
  it("a csomagautomata-jelző kimegy a boltba, amelyik ismeri", async () => {
    const f = fakes({ current: { ...CSUPA_HAMIS, locker_unsuitable: false } });

    await f.service.project(
      "prod-os-1",
      { ...PROFIL, lockerUnsuitable: true },
      true,
    );

    assert.equal(f.kikuldott[0]?.locker_unsuitable, true);
  });

  it("a régi bolt nem kapja meg a mezőt, és a jelentés kimondja, hogy nem ment át", async () => {
    const f = fakes({});

    const outcome = await f.service.project(
      "prod-os-1",
      { ...PROFIL, lockerUnsuitable: true },
      true,
    );

    assert.equal("locker_unsuitable" in f.kikuldott[0]!, false);
    assert.match(
      outcome.action === "applied" ? outcome.flags : "",
      /nem ismeri a csomagautomata-jelzőt/,
    );
  });

  /**
   * ES AMI A JELENTEST BIZONYITEKKA TESZI: ha a bolti allapot MAR egyezett,
   * azt kimondjuk, es NEM irunk. Enelkul minden futas "kesz"-t mondana, es a
   * kimenetbol nem lehetne eldonteni, hogy a szabaly egyaltalan mukodik-e.
   */
  it("ha a bolti állapot már egyezik, nem ír, és ezt kimondja", async () => {
    const f = fakes({
      current: {
        pickup_only: true,
        foxpost_forbidden: false,
        is_heavy: true,
        is_frozen: false,
      },
    });

    const outcome = await f.service.project("prod-os-1", PROFIL, true);

    assert.equal(outcome.action, "unchanged");
    assert.deepEqual(f.hivasok, ["findLink", "fetch"]);
    assert.deepEqual(f.kikuldott, []);
  });
});

/**
 * A SZARMAZTATOTT BOLTI ATVETEL.
 *
 * A kategoria-fa MAGA a megnezes: ha a termek elo allat gyoker alatt all, akkor
 * VAN mondanivalonk, profil-sor nelkul is. Enelkul egy elo allat futarral
 * indulna el -- es Balazs szabalya szerint az egesz kosarra bolti atvetel jar.
 */
describe("a szállítási jellemzők származtatott bolti átvétele", () => {
  it("profil nélkül is kiküldjük, ha a kategória azt mondja", async () => {
    const f = fakes({});

    const outcome = await f.service.project("prod-os-1", null, true, true);

    assert.equal(outcome.action, "applied");
    assert.deepEqual(f.kikuldott, [
      {
        pickup_only: true,
        // A TOBBI HAROM ISMERETLEN, es a hianyuk NEM korlatozas.
        foxpost_forbidden: false,
        is_heavy: false,
        is_frozen: false,
      },
    ]);
  });

  /**
   * ES A KEZI JELOLES NEM TUDJA FELULIRNI: egy ember, aki kikapcsolja a bolti
   * atvetelt egy korallon, nem dontest hoz, hanem elront valamit, amit a fa
   * mond. A ket forras VAGY kapcsolatban all.
   */
  it("a kézi hamis NEM üti ki a származtatott igazat", async () => {
    const f = fakes({});

    await f.service.project(
      "prod-os-1",
      {
        pickupOnly: false,
        foxpostForbidden: false,
        isHeavy: true,
        isFrozen: false,
      },
      true,
      true,
    );

    assert.equal(f.kikuldott[0]?.pickup_only, true);
    // ES A KEZZEL JELOLT MEZO MEGMARAD: a szarmaztatas csak EGY mezot ir.
    assert.equal(f.kikuldott[0]?.is_heavy, true);
  });

  it("sem profil, sem származtatott érték: nem történik semmi", async () => {
    const f = fakes({});

    const outcome = await f.service.project("prod-os-1", null, true, false);

    assert.deepEqual(outcome, { action: "skipped", reason: "no-profile" });
    assert.deepEqual(f.hivasok, []);
  });

  /*
  KOTES-SOR NELKUL A SKU-PAR VISZI (kartya 2a7f2313). MI PIROSIT: ha a
  kotes-sor hianyaban a SKU-parral sem ir; ha a SKU-par felulirja a meglevo
  kotes-sort.
*/
  describe("a SKU-pár mint tartalék", () => {
    it("kötés-sor nélkül a SKU-pár bolti termékére ír", async () => {
      const f = fakes({ link: null });
      const outcome = await f.service.project(
        "prod-os-1",
        PROFIL,
        true,
        false,
        "prod_by_sku",
      );
      assert.deepEqual(
        [
          outcome.action,
          "medusaProductId" in outcome ? outcome.medusaProductId : null,
        ],
        ["applied", "prod_by_sku"],
      );
    });

    it("ha van kötés-sor, az nyer a SKU-pár ellen", async () => {
      const f = fakes({});
      const outcome = await f.service.project(
        "prod-os-1",
        PROFIL,
        true,
        false,
        "prod_by_sku",
      );
      assert.equal(
        "medusaProductId" in outcome ? outcome.medusaProductId : null,
        "prod_medusa_1",
      );
    });

    it("se kötés, se SKU-pár: kihagyja, mint eddig", async () => {
      const f = fakes({ link: null });
      const outcome = await f.service.project(
        "prod-os-1",
        PROFIL,
        true,
        false,
        null,
      );
      assert.deepEqual(outcome, { action: "skipped", reason: "no-link" });
    });
  });
});

/*
  AZ ELO ALLAT FAJTAJA A BOLTBA (V2.6, commerce S1a). MI PIROSIT: ha a fajta nem
  megy ki a boltba, amelyik ismeri; ha egy regi boltnak elkuldjuk (a szigoru
  validatora az EGESZ irast elutasitana, az elo allat pickup_only jelzojet is); ha a
  veszteseget nem mondja ki a jelentes; ha az azonos fajtat ujra kikuldi; ha a fajta
  torlese (a termek kikerult a gyokerbol) nem jut el a boltba.
*/
describe("az élő állat fajtája a boltba", () => {
  const ISMERI = {
    ...CSUPA_HAMIS,
    locker_unsuitable: false,
    livestock_kind: null,
  };

  it("a fajtát ismerő boltba kimegy", async () => {
    const f = fakes({ current: ISMERI });

    await f.service.project(
      "prod-os-1",
      PROFIL,
      true,
      true,
      undefined,
      "CORAL",
    );

    assert.equal(f.kikuldott[0]?.livestock_kind, "CORAL");
  });

  it("a régi bolt nem kapja meg a mezőt, és a jelentés kimondja, hogy nem ment át", async () => {
    const f = fakes({});

    const outcome = await f.service.project(
      "prod-os-1",
      PROFIL,
      true,
      true,
      undefined,
      "FISH",
    );

    assert.equal("livestock_kind" in f.kikuldott[0]!, false);
    assert.match(
      outcome.action === "applied" ? outcome.flags : "",
      /nem ismeri az élő állat fajtáját/,
    );
  });

  it("fajta nélkül a régi bolt semmi újat nem kap, és nincs megjegyzés", async () => {
    const f = fakes({});

    const outcome = await f.service.project("prod-os-1", PROFIL, true);

    assert.equal("livestock_kind" in f.kikuldott[0]!, false);
    assert.doesNotMatch(
      outcome.action === "applied" ? outcome.flags : "",
      /fajtáját/,
    );
  });

  it("ha a bolt már azt a fajtát tárolja, nem ír, és kimondja", async () => {
    const f = fakes({
      current: {
        ...ISMERI,
        pickup_only: true,
        is_heavy: true,
        livestock_kind: "CORAL",
      },
    });

    const outcome = await f.service.project(
      "prod-os-1",
      PROFIL,
      true,
      true,
      undefined,
      "CORAL",
    );

    assert.equal(outcome.action, "unchanged");
    assert.deepEqual(f.hivasok, ["findLink", "fetch"]);
  });

  it("ha a termék kikerült a gyökérből, a bolti fajta null-ra áll", async () => {
    const f = fakes({
      current: {
        ...ISMERI,
        pickup_only: true,
        is_heavy: true,
        livestock_kind: "CORAL",
      },
    });

    await f.service.project("prod-os-1", PROFIL, true, true, undefined, null);

    assert.equal(f.kikuldott[0]?.livestock_kind, null);
  });
});

/*
  A BOLTBAN MARADT FAJTA (kartya 4b30b373). MI PIROSIT: a proba-futas ir; a torles a tobbi zaszlot is kuldi (egy kozben
  kezzel atallitott zaszlot visszairna, barracuda #2353); az OS-termek keresese nem a kotes-sorbol megy.
*/
describe("a boltban maradt fajta letörlése", () => {
  const ROW = {
    id: "sa_1",
    product_id: "prod_medusa_9",
    pickup_only: true,
    foxpost_forbidden: false,
    is_heavy: true,
    is_frozen: false,
    locker_unsuitable: false,
    livestock_kind: "FISH" as const,
  };

  function kis() {
    const kikuldott: {
      productId: string;
      flags: Partial<MedusaShippingFlags>;
    }[] = [];
    const medusa = {
      setShippingAttributes: async (
        productId: string,
        flags: Partial<MedusaShippingFlags>,
      ) => {
        kikuldott.push({ productId, flags });
        return { id: "sa_1", product_id: productId, ...flags };
      },
      listShippingAttributes: async () => [ROW],
    } as unknown as MedusaAdminClient;
    const links = {
      findByMedusaProductId: async (id: string) =>
        id === "prod_medusa_9"
          ? { productId: "os-9", medusaProductId: id }
          : null,
    } as unknown as MedusaProductLinkRepository;
    return {
      service: new MedusaShippingAttributesService(links, medusa),
      kikuldott,
    };
  }

  it("proba-futasnal nem ir, es megmondja, mit kuldene", async () => {
    const f = kis();
    const outcome = await f.service.clearLeftoverKind(ROW, false);
    assert.equal(outcome.action, "planned");
    assert.match(outcome.flags, /élő állat: hal.*a fajta törlése/);
    assert.deepEqual(f.kikuldott, []);
  });

  it("--apply-jal CSAK a fajtat kuldi (reszleges frissites), a tobbi zaszlot nem", async () => {
    const f = kis();
    const outcome = await f.service.clearLeftoverKind(ROW, true);
    assert.equal(outcome.action, "applied");
    assert.deepEqual(f.kikuldott, [
      { productId: "prod_medusa_9", flags: { livestock_kind: null } },
    ]);
  });

  it("az OS-termeket a kotes-sorbol keresi, es null-t ad, ha nincs", async () => {
    const f = kis();
    assert.equal(await f.service.osProductOfShop("prod_medusa_9"), "os-9");
    assert.equal(await f.service.osProductOfShop("prod_ismeretlen"), null);
    assert.deepEqual(await f.service.listShopShippingAttributes(), [ROW]);
  });
});

/*
  A SZARMAZTATAS JELOLOJE A SZOLGALTATASBAN (commerce #724, kartya c603774e). MI PIROSIT: a jelolo kimegy a boltba, amelyik nem
  ismeri (a szigoru validator az egesz irast, az elo allat atvetelet is elutasitana); a profilban kimondott atvetel is
  "levezetettnek" jelolodik (tudatos ertek, nem levezetett); egy jelolo nelkuli, mar igaz bolti sorra a kor ujra ir (minden
  korben); a jelolt sor, amit mar nem mi vezetunk le, nem kapja le a jelolot; a torles iras elott nem olvassa ujra a sort, es
  egy kozben kezzel atallitott erteket levesz; egy proba-futas ir.
*/
describe("a származtatott átvétel jelölője", () => {
  const CSAK_ATVETEL: MedusaShippingFlags = {
    pickup_only: true,
    foxpost_forbidden: false,
    is_heavy: false,
    is_frozen: false,
    locker_unsuitable: false,
    livestock_kind: null,
  };

  it("a jelölőt ismerő boltba kimegy: a kategóriából levezetett átvétel jelölt, a profilban kimondott nem", async () => {
    const levezetett = fakes({
      current: {
        ...CSUPA_HAMIS,
        locker_unsuitable: false,
        livestock_kind: null,
        pickup_only_derived: false,
      },
    });
    await levezetett.service.project("prod-os-1", null, true, true);
    assert.equal(levezetett.kikuldott[0]?.pickup_only_derived, true);

    const profilbol = fakes({
      current: {
        ...CSUPA_HAMIS,
        locker_unsuitable: false,
        livestock_kind: null,
        pickup_only_derived: false,
      },
    });
    await profilbol.service.project(
      "prod-os-1",
      {
        pickupOnly: true,
        foxpostForbidden: false,
        isHeavy: false,
        isFrozen: false,
      },
      true,
      true,
    );
    assert.equal(profilbol.kikuldott[0]?.pickup_only, true);
    assert.equal(profilbol.kikuldott[0]?.pickup_only_derived, false);
  });

  it("a régi bolt (nincs jelölő mező a válaszában) nem kapja meg a mezőt", async () => {
    const f = fakes({
      current: {
        ...CSUPA_HAMIS,
        locker_unsuitable: false,
        livestock_kind: null,
      },
    });
    await f.service.project("prod-os-1", null, true, true);
    assert.equal(f.kikuldott.length, 1);
    assert.equal("pickup_only_derived" in f.kikuldott[0]!, false);
  });

  it("a bolti sor már igaz, de jelölő nélküli (kézi vagy régi): a kör nem írja újra, és nem veszi át", async () => {
    const f = fakes({
      current: { ...CSAK_ATVETEL, pickup_only_derived: false },
    });
    const outcome = await f.service.project("prod-os-1", null, true, true);
    assert.equal(outcome.action, "unchanged");
    assert.deepEqual(f.kikuldott, []);
  });

  it("a jelölt sor, amit már a profil is kimond: a jelölő levétele megy, az átvétel marad", async () => {
    const f = fakes({
      current: { ...CSAK_ATVETEL, pickup_only_derived: true },
    });
    const outcome = await f.service.project(
      "prod-os-1",
      {
        pickupOnly: true,
        foxpostForbidden: false,
        isHeavy: false,
        isFrozen: false,
      },
      true,
      true,
    );
    assert.equal(outcome.action, "applied");
    assert.equal(f.kikuldott[0]?.pickup_only, true);
    assert.equal(f.kikuldott[0]?.pickup_only_derived, false);
  });

  describe("a származtatott átvétel levétele", () => {
    const ROW = {
      id: "sa_1",
      product_id: "prod_medusa_9",
      pickup_only: true,
      pickup_only_derived: true,
      foxpost_forbidden: false,
      is_heavy: true,
      is_frozen: false,
      locker_unsuitable: false,
      livestock_kind: null,
    };

    function kis(friss: Partial<MedusaShippingFlags> | null) {
      const kikuldott: {
        productId: string;
        flags: Partial<MedusaShippingFlags>;
      }[] = [];
      let olvasas = 0;
      const medusa = {
        fetchShippingAttributes: async (productId: string) => {
          olvasas += 1;
          return { ...ROW, ...friss, id: "sa_1", product_id: productId };
        },
        setShippingAttributes: async (
          productId: string,
          flags: Partial<MedusaShippingFlags>,
        ) => {
          kikuldott.push({ productId, flags });
          return { id: "sa_1", product_id: productId, ...flags };
        },
      } as unknown as MedusaAdminClient;
      return {
        service: new MedusaShippingAttributesService(
          {} as unknown as MedusaProductLinkRepository,
          medusa,
        ),
        kikuldott,
        olvasasok: () => olvasas,
      };
    }

    it("CSAK az átvételt és a jelölőt küldi, a többi zászlót nem", async () => {
      const f = kis(null);
      const outcome = await f.service.clearLeftoverKind(ROW, true, {
        kind: false,
        pickup: true,
      });
      assert.equal(outcome.action, "applied");
      assert.match(outcome.flags, /a származtatott bolti átvétel levétele/);
      assert.deepEqual(f.kikuldott, [
        {
          productId: "prod_medusa_9",
          flags: { pickup_only: false, pickup_only_derived: false },
        },
      ]);
    });

    it("fajtával együtt egy írásban megy a kettő; csak fajta kérésnél nem olvas újra, és az átvételhez nem nyúl", async () => {
      const both = kis(null);
      await both.service.clearLeftoverKind(
        { ...ROW, livestock_kind: "FISH" },
        true,
        { kind: true, pickup: true },
      );
      assert.deepEqual(both.kikuldott[0]?.flags, {
        livestock_kind: null,
        pickup_only: false,
        pickup_only_derived: false,
      });
      const csakFajta = kis(null);
      await csakFajta.service.clearLeftoverKind(
        { ...ROW, livestock_kind: "FISH" },
        true,
      );
      assert.deepEqual(csakFajta.kikuldott[0]?.flags, { livestock_kind: null });
      assert.equal(csakFajta.olvasasok(), 0);
    });

    it("iras elott ujra olvas: ha a sor kozben jelolo nelkuli lett (kezzel atallitva), nem nyul hozza", async () => {
      const f = kis({ pickup_only_derived: false });
      const outcome = await f.service.clearLeftoverKind(ROW, true, {
        kind: false,
        pickup: true,
      });
      assert.equal(outcome.action, "unchanged");
      assert.deepEqual(f.kikuldott, []);
      assert.equal(f.olvasasok(), 1);
    });

    it("ha kozben az atvetel mar nincs bekapcsolva, nem ir; a fajta torlese ilyenkor is megy", async () => {
      const f = kis({ pickup_only: false });
      const outcome = await f.service.clearLeftoverKind(
        { ...ROW, livestock_kind: "FISH" },
        true,
        { kind: true, pickup: true },
      );
      assert.equal(outcome.action, "applied");
      assert.deepEqual(f.kikuldott[0]?.flags, { livestock_kind: null });
    });

    it("proba-futasnal nem olvas es nem ir, es megmondja, mit kuldene", async () => {
      const f = kis(null);
      const outcome = await f.service.clearLeftoverKind(ROW, false, {
        kind: false,
        pickup: true,
      });
      assert.equal(outcome.action, "planned");
      assert.deepEqual(f.kikuldott, []);
      assert.equal(f.olvasasok(), 0);
    });
  });
});
