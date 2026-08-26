/**
 * Mit írhat a UNAS szinkron, és min nem nyúlhat.
 *
 * A szabály KÓDBAN áll, nem termékenként tárolva, és ez döntés volt, nem
 * kényelem: nincs olyan ismert üzleti eset, ahol ugyanaz a mező azonos
 * tulajdonos mellett másképp viselkedne. Amíg ilyen eset nincs, egy
 * termékenkénti beállítás csak annyit érne el, hogy ugyanazt a szabályt
 * ezerszer tároljuk, és ezerféleképpen lehessen elrontani.
 *
 * A dinamikus rész a `catalogAuthority` marad: AZ mondja meg, kié a termék.
 * Ez a fájl azt mondja meg, hogy a UNAS-é lévő terméken MELY MEZŐKET írhatja
 * a szinkron.
 */

export interface ProductOwnership {
  id: string;
  origin: string | null;
  catalogAuthority: string | null;
}

/**
 * A mezők, amiket a termék-szinkron ír egy UNAS-tulajdonú terméken.
 *
 * **Ez a lista LEÍRÁS. Nem őr, és ma semmit nem akadályoz meg.** Korábban az
 * állt itt, hogy mérce is egyben, és hogy ha valaki bővíti a szinkron
 * írás-halmazát anélkül, hogy ide felvenné, a policy-teszt megmondja. Ez nem
 * volt igaz, és 2026-08-27-én mérés cáfolta:
 *
 * - a szinkron közvetlenül ír (`transaction.product.update`), és ezt a listát
 *   nem nézi meg;
 * - a lista és az `isUnasWritableField` egyetlen hívója a saját tesztje;
 * - a teszt pedig egy MÁSIK, kézzel írt mezőlistát hasonlít ehhez, tehát
 *   önmagát ellenőrzi.
 *
 * Vagyis ha holnap valaki új mezőt kezd írni a szinkronban, sem ez a lista nem
 * változik, sem a teszt nem pirosodik ki. **Ezt kimondani azért fontosabb,
 * mint elhallgatni, mert a veszély nem a kódban van, hanem abban, hogy valaki
 * erre a bekezdésre hivatkozva dönt: "nyugodtan bővíthetjük, a teszt úgyis
 * megfogja."**
 *
 * Ami a lista MA is ér: leírja, mit ír a szinkron, és ez a leírás ma pontos.
 * Aki a mezőtulajdont akarja megérteni, innen indul.
 *
 * A valódi őrzés - hogy a szinkron írása ténylegesen ezen a listán menjen át -
 * külön munka, és a mezőtulajdon-körbe tartozik. Kártya: a386f828.
 *
 * Az ár szándékosan nincs a listán: az külön terület, és a `ProductVariant`
 * modellen ma egyetlen ár-mező sincs.
 */
export const UNAS_WRITABLE_PRODUCT_FIELDS = [
  "name",
  "description",
  "mirrorSource",
  "mirrorState",
  "sourceCreatedAt",
  "sourceUpdatedAt",
  "lastSyncedAt",
  "missingSince",
  "rawSourceHash",
  // Külön lépésben íródik, de ugyanaz a szinkron írja.
  "categoryId",
] as const;

export type UnasWritableProductField =
  (typeof UNAS_WRITABLE_PRODUCT_FIELDS)[number];

export function isUnasWritableField(field: string): boolean {
  return (UNAS_WRITABLE_PRODUCT_FIELDS as readonly string[]).includes(field);
}

/** Miért maradt ki egy termék a szinkronból. */
export type UnasSkipReason =
  /** Nem a UNAS-ból származik: helyi termék, amit valaki nálunk vett fel. */
  | "not-unas-origin"
  /** UNAS-ból jött, de a törzsadat gazdája már mi vagyunk. */
  | "acropora-authority"
  /** Hivatkozunk rá, de a termék nincs meg az adatbázisban. */
  | "missing";

export interface SkippedProduct {
  productId: string;
  reason: UnasSkipReason;
}

export interface UnasWritePartition {
  /** Amit a szinkron írhat. */
  writableIds: string[];
  /** Amit kihagy, okkal. Soha nem üres csendben: a hívó kiírja. */
  skipped: SkippedProduct[];
}

/**
 * Szétválasztja, mit írhat a szinkron és mit nem.
 *
 * Ez a függvény cserélte le azt a viselkedést, ami EGYETLEN idegen termék
 * miatt az EGÉSZ köteget eldobta: egy helyi termék a listában megállította a
 * webshop teljes szinkronját, és a bolt aznap nem kapott árukészletet. Egy
 * termék kihagyása a termék baja; egy köteg eldobása mindenkié.
 *
 * A kihagyás NEM néma: a hívó számolja és naplózza. Egy csendben kihagyott
 * termék pontosan úgy néz ki, mintha nem is lett volna a listában.
 */
export function partitionByUnasAuthority(
  requestedIds: readonly string[],
  products: readonly ProductOwnership[],
): UnasWritePartition {
  const byId = new Map(products.map((product) => [product.id, product]));
  const writableIds: string[] = [];
  const skipped: SkippedProduct[] = [];

  for (const productId of new Set(requestedIds)) {
    const product = byId.get(productId);
    if (!product) {
      skipped.push({ productId, reason: "missing" });
      continue;
    }
    if (product.origin !== "UNAS") {
      skipped.push({ productId, reason: "not-unas-origin" });
      continue;
    }
    if (product.catalogAuthority !== "UNAS") {
      skipped.push({ productId, reason: "acropora-authority" });
      continue;
    }
    writableIds.push(productId);
  }

  return { writableIds, skipped };
}

/** Egy sor a naplóba, a termékek azonosítójával. Érték nélkül semmit nem ér. */
export function describeSkipped(skipped: readonly SkippedProduct[]): string {
  const byReason = new Map<UnasSkipReason, string[]>();
  for (const entry of skipped) {
    const list = byReason.get(entry.reason) ?? [];
    list.push(entry.productId);
    byReason.set(entry.reason, list);
  }

  const labels: Record<UnasSkipReason, string> = {
    "not-unas-origin": "helyi termék",
    "acropora-authority": "Acropora a törzsadat gazdája",
    missing: "nincs meg az adatbázisban",
  };

  return [...byReason.entries()]
    .map(([reason, ids]) => `${labels[reason]}: ${ids.join(", ")}`)
    .join(" | ");
}
