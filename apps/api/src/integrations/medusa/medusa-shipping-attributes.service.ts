import { Injectable } from "@nestjs/common";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import type { LivestockKind } from "./medusa-livestock.policy.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  describeShippingFlags,
  shippingFlagsDiffer,
  shippingFlagsFromProfile,
  type MedusaShippingFlags,
  type OsShippingProfile,
} from "./medusa-shipping-attributes.policy.js";

/**
 * A SZALLITASI JELLEMZOK ATVITELE A BOLTBA.
 *
 * === AMIT EZ AZ UT LEZAR ===
 *
 * A bolt a kosar szallitasi osztalyat NEGY kimondott zaszlobol szamolja
 * (`pickup_only`, `foxpost_forbidden`, `is_heavy`, `is_frozen`), es ezek a
 * zaszlok termekenkent allnak egy sajat rekordban. Az ertekek az OS-ben
 * keletkeznek (a szallitasi-jellemzok kartya irja oket), es MA SEMMI nem viszi
 * at oket -- a Commerce modell sajat megjegyzese szerint "Acropora OS
 * synchronizes by product id", az OS-ben viszont nulla talalat volt erre.
 */
export type ShippingAttributesOutcome =
  /**
   * Nincs profil-sor ES nincs szarmaztatott korlat: senki nem vizsgalta meg a
   * terméket, es a kategoriaja sem mond rola semmit. Nem irunk.
   */
  | { action: "skipped"; reason: "no-profile" }
  /** Nincs bolti lekepezes: a termek meg nincs kint. Nem irunk. */
  | { action: "skipped"; reason: "no-link" }
  /** A bolti allapot MAR egyezett. Nem irtunk, es ezt ki is mondjuk. */
  | { action: "unchanged"; medusaProductId: string; flags: string }
  /** Kikuldtuk. */
  | { action: "applied"; medusaProductId: string; flags: string }
  /** Proba-futas: ezt kuldtuk VOLNA. */
  | { action: "planned"; medusaProductId: string; flags: string };

@Injectable()
export class MedusaShippingAttributesService {
  constructor(
    private readonly links: MedusaProductLinkRepository,
    private readonly medusa: MedusaAdminClient,
  ) {}

  /**
   * EGY TERMEK ATVITELE.
   *
   * A `profile` a HIVOTOL jon, nem innen kerdezzuk le: a lekerdezes a
   * futtatoban all, a dontes itt, es igy a dontes adatbazis nelkul merheto.
   *
   * A `apply` HAMIS az alapertelmezes, es ez nem ovatoskodas: ez a parancs a
   * BOLTBA ir, es egy iras, ami veletlenul indul el, nem vonhato vissza egy
   * ujrafuttatassal -- a regi ertekeket mar senki nem tudja.
   */
  /** A bolt termékeinek SKU-ja, lapozva (a CLI párosításához). */
  listShopSkus(offset: number, limit: number) {
    return this.medusa.listProductSkus(offset, limit);
  }

  /** A bolt minden szallitasi-jellemzo sora (olvasas), a boltban maradt fajtak kereseshez. */
  listShopShippingAttributes() {
    return this.medusa.listShippingAttributes();
  }

  /** Melyik OS-termek tartozik a bolti termekhez a kotes-sor szerint, vagy null. */
  async osProductOfShop(shopProductId: string): Promise<string | null> {
    return (
      (await this.links.findByMedusaProductId(shopProductId))?.productId ?? null
    );
  }

  /**
   * A BOLTBAN MARADT FAJTA ES SZARMAZTATOTT ATVETEL LETORLESE (kartyak 4b30b373, c603774e): a bolti sor `livestock_kind`-ja
   * null lesz, es/vagy a `pickup_only` (a jelolovel egyutt) hamis; a tobbi zaszlo valtozatlan. Csak olyan sorra hivd, aminek
   * az OS-ben mar nincs elo allat besorolasa (a hivo dont). Proba-futasnal (`apply` hamis) nem ir, es megmondja, mit
   * kuldene. CSAK a kert mezoket kuldi (reszleges frissites).
   *
   * Az atvetelt iras ELOTT ujra olvassa a sort: ha kozben mar nem (igaz es jelolt), nem nyul hozza, mert egy ember kozben
   * atallithatta (`unchanged`). A jelolo nelkuli, kezi ertek igy sem veheto le.
   */
  async clearLeftoverKind(
    row: MedusaShippingFlags & { product_id: string },
    apply: boolean,
    clear: { kind: boolean; pickup: boolean } = { kind: true, pickup: false },
  ): Promise<{
    action: "planned" | "applied" | "unchanged";
    medusaProductId: string;
    flags: string;
  }> {
    const parts = (what: { kind: boolean; pickup: boolean }) =>
      [
        what.kind ? "a fajta törlése" : null,
        what.pickup ? "a származtatott bolti átvétel levétele" : null,
      ]
        .filter((part): part is string => part !== null)
        .join(", ");
    const flags = `${describeShippingFlags(row)} -> ${parts(clear)}`;
    if (!apply)
      return { action: "planned", medusaProductId: row.product_id, flags };
    let what = clear;
    if (what.pickup) {
      const fresh = await this.medusa.fetchShippingAttributes(row.product_id);
      if (!(fresh.pickup_only === true && fresh.pickup_only_derived === true))
        what = { ...what, pickup: false };
    }
    if (!what.kind && !what.pickup)
      return {
        action: "unchanged",
        medusaProductId: row.product_id,
        flags,
      };
    // CSAK A KERT MEZOK mennek (a bolt route-ja reszleges frissitest fogad): a tobbi zaszlot, amit kozben valaki a Medusa
    // adminban atallitott, nem irjuk vissza (barracuda, #2353 review)
    await this.medusa.setShippingAttributes(row.product_id, {
      ...(what.kind ? { livestock_kind: null } : {}),
      ...(what.pickup
        ? { pickup_only: false, pickup_only_derived: false }
        : {}),
    });
    return {
      action: "applied",
      medusaProductId: row.product_id,
      flags: `${describeShippingFlags(row)} -> ${parts(what)}`,
    };
  }

  /**
   * A MAR BEKAPCSOLT ATVETEL JELOLESE AZ OS SAJATJAKENT (kartya c603774e, az egyszeri, atnezett visszatoltes): a bolti sor
   * `pickup_only`-ja igaz es jelolo nelkuli volt, mostantol az OS jelolt ertekeve valik, es a termek elo allat besorolasanak
   * megszunesekor a levetel lepese leveszi. Csak a jelolo megy (es a bolt `adopt` kapcsoloja, ami a sorra nem kerul).
   * Iras elott ujra olvassa a sort: ha kozben mar nem (igaz es jelolo nelkuli), nem nyul hozza.
   */
  async adoptPickupMark(
    row: { product_id: string },
    apply: boolean,
  ): Promise<{
    action: "planned" | "applied" | "unchanged";
    medusaProductId: string;
  }> {
    if (!apply) return { action: "planned", medusaProductId: row.product_id };
    const fresh = await this.medusa.fetchShippingAttributes(row.product_id);
    if (!(fresh.pickup_only === true && fresh.pickup_only_derived !== true))
      return { action: "unchanged", medusaProductId: row.product_id };
    await this.medusa.setShippingAttributes(row.product_id, {
      pickup_only_derived: true,
      adopt_pickup_only_derived: true,
    });
    return { action: "applied", medusaProductId: row.product_id };
  }

  async project(
    osProductId: string,
    profile: OsShippingProfile | null,
    apply: boolean,
    /**
     * A KATEGORIABOL SZARMAZTATOTT BOLTI ATVETEL.
     *
     * === MIERT VALTOZTATJA MEG A "NINCS PROFIL -> KIHAGYJUK" SZABALYT ===
     *
     * A profil hianya azt jelenti, hogy SENKI NEM NEZTE MEG a terméket. A
     * szarmaztatott ertek viszont MAGA a megnezes: a kategoria-fa megmondja,
     * hogy elo allatrol van szo. Ilyenkor tehat VAN mondanivalonk, profil-sor
     * nelkul is -- es ha nem irnank ki, egy elo allat futarral indulna el.
     *
     * A ket forras egyesitese VAGY kapcsolat: a kezi jeloles NEM tudja
     * felulirni a szarmaztatottat. Egy ember, aki kikapcsolja a bolti atvetelt
     * egy korallon, nem "dontest hoz", hanem elront valamit, amit a fa mond.
     */
    derivedPickupOnly = false,
    /**
     * A bolti termék azonosítója SKU-párosításból, ha nincs kötés-sor (kártya
     * 2a7f2313: a teszt bolt 1492 termékéből egyiknek sincs, és az external_id
     * egy korábbi OS-állapoté). A kötés-sor, ha van, elsőbbséget kap.
     */
    bySku?: string | null,
    /**
     * AZ ELO ALLAT FAJTAJA A KATEGORIABOL (V2.6, kartya f4e4832b): a harom
     * gyoker egyike, vagy `null`, ha nem elo allat (vagy tobb gyoker alatt all).
     * A bolt csak a vevoi visszaigazolas akklimatizacios szakaszahoz kapja.
     */
    livestockKind: LivestockKind | null = null,
  ): Promise<ShippingAttributesOutcome> {
    if (!profile && !derivedPickupOnly)
      return { action: "skipped", reason: "no-profile" };

    const found = await this.links.findByProductId(osProductId);
    const link = found ?? (bySku ? { medusaProductId: bySku } : null);
    if (!link) return { action: "skipped", reason: "no-link" };

    const wanted: MedusaShippingFlags = shippingFlagsFromProfile(
      {
        /**
         * A HIANYZO PROFIL MEZOI HAMISAK, es ez NEM ugyanaz, mint a fenti
         * "kihagyjuk" ag: ide csak akkor jutunk el, ha a szarmaztatott ertek
         * IGAZ, tehat van mit mondanunk. A tobbi harom mezo ilyenkor tenyleg
         * ismeretlen -- es a hianyuk NEM korlatozas.
         */
        pickupOnly: (profile?.pickupOnly ?? false) || derivedPickupOnly,
        foxpostForbidden: profile?.foxpostForbidden ?? false,
        isHeavy: profile?.isHeavy ?? false,
        isFrozen: profile?.isFrozen ?? false,
        lockerUnsuitable: profile?.lockerUnsuitable ?? false,
      },
      livestockKind,
    );
    const leiras = describeShippingFlags(wanted);

    /**
     * A JELENLEGI ALLAPOT LEKERDEZESE -- ES EZ NEM SPOROLAS.
     *
     * A parancs kimenete csak akkor bizonyit, ha meg tudja mondani, MI
     * TORTENT. A WYSIWYG szabalynal ezt megmertuk: az EREDMENY onmagaban
     * semmit nem bizonyitott, mert a bolt alapertelmezese ugyanaz volt, mint a
     * szandekunk -- a "mar igy allt" es a "most allitottuk be" KULONBSEGE
     * volt a bizonyitek.
     */
    const current = await this.medusa.fetchShippingAttributes(
      link.medusaProductId,
    );
    /*
      A BOLT, AMI MÉG NEM ISMERI A CSOMAGAUTOMATA-JELZŐT (commerce #677 előtt). A szigorú validátora az egész
      írást elutasítaná, ha a mezőt küldenénk, tehát csak akkor megy, ha a bolt saját válasza hozza. Így a két
      oldal telepítési sorrendje nem számít: a régi bolt a négy régi jelzőt kapja, és a jelentés kimondja, ha a
      csomagautomata-jelzőt nem tudta átvinni.
    */
    const shopKnowsLocker = "locker_unsuitable" in current;
    /*
      UGYANEZ A FAJTARA (commerce V2.6 S1a): a bolt szigoru validatora egy ismeretlen `livestock_kind` miatt az
      EGESZ irast elutasitana, vagyis az elo allat `pickup_only` jelzoje is elakadna. A mezo ezert csak akkor
      megy, ha a bolt SAJAT valasza hozza (az S1a utan a "nincs rekord" alapertelmezes is `null`-t ad, tehat
      a kulcs ott van). A regi bolt a korabbi jelzoket kapja, es a jelentes kimondja, ha a fajta nem ment at.
    */
    const shopKnowsKind = "livestock_kind" in current;
    const {
      locker_unsuitable: lockerUnsuitable,
      livestock_kind: wantedKind,
      ...withoutNewer
    } = wanted;
    /*
      A SZARMAZTATAS JELOLOJE (commerce #724, kartya c603774e): az atvetel akkor az OS-e, ha a kategoria mondja, es a
      profil-sor nem mondja ki maga (egy profilban kimondott ertek tudatos, nem levezetett). UGYANUGY, mint a tobbi uj mezo:
      csak akkor megy, ha a bolt SAJAT valasza hozza, mert a szigoru validator az egesz irast elutasitana. A jelolot a bolt
      csak olyan ertekre teszi, amit az iras maga kapcsol be, vagy ami mar jelolt: egy kezzel bekapcsolt erteket az OS
      ugyanazzal az ertekkel sem vehet at, es azt a jelolo nelkuli sort a kor nem is irja ujra (`shippingFlagsDiffer`).
    */
    const shopKnowsMark = "pickup_only_derived" in current;
    const markWanted = derivedPickupOnly && !(profile?.pickupOnly ?? false);
    const payload: MedusaShippingFlags = {
      ...withoutNewer,
      ...(shopKnowsLocker ? { locker_unsuitable: lockerUnsuitable } : {}),
      ...(shopKnowsKind ? { livestock_kind: wantedKind ?? null } : {}),
      ...(shopKnowsMark ? { pickup_only_derived: markWanted } : {}),
    };
    const notes = [
      !shopKnowsLocker && lockerUnsuitable
        ? "a bolt még nem ismeri a csomagautomata-jelzőt, nem ment át"
        : null,
      !shopKnowsKind && wantedKind
        ? "a bolt még nem ismeri az élő állat fajtáját, nem ment át"
        : null,
    ].filter((note): note is string => note !== null);
    const flags = notes.length ? `${leiras} (${notes.join("; ")})` : leiras;

    if (!shippingFlagsDiffer(current, payload))
      return {
        action: "unchanged",
        medusaProductId: link.medusaProductId,
        flags,
      };

    if (!apply)
      return {
        action: "planned",
        medusaProductId: link.medusaProductId,
        flags,
      };

    await this.medusa.setShippingAttributes(link.medusaProductId, payload);
    return {
      action: "applied",
      medusaProductId: link.medusaProductId,
      flags,
    };
  }
}
