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
