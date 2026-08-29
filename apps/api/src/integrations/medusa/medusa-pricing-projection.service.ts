import { Injectable } from "@nestjs/common";

import {
  describeMedusaFailure,
  type MedusaAdminClient,
  type MedusaPriceRow,
  type MedusaVariantPriceRow,
} from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  decidePricingProjection,
  MEDUSA_CURRENCY_CODE,
  type PricingRefusal,
  type ProjectablePrice,
} from "./medusa-pricing.policy.js";

/**
 * Egy termék árának vetítése az Acropora OS-ből a Medusába.
 *
 * AZ AZONOSSÁG NEM AZ ÖSSZEG, HANEM AZ ÁR SORÁNAK AZONOSÍTÓJA, és ez a kör
 * legfontosabb mondata. A Medusa ár-frissítése TELJES CSERE: az `id` alapján
 * veti össze a beérkező listát a meglévővel, a nem szereplő sorokat TÖRLI, az
 * `id` nélkülieket pedig LÉTREHOZZA (`updatePriceSets_`). Vagyis egy `id`
 * nélkül küldött ár minden futáson töröl egy sort és létrehoz egy másikat -
 * miközben a DARABSZÁM VÁLTOZATLAN MARAD.
 *
 * Ezért nem a darabszám a mérce, hanem az azonosító: a második futás után
 * ugyanannak a sornak kell állnia, mint az első után. A jelentés ki is írja.
 *
 * AZ ÖSSZEG VÁLTOZATLANUL MEGY ÁT: az OS bruttó árat tárol, a bolt pedig a
 * forint árat adóval növeltnek veszi. A második állítás NEM a mi kódunkban
 * lakik, ezért minden futás előtt visszaolvassuk - lásd
 * `tax-inclusive-not-set`.
 */

export interface ProjectablePricedVariant {
  /** Az Acropora OS termékazonosítója. Ez a Medusa `external_id` is. */
  osProductId: string;
  /** A változat cikkszáma. A Medusa oldali változatot ezzel találjuk meg. */
  sku: string;
  price: ProjectablePrice;
}

export interface PricingProjectionReport {
  sku: string;
  /** Az OS-ben tárolt érték, szövegként, hogy ne veszítsen pontosságot. */
  sourceAmount: string;
  sourceCurrency: string;
  /** Amit ténylegesen elküldtünk. */
  medusaAmount: number;
  medusaCurrencyCode: string;
  variantId: string;
  /**
   * AZ ÁR SORÁNAK AZONOSÍTÓJA. Enélkül a jelentés nem bizonyít semmit: a
   * darabszám ugyanaz marad akkor is, ha minden futás újraépíti az árat.
   */
  priceId: string;
  result: "created" | "updated" | "no-change";
}

export type PricingProjectionStopReason =
  /** A termékhez nincs Medusa-leképezés. Előbb a termék-vetítés fusson. */
  | "no-product-link"
  /**
   * A bolt NEM adóval növeltnek veszi a forint árat.
   *
   * EZ AZ EGÉSZ KÖR CSENDES BUKÁSI MÓDJA, ezért van rá saját megállás. Az OS
   * bruttó árat tárol, és mi változatlanul küldjük. Ez akkor helyes, ha a
   * boltban a forintra `is_tax_inclusive` igaz. Ha valaki átállítja, semmi nem
   * hibázik: a bolt egyszerűen ráteszi az adót a mi bruttó árunkra, és a vevő
   * többet lát. Semmilyen darabszám és semmilyen visszaolvasott összeg nem
   * mutatná meg - csak ez az ellenőrzés.
   */
  | "tax-inclusive-not-set"
  /** A változat-keresés kimerítette a limitet. Csonkolt halmazon nem döntünk. */
  | "variant-lookup-truncated"
  /** A Medusa terméken nincs ilyen cikkszámú változat, sem élő, sem eltemetett. */
  | "variant-not-found"
  /** A cikkszám PUHÁN TÖRÖLT változaton ül, élő találat nincs. */
  | "variant-identity-chain-broken"
  /** Több élő változat viseli ugyanazt a cikkszámot. */
  | "ambiguous-variant"
  /**
   * A válaszból HIÁNYZOTT az árak mezője.
   *
   * NEM üres listaként olvassuk, és ez ugyanaz a szabály, mint a
   * készlet-láncnál: az üres lista azt állítaná, hogy nincs ára, a hiány
   * viszont azt jelenti, hogy nem kérdeztünk jól. A kettőből MÁS teendő
   * következik.
   */
  | "prices-not-returned"
  /** Ugyanazon a változaton több forint ár áll. Nem tudjuk, melyik a miénk. */
  | "ambiguous-price"
  /**
   * A price seten IDEGEN pénznemű ár is áll.
   *
   * MEGÁLLUNK, ÉS EZ A TERVEMHEZ KÉPEST VÁLTOZÁS. Először azt írtam, hogy a
   * vetítés majd „átengedi" az idegen sorokat, hogy a teljes csere ne törölje
   * ki őket. Ezt visszavontam: az átengedő ág MA NEM TUDNA LEFUTNI, mert a
   * stage-en nulla ilyen sor van, tehát egy soha nem mért út kerülne a kódba,
   * pont a legveszélyesebb helyre. Egy nem mért tartalék rosszabb, mint a
   * megállás.
   *
   * A megállás nem veszít semmit: idegen pénznemű ár ma nem keletkezik, és ha
   * egyszer keletkezik, az ÜZLETI változás, ami úgyis döntést igényel.
   */
  | "foreign-currency-price-present"
  /**
   * Az írás után az ár NEM volt ott, ahol lennie kellene.
   *
   * Azért van rá külön ok, mert a Medusa ezt CSENDBEN teszi: ha a változathoz
   * nem tartozik price set, a frissítő folyamat üres kapcsolat-listát kap, és
   * egyszerűen nem csinál semmit (`updateProductVariantsWorkflow`, a
   * `variantPriceSetLinks` üres ága). A hívás sikerrel tér vissza. Csak a
   * visszaolvasás mondja meg, hogy megtörtént-e.
   */
  | "write-not-visible"
  /** EGY OLVASÓ hívás elhasalt. Odaát biztosan nem változott semmi. */
  | "medusa-read-failed"
  /** EGY ÍRÓ hívás elhasalt. A cél oldali állapot BIZONYTALAN. */
  | "medusa-write-failed"
  /** A döntési modul utasította el az árat. Lásd `PricingRefusal`. */
  | PricingRefusal;

export type PricingProjectionOutcome =
  | { action: "projected"; report: PricingProjectionReport }
  | {
      action: "stopped";
      reason: PricingProjectionStopReason;
      details: string;
    };

@Injectable()
export class MedusaPricingProjectionService {
  constructor(
    private readonly links: MedusaProductLinkRepository,
    private readonly medusa: MedusaAdminClient,
  ) {}

  /**
   * Az adó-értelmezés a folyamat élettartamára megjegyezve.
   *
   * Nem termékenként kérdezzük: a beállítás egy futáson belül nem változik. A
   * HIBÁT viszont a hívó kapja el, nem ez a függvény - különben egy
   * pillanatnyi hálózati hiba az EGÉSZ futást megmérgezné, ahogy azt a
   * készlet-vetítésnél már egyszer megtanultuk.
   */
  private taxInclusive: boolean | undefined;

  private async resolveTaxInclusive(): Promise<boolean> {
    if (this.taxInclusive !== undefined) return this.taxInclusive;
    const rows = await this.medusa.listPricePreferences();
    /**
     * A PÉNZNEMRE szóló sort nézzük, nem a régióra szólót. A régió-szintű
     * beállítás felülírhatja, de azt csak akkor tudnánk értelmezni, ha azt is
     * tudnánk, melyik régióban jelenik meg a termék - és az ebben a körben
     * nincs a hatókörben. A pénznem-szintű sor a szűkebb, ellenőrizhető
     * állítás, és a stage-en mindkettő igaz.
     */
    const currencyRow = rows.find(
      (row) =>
        row.attribute === "currency_code" &&
        row.value?.toLowerCase() === MEDUSA_CURRENCY_CODE,
    );
    this.taxInclusive = currencyRow?.is_tax_inclusive === true;
    return this.taxInclusive;
  }

  async project(
    variant: ProjectablePricedVariant,
  ): Promise<PricingProjectionOutcome> {
    const stop = (
      reason: PricingProjectionStopReason,
      details: string,
    ): PricingProjectionOutcome => ({ action: "stopped", reason, details });

    const decision = decidePricingProjection(variant.price);
    if (!decision.send)
      return stop(
        decision.reason,
        `${variant.osProductId} (${variant.sku}): ${decision.details}`,
      );

    const link = await this.links.findByProductId(variant.osProductId);
    if (!link)
      return stop(
        "no-product-link",
        `${variant.osProductId}: nincs Medusa-leképezés ehhez a termékhez. ` +
          `Előbb a termék-vetítés fusson le (medusa:project). Az ár-vetítés ` +
          `terméket nem hoz létre.`,
      );

    let taxInclusive: boolean;
    try {
      taxInclusive = await this.resolveTaxInclusive();
    } catch (error) {
      return stop(
        "medusa-read-failed",
        `${variant.osProductId}: az ár-beállítások lekérdezése elhasalt ` +
          `(${describeMedusaFailure(error)}). Nem írtunk semmit.`,
      );
    }
    if (!taxInclusive)
      return stop(
        "tax-inclusive-not-set",
        `${variant.osProductId}: a boltban a ${MEDUSA_CURRENCY_CODE} pénznemre ` +
          `nincs adóval növelt ár beállítva (is_tax_inclusive). Az Acropora ` +
          `OS BRUTTÓ árat tárol, és változatlanul küldjük, tehát a bolt ` +
          `ráadná az adót: a vevő többet fizetne. Nem írtunk semmit, és nem ` +
          `is számoltunk át: a beállítás javítása egy sor, egy képlet nem az.`,
      );

    let found: Awaited<ReturnType<MedusaAdminClient["listVariantPrices"]>>;
    try {
      found = await this.medusa.listVariantPrices(link.medusaProductId);
    } catch (error) {
      return stop(
        "medusa-read-failed",
        `${variant.osProductId}: a változatok lekérdezése elhasalt a ` +
          `${link.medusaProductId} terméken (${describeMedusaFailure(error)}). ` +
          `Nem írtunk semmit.`,
      );
    }

    if (found.truncated)
      return stop(
        "variant-lookup-truncated",
        `${variant.osProductId}: a változat-keresés kimerítette a limitet ` +
          `(${found.rows.length} sor). Csonkolt halmazon nem döntünk: a ` +
          `"pontosan egy egyezés" ellenőrzés itt hamis nemleges választ adna.`,
      );

    const matched = matchVariant(found.rows, variant.sku);
    if ("error" in matched)
      return stop(matched.reason, `${variant.osProductId}: ${matched.error}`);

    const target = matched.variant;
    if (!target.prices)
      return stop(
        "prices-not-returned",
        `${variant.osProductId}: a válasz nem hozta a ${target.id} változat ` +
          `árait. Ezt NEM olvassuk üres listaként: az azt állítaná, hogy ` +
          `nincs ára, holott csak nem kérdeztünk jól.`,
      );

    const foreign = target.prices.filter(
      (row) => row.currency_code.toLowerCase() !== MEDUSA_CURRENCY_CODE,
    );
    if (foreign.length > 0)
      return stop(
        "foreign-currency-price-present",
        `${variant.osProductId}: a ${target.id} változaton idegen pénznemű ár ` +
          `is áll (${foreign.map((row) => row.currency_code).join(", ")}). A ` +
          `Medusa ár-frissítése TELJES CSERE, tehát a forint ár kiírása ezeket ` +
          `TÖRÖLNÉ. Nem írtunk semmit: idegen pénznem megjelenése üzleti ` +
          `változás, és döntést igényel.`,
      );

    const ours = target.prices.filter(
      (row) => row.currency_code.toLowerCase() === MEDUSA_CURRENCY_CODE,
    );
    if (ours.length >= 2)
      return stop(
        "ambiguous-price",
        `${variant.osProductId}: a ${target.id} változaton ${ours.length} ` +
          `forint ár áll (${ours.map((row) => row.id).join(", ")}). Nem ` +
          `dönthető el, melyik a miénk, és a rossz választás a másikat ` +
          `törölné.`,
      );

    const existing = ours[0];

    if (existing && existing.amount === decision.amount)
      return {
        action: "projected",
        report: buildReport(
          variant,
          decision.amount,
          target.id,
          existing.id,
          "no-change",
        ),
      };

    /**
     * A MEGLÉVŐ SOR AZONOSÍTÓJÁVAL megy, ha van. Enélkül a Medusa törölné a
     * régit és létrehozna egy újat: a végállapot helyesnek látszana, az
     * azonosság mégis elveszne minden futáson.
     */
    try {
      await this.medusa.setVariantPrices(link.medusaProductId, target.id, [
        {
          ...(existing ? { id: existing.id } : {}),
          currency_code: decision.currencyCode,
          amount: decision.amount,
        },
      ]);
    } catch (error) {
      return stop(
        "medusa-write-failed",
        `${variant.osProductId}: az ár beállítása elhasalt a ${target.id} ` +
          `változaton (${describeMedusaFailure(error)}). A cél oldali állapot ` +
          `BIZONYTALAN.`,
      );
    }

    /**
     * VISSZAOLVASÁS, ÉS NEM ÓVATOSKODÁS.
     *
     * A Medusa CSENDBEN nem csinál semmit, ha a változathoz nem tartozik price
     * set: a frissítő folyamat üres kapcsolat-listát kap, és a hívás sikerrel
     * tér vissza. Ezt egyedül a visszaolvasás fogja meg. Ugyanez adja meg az
     * ÚJ sor azonosítóját is, amit a jelentés kiír.
     */
    let after: Awaited<ReturnType<MedusaAdminClient["listVariantPrices"]>>;
    try {
      after = await this.medusa.listVariantPrices(link.medusaProductId);
    } catch (error) {
      return stop(
        "medusa-read-failed",
        `${variant.osProductId}: az írás megtörtént, de a visszaolvasás ` +
          `elhasalt (${describeMedusaFailure(error)}). A cél oldali állapot ` +
          `valószínűleg helyes, de NEM ellenőriztük.`,
      );
    }

    const written = after.rows
      .find((row) => row.id === target.id)
      ?.prices?.filter(
        (row) => row.currency_code.toLowerCase() === MEDUSA_CURRENCY_CODE,
      );

    if (
      !written ||
      written.length !== 1 ||
      written[0]!.amount !== decision.amount
    )
      return stop(
        "write-not-visible",
        `${variant.osProductId}: az írás sikerrel tért vissza, de a ` +
          `visszaolvasás nem ${decision.amount} összegű, egyetlen forint árat ` +
          `talált a ${target.id} változaton (${describeWritten(written)}). A ` +
          `Medusa üres price set kapcsolatnál CSENDBEN nem ír, ezért ezt ` +
          `külön ellenőrizzük.`,
      );

    return {
      action: "projected",
      report: buildReport(
        variant,
        decision.amount,
        target.id,
        written[0]!.id,
        existing ? "updated" : "created",
      ),
    };
  }
}

function describeWritten(rows: MedusaPriceRow[] | undefined): string {
  if (!rows) return "a válasz nem hozta az árakat";
  if (rows.length === 0) return "nulla forint ár áll rajta";
  return `${rows.length} sor: ${rows
    .map((row) => `${row.id}=${row.amount}`)
    .join(", ")}`;
}

function buildReport(
  variant: ProjectablePricedVariant,
  amount: number,
  variantId: string,
  priceId: string,
  result: PricingProjectionReport["result"],
): PricingProjectionReport {
  return {
    sku: variant.sku,
    sourceAmount: variant.price.sellingGrossPrice!.toString(),
    sourceCurrency: variant.price.sellingPriceCurrency!,
    medusaAmount: amount,
    medusaCurrencyCode: MEDUSA_CURRENCY_CODE,
    variantId,
    priceId,
    result,
  };
}

/**
 * A cikkszámhoz tartozó ÉLŐ változat, vagy a megállás oka.
 *
 * Ugyanaz a szétválasztás, mint a készlet-vetítésben: a cikkszám-index
 * RÉSZLEGES, tehát ugyanaz a cikkszám egyszerre ülhet egy élő és egy
 * eltemetett változaton, és a kettőt egy halmazban számolni téves „több
 * egyezés" választ adna.
 */
function matchVariant(
  rows: MedusaVariantPriceRow[],
  sku: string,
):
  | { variant: MedusaVariantPriceRow }
  | { error: string; reason: PricingProjectionStopReason } {
  const live = rows.filter((row) => !row.deleted_at && row.sku === sku);
  const buried = rows.filter((row) => row.deleted_at && row.sku === sku);

  if (live.length === 0 && buried.length > 0)
    return {
      reason: "variant-identity-chain-broken",
      error:
        `a ${sku} cikkszám PUHÁN TÖRÖLT változaton ül ` +
        `(${buried.map((row) => row.id).join(", ")}), és élő változat nem ` +
        `viseli. Nem írunk árat egy eltemetett sorra, és nem hozunk létre újat.`,
    };

  if (live.length === 0)
    return {
      reason: "variant-not-found",
      error: `a Medusa terméken nincs ${sku} cikkszámú változat.`,
    };

  if (live.length >= 2)
    return {
      reason: "ambiguous-variant",
      error:
        `több élő változat viseli a ${sku} cikkszámot ` +
        `(${live.map((row) => row.id).join(", ")}).`,
    };

  return { variant: live[0]! };
}
