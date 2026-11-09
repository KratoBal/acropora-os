import { webshopBrandPath } from "../../products/redirect/redirect-path.js";
import {
  brandIsShown,
  type OsBrandForShop,
} from "./medusa-brand-module.policy.js";
import {
  decidePublication,
  isDiscontinued,
  type ProductPublicationState,
} from "./medusa-publication.policy.js";

/**
 * HOVA MEHET EGY RÉGI TERMÉKCÍM A BOLTBAN (d707cf5f, A9; acrobot 44922).
 *
 * A `UrlRedirect` tábla azt őrzi, melyik régi cím melyik termékhez tartozik; a
 * kiküldött lista viszont azt mondja meg, hova érkezik ma a vevő. A kettő elválik,
 * ha a terméknek NINCS lapja a kirakaton: akkor a 301 egy 404-re vinne (mérve
 * 2026-11-09, 129 régi cím a teszt kirakaton). A tábla ezért érintetlen marad (ha
 * a termék visszatér, a szabály magától visszaáll), és a döntés a kiküldéskor
 * születik, termékenként:
 *
 *   page    a terméknek van lapja: értékesíthető, vagy kifutott (a kirakat
 *           "nem kapható" lapja, V4.2) -> a szabály marad
 *   brand   nincs lapja, de a márkájának van -> 301 a márkalapra
 *   gone    egyik sincs -> 410
 *
 * A LAP AZ OS SAJÁT SZABÁLYÁBÓL JÖN, nem a bolt visszaolvasásából: ugyanaz a
 * `decidePublication` és `isDiscontinued`, amiből a termékvetítés a státuszt és a
 * kifutott jelölőt írja. Vetítés nélkül (nincs Medusa-kötés) nincs lap.
 */
export type RedirectTarget = "page" | "brand" | "gone";

export interface RedirectProductState {
  /** Van-e a terméknek Medusa-kötése (`ExternalReference`, MEDUSA, Product). */
  linked: boolean;
  publication: ProductPublicationState;
  /** A UNAS csatorna-sor `productUrl`-je: a kifutott jelölő feltétele. */
  unasProductUrl: string | null;
  brand: OsBrandForShop | null;
}

export function productRedirectTarget(
  product: RedirectProductState | undefined,
): RedirectTarget {
  if (product?.linked) {
    const dontes = decidePublication(product.publication);
    if (
      dontes.sellable ||
      isDiscontinued(dontes.reason, product.unasProductUrl)
    )
      return "page";
  }
  return product && brandIsShown(product.brand) ? "brand" : "gone";
}

/** A 410-es sor: nincs cél, a cél a forrás maga (a commerce validátora így fogadja). */
export const GONE_STATUS = 410;

export interface RedirectRow {
  sourcePath: string;
  destinationPath: string;
  httpStatus: number;
}

/**
 * EGY TERMÉK-SZABÁLY KIKÜLDÖTT ALAKJA. A márkát csak `brand` döntésnél olvassa, és
 * akkor a `productRedirectTarget` már ellenőrizte, hogy van lapja.
 */
export function shopRedirectRow(
  rule: RedirectRow,
  target: RedirectTarget,
  product: RedirectProductState | undefined,
): RedirectRow {
  if (target === "brand" && product?.brand)
    return {
      sourcePath: rule.sourcePath,
      destinationPath: webshopBrandPath(product.brand.slug),
      httpStatus: 301,
    };
  if (target === "gone")
    return {
      sourcePath: rule.sourcePath,
      destinationPath: rule.sourcePath,
      httpStatus: GONE_STATUS,
    };
  return rule;
}

/** Egy tárolt szabály a gazdájával: ebből dől el, termék-szabály-e. */
export interface StoredRedirectRule extends RedirectRow {
  reason: string;
  entityType: string | null;
  entityId: string | null;
}

/**
 * TERMÉK-SZABÁLY: a backfill vagy a slug-csere írta egy termékre, és a termék
 * lapjára mutat. A kézi szabályt nem bíráljuk felül: azt ember írta, ő tudja, hova.
 */
export function isProductPageRule<R extends StoredRedirectRule>(
  rule: R,
): rule is R & { entityId: string } {
  return (
    rule.entityType === "PRODUCT" &&
    rule.reason !== "MANUAL" &&
    Boolean(rule.entityId) &&
    rule.destinationPath.startsWith("/hu/termek/")
  );
}

/** A kiküldendő lista: a termék-szabály a döntés szerint, a többi változatlanul. */
export function shopRedirects(
  rules: readonly StoredRedirectRule[],
  products: ReadonlyMap<string, RedirectProductState>,
): (RedirectRow & { target?: RedirectTarget })[] {
  return rules.map((rule) => {
    const sor: RedirectRow = {
      sourcePath: rule.sourcePath,
      destinationPath: rule.destinationPath,
      httpStatus: rule.httpStatus,
    };
    if (!isProductPageRule(rule)) return sor;
    const product = products.get(rule.entityId);
    const target = productRedirectTarget(product);
    return { ...shopRedirectRow(sor, target, product), target };
  });
}
