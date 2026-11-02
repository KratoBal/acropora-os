import { Prisma } from "@acropora/database";
import {
  MISSING_INVOICE_CATEGORY_LABELS,
  MISSING_INVOICE_SOURCE_LABELS,
  MISSING_INVOICE_STATE_LABELS,
  type MissingInvoiceItem,
  type MissingInvoiceSortDirection,
  type MissingInvoiceSortField,
} from "@acropora/types";

/**
 * A HIÁNYZÓ SZÁMLÁK LISTÁJÁNAK RENDEZÉSE (Balázs, 2026-11-02 12:49 UTC: „akármelyik
 * szűrésben az oszlopok nevére kattintva lehessen rendezni”).
 *
 * A SZERVER RENDEZ, A LAPOZÁS ELŐTT: a lista lapozott (`month` szűr, majd lapoz),
 * tehát egy kliensen rendezés csak a látható 25 sort rendezné, és a „legnagyobb
 * összeg” nem a legnagyobb összeg lenne. A szűrt TELJES halmaz sorrendje számít.
 *
 * TÍPUS SZERINT, NEM SZÖVEGKÉNT:
 *  - dátum: a `ÉÉÉÉ-HH-NN` alak szövegként is időrendben rendez (a szerver ilyen
 *    alakban adja), ezért a kulcs maga a szöveg: nincs külön dátum-átalakítás;
 *  - összeg: számként, tizedes pontossággal (`Prisma.Decimal`), nem szövegként
 *    (a „900” nem előzheti meg az „11 000”-et). A PÉNZNEMET NEM VESZI FIGYELEMBE:
 *    a képernyőn látott számot rendezi (egy 100 EUR a 1 000 HUF elé kerül
 *    növekvőben); átszámolás nincs (acrobot, 2026-11-02 13:58: elég a látott szám);
 *  - név, kategória, forrás, állapot: magyar ábécé szerint, ékezettel (`hu`
 *    gyűjtő: az „Á” az „A” mellett áll, nem a „Z” után; „Cecília” a „Csaba” előtt,
 *    „Olga” az „Ödön” előtt), a KÉPERNYŐN LÁTOTT felirat szerint (nem az angol
 *    kulcs szerint);
 *  - számla száma: magyar gyűjtővel, a számjegyek számként (`INV-2` az `INV-10` előtt).
 *
 * ÜRES ÉRTÉK MINDIG A VÉGÉRE, növekvő és csökkenő sorrendben is: egy partner
 * nélküli tétel a „Z”-nél sem kerül a lista elejére. Egyenlő kulcsnál a lista
 * addigi sorrendje marad (stabil), tehát a lapozás két kérésen át is ugyanazt
 * adja.
 */
// az alap érzékenység: az ékezet számít (a < á), és a magyar tákolások (cs, gy, ö) a helyükön állnak
const COLLATOR = new Intl.Collator("hu", { numeric: true });

type Key = string | Prisma.Decimal | null;

function keyOf(item: MissingInvoiceItem, field: MissingInvoiceSortField): Key {
  const text = (value: string | null | undefined): string | null =>
    value && value.trim() ? value.trim() : null;
  switch (field) {
    case "date":
      return text(item.bookingDate);
    case "partner":
      return text(item.partner);
    case "category":
      return MISSING_INVOICE_CATEGORY_LABELS[item.category] ?? null;
    case "amount":
      return item.amount === "" ? null : new Prisma.Decimal(item.amount);
    case "invoice":
      return text(item.document?.number);
    case "source":
      return item.document
        ? (MISSING_INVOICE_SOURCE_LABELS[item.document.source] ?? null)
        : null;
    case "state":
      return MISSING_INVOICE_STATE_LABELS[item.state] ?? null;
  }
}

function compare(
  a: string | Prisma.Decimal,
  b: string | Prisma.Decimal,
): number {
  if (typeof a === "string" && typeof b === "string")
    return COLLATOR.compare(a, b);
  if (a instanceof Prisma.Decimal && b instanceof Prisma.Decimal)
    return a.comparedTo(b);
  return 0;
}

export function sortMissingInvoiceItems<T extends MissingInvoiceItem>(
  items: readonly T[],
  field: MissingInvoiceSortField | undefined,
  direction: MissingInvoiceSortDirection = "asc",
): T[] {
  if (!field) return [...items];
  const sign = direction === "desc" ? -1 : 1;
  return items
    .map((item, index) => ({ item, index, key: keyOf(item, field) }))
    .sort((a, b) => {
      // üres mindig a végén, a rendezés irányától függetlenül
      if (a.key === null && b.key === null) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      return compare(a.key, b.key) * sign || a.index - b.index;
    })
    .map((entry) => entry.item);
}
