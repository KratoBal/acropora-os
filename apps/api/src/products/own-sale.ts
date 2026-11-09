import type { Prisma } from "@acropora/database";

/**
 * A változat SAJÁT akciója (T4.1-D3, `ProductVariant.sellingSale*`). A három mező
 * együtt áll vagy együtt hiányzik (az akció-író egyszerre írja őket), az ablak
 * FÉLIG NYITOTT: `[startsAt, endsAt)`.
 */
export interface OwnSaleRow {
  sellingSaleGrossPrice: Prisma.Decimal | null;
  sellingSaleStartsAt: Date | null;
  sellingSaleEndsAt: Date | null;
}

/**
 * FUT-E MOST A VÁLTOZAT SAJÁT AKCIÓJA. EGY helyen, mert három olvasója van, és
 * mindnek ugyanazt kell mondania: az árvetítés (`resolvePriceSource`), az
 * ár-szerkesztő előzmény-sora és az Omnibus csökkentés-kezdete. Ha kettő eltérne,
 * a bolt az akciós árat mutatná, az előzmény pedig a rendeset.
 *
 * A tükörrel ELLENTÉTBEN itt nincs nyitott határ: a saját akció mindig kezdettel
 * és véggel íródik, tehát egy hiányzó mező nem állandó akciót jelent, hanem azt,
 * hogy nincs akció. A vég pillanatában már a rendes ár él, ahogy az akció-író és
 * a rendes ár őre is olvassa.
 */
export function isOwnSaleActive(sale: OwnSaleRow, now: Date): boolean {
  return (
    sale.sellingSaleGrossPrice !== null &&
    sale.sellingSaleStartsAt !== null &&
    sale.sellingSaleEndsAt !== null &&
    sale.sellingSaleStartsAt <= now &&
    now < sale.sellingSaleEndsAt
  );
}
