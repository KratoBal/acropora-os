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
});
