import type { ProductDetail } from "./product-catalog.js";

/**
 * A TERMÉK ÁRA A SZÁMLA TÉTELÉBE (Balázs a stage-en, 2026-09-30: ha a tételt a
 * termékekből választja, töltse ki az árat is, ÁFA-kulccsal, ha a terméken van;
 * ár nélkül maradjon üres, ne nulla).
 *
 * === MELYIK ÁR, ÉS MIÉRT A GAZDA DÖNT ===
 *
 * A UNAS tükör ára a gazdaság átvétele után BEFAGY: a legutolsó bolti árat
 * őrzi, a miénkről semmit nem tud. Ezért, ugyanúgy, mint a Medusa-vetítésnél
 * (`resolvePriceSource`, Balázs döntése 2026-09-04):
 *
 *   UNAS gazda      a tükör NETTÓ ára, a tükör pénznemében. Pontos érték, nem
 *                   kell visszaszámolni.
 *   ACROPORA gazda  a SAJÁT bruttó eladási ár a fő változaton. A számla a nettó
 *                   egységárat tárolja, ezért a szerkesztő bruttóból számol
 *                   vissza (`szamlazzUnitNetFromGross`), és jelzi, ha pontosan
 *                   nem jön ki.
 *   gazda nincs     nincs ár: nem tudjuk, melyik az igaz.
 *
 * A LISTAÁR, NEM AZ AKCIÓS (acrobot 25248): az akció a webshop kedvezménye.
 *
 * AZ ÁFA-KULCS a fő változatról jön, ennek híján a tükörből. Kulcs nélkül a
 * saját bruttóból nem számolható nettó, tehát akkor sincs ár, és a felület
 * kimondja, mi hiányzik. A tükör nettójánál a kulcs hiánya nem akadály: az ár
 * kitöltődik, a kulcs a sor alapértéke marad.
 *
 * A PÉNZNEM egyezzen a bizonylatéval: egy forint ár euró számlán nem ár.
 */
export type BillingProductPrice =
  | {
      kind: "NET";
      unitNet: string;
      vatRatePercent: string | null;
      source: "UNAS_MIRROR";
    }
  | {
      kind: "GROSS";
      unitGross: string;
      vatRatePercent: string;
      source: "OWN";
    }
  | { kind: "NONE"; reason: string };

/** "27.00" -> "27", "1000.0000" -> "1000": a mező ne a tárolás skáláját mutassa. */
function trim(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

function primaryVariant(product: ProductDetail) {
  return (
    product.variants.find((variant) => variant.sku === product.primarySku) ??
    product.variants.find((variant) => variant.isActive) ??
    product.variants[0] ??
    null
  );
}

export function billingProductPrice(
  product: ProductDetail,
  currency: string,
): BillingProductPrice {
  const none = (reason: string): BillingProductPrice => ({
    kind: "NONE",
    reason,
  });
  const variant = primaryVariant(product);
  const vatRate = variant?.vatRate ?? product.unasMirror?.vatRate ?? null;
  const sameCurrency = (priceCurrency: string | null) =>
    (priceCurrency ?? "").toUpperCase() === currency.toUpperCase();

  if (product.catalogAuthority === "UNAS") {
    const mirror = product.unasMirror;
    if (!mirror?.netPrice)
      return none("A terméknek nincs nettó ára a UNAS adataiban.");
    if (!sameCurrency(mirror.currency))
      return none(
        `A termék ára ${mirror.currency ?? "ismeretlen pénznemben"} van, a bizonylat ${currency}.`,
      );
    return {
      kind: "NET",
      unitNet: trim(mirror.netPrice),
      vatRatePercent: vatRate === null ? null : trim(vatRate),
      source: "UNAS_MIRROR",
    };
  }

  if (product.catalogAuthority === "ACROPORA") {
    if (!variant?.sellingGrossPrice)
      return none("A terméknek még nincs saját eladási ára.");
    if (!sameCurrency(variant.sellingPriceCurrency))
      return none(
        `A termék ára ${variant.sellingPriceCurrency ?? "ismeretlen pénznemben"} van, a bizonylat ${currency}.`,
      );
    if (vatRate === null)
      return none(
        "A terméknek nincs ÁFA-kulcsa, ezért a bruttó árából nem számolható nettó.",
      );
    return {
      kind: "GROSS",
      unitGross: trim(variant.sellingGrossPrice),
      vatRatePercent: trim(vatRate),
      source: "OWN",
    };
  }

  return none(
    "A termék törzsadatának gazdája nincs kimondva, ezért nem tudni, melyik ár érvényes.",
  );
}
