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
 *   moved   VÉGLEGESEN MEGSZŰNTNEK JELÖLT termék (kézi jelölő, V4.2), ami ma nem
 *           kapható, és van hova küldeni: 301 a jóváhagyott helyettesítő lapjára,
 *           ennek hiányában az elsődleges kategória lapjára
 *   page    a terméknek van lapja: értékesíthető, vagy kifutott (a kirakat
 *           "nem kapható" lapja, V4.2) -> a szabály marad
 *   brand   nincs lapja, de a márkájának van -> 301 a márkalapra
 *   gone    egyik sincs -> 410
 *
 * A LAP AZ OS SAJÁT SZABÁLYÁBÓL JÖN, nem a bolt visszaolvasásából: ugyanaz a
 * `decidePublication` és `isDiscontinued`, amiből a termékvetítés a státuszt és a
 * kifutott jelölőt írja. Vetítés nélkül (nincs Medusa-kötés) nincs lap.
 */
export type RedirectTarget = "moved" | "page" | "brand" | "gone";

/**
 * A VÉGLEGESEN MEGSZŰNTNEK JELÖLT TERMÉK ÁTIRÁNYÍTÁSA (V4.2, kártya 9d0523fa).
 *
 * `destination` a KÉSZ cél (a bolt saját útvonala), vagy `null`: nincs hova küldeni, és a termék úgy
 * viselkedik, mintha nem lenne jelölve. A termék saját lapja (`pagePath`) csak akkor van, ha a boltban van
 * lapja (Medusa-kötése és webshop-slug-ja van): arra külön sor kerül, hogy a lap is 301-et adjon.
 */
export interface DiscontinuedRedirect {
  pagePath: string | null;
  destination: string | null;
}

/** A jelölt termék cél-döntésének bemenete: egy helyettesítő, vagy egy kategória, ebben a sorrendben. */
export interface DiscontinuedRedirectInput {
  pagePath: string | null;
  replacement: {
    /** A helyettesítő lapja a boltban (`/hu/termek/slug`), vagy `null`, ha nincs webshop-slugja. */
    pagePath: string | null;
    linked: boolean;
    publication: ProductPublicationState;
    /** Maga is megszűnt-jelölt: lánc lenne, a bolt egy ugrást követ. */
    marked: boolean;
  } | null;
  /** Az elsődleges bolti kategória lapja (`/hu/categories/slug`), ha aktív és a Medusában van; különben `null`. */
  categoryPath: string | null;
}

/**
 * A CÉL: a helyettesítő lapja, ha MA megvehető (a bolt saját szabálya szerint, nem a jelölő időpontjában
 * érvényes állapot szerint), különben a kategória, különben semmi. A helyettesítő és a kategória a jelölés
 * UTÁN is megváltozhat (a helyettesítő inaktív lesz), ezért ez minden vetítésnél újra dől.
 */
export function discontinuedRedirect(
  input: DiscontinuedRedirectInput,
): DiscontinuedRedirect {
  const replacement = input.replacement;
  const replacementOpen =
    replacement !== null &&
    replacement.linked &&
    !replacement.marked &&
    replacement.pagePath !== null &&
    decidePublication(replacement.publication).sellable;
  return {
    pagePath: input.pagePath,
    destination: replacementOpen ? replacement.pagePath : input.categoryPath,
  };
}

export interface RedirectProductState {
  /** Van-e a terméknek Medusa-kötése (`ExternalReference`, MEDUSA, Product). */
  linked: boolean;
  publication: ProductPublicationState;
  /** A UNAS csatorna-sor `productUrl`-je: a kifutott jelölő feltétele. */
  unasProductUrl: string | null;
  brand: OsBrandForShop | null;
  /** A kézi "véglegesen megszűnt" jelölő (V4.2) és a belőle számolt cél; hiányzik, ha a termék nincs jelölve. */
  discontinued?: DiscontinuedRedirect | null;
}

export function productRedirectTarget(
  product: RedirectProductState | undefined,
): RedirectTarget {
  /*
    A JELÖLT, MA NEM KAPHATÓ TERMÉK MEGY ELŐRE, ÉS CSAK HA VAN HOVA. Egy még értékesíthető termék lapja
    marad, akkor is, ha valaki megjelölte: a 301 egy vevőt vinne el egy megvehető terméktől, és a jelölő
    gyakran a UNAS-szinkron előtt készül. Cél nélkül (nincs helyettesítő, nincs kategória) a jelölő semmit nem
    változtat.
  */
  if (
    product?.discontinued?.destination &&
    !(product.linked && decidePublication(product.publication).sellable)
  )
    return "moved";
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
  if (target === "moved" && product?.discontinued?.destination)
    return {
      sourcePath: rule.sourcePath,
      destinationPath: product.discontinued.destination,
      httpStatus: 301,
    };
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
  const rows = rules.map((rule) => {
    const sor: RedirectRow & { target?: RedirectTarget } = {
      sourcePath: rule.sourcePath,
      destinationPath: rule.destinationPath,
      httpStatus: rule.httpStatus,
    };
    if (!isProductPageRule(rule)) return sor;
    const product = products.get(rule.entityId);
    const target = productRedirectTarget(product);
    return { ...shopRedirectRow(sor, target, product), target };
  });
  return withMovedPages(rows, products);
}

/**
 * A VÉGLEGESEN MEGSZŰNT TERMÉK LAPJA IS 301-ET KAP, ÉS EZ A LÁNC-TILALOM MIATT KÉT LÉPÉS (V4.2).
 *
 * A bolt egy ugrást követ, és a commerce validátora a láncot elutasítja (a teljes lista nem megy ki). A régi
 * UNAS-címek eddig a termék lapjára mutattak (`/hu/termek/slug`); ha ez a lap maga forrás lesz, MINDEN sor,
 * ami rá mutatott, közvetlenül a célra kell, hogy mutasson: a termék-szabályok (fent, a döntés szerint), de a
 * kézi és a nem termék-szabályok is, mert egy kézi sor rá mutatása nem tehet láncot, ami az egész listát
 * elbuktatja. Ha a lap címe már forrás egy meglévő sorban, az a sor átíródik az újra.
 */
function withMovedPages(
  rows: (RedirectRow & { target?: RedirectTarget })[],
  products: ReadonlyMap<string, RedirectProductState>,
): (RedirectRow & { target?: RedirectTarget })[] {
  const pageRows: (RedirectRow & { target: "moved" })[] = [];
  for (const product of products.values()) {
    const moved = product.discontinued;
    if (!moved?.pagePath || !moved.destination) continue;
    if (productRedirectTarget(product) !== "moved") continue;
    pageRows.push({
      sourcePath: moved.pagePath,
      destinationPath: moved.destination,
      httpStatus: 301,
      target: "moved",
    });
  }
  if (pageRows.length === 0) return rows;
  const bySource = new Map(
    pageRows.map((row) => [row.sourcePath.toLowerCase(), row]),
  );
  const rewritten = rows
    .filter((row) => !bySource.has(row.sourcePath.toLowerCase()))
    .map((row) => {
      if (row.httpStatus === GONE_STATUS) return row;
      const hop = bySource.get(row.destinationPath.toLowerCase());
      return hop ? { ...row, destinationPath: hop.destinationPath } : row;
    });
  return [...rewritten, ...pageRows];
}
