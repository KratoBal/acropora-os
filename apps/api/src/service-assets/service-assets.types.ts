import type { Prisma } from "@acropora/database";

/**
 * KI VÁLASZTHATÓ ÚJ ESZKÖZ TULAJDONOSÁNAK.
 *
 * Csak az aktív, SZERVIZ-jelölt partner. A lista korábban minden aktív vevőt és
 * minden aktív partnert visszaadott, tehát a webshopos vevők is felkerültek a
 * szerviz eszköz-űrlap első mezőjébe, ahol nincs mit keresniük (Balázs
 * bejelentése, 2026-08-25).
 *
 * Külön konstans, és nem a lekérdezésbe írt objektum, mert így MÉRHETŐ: egy
 * teszt, ami a tárolót hívja, adatbázist kívánna; ez a feltétel viszont
 * önmagában is állítható, és pont ez az a sor, amit el lehet rontani.
 */
export const SERVICE_OWNER_WHERE = {
  isActive: true,
  isService: true,
} as const;

/**
 * UGYANAZ A FELTÉTEL, A MÁSODIK HASZNÁLATI HELYÉN.
 *
 * A fenti szabály eddig egy helyen élt: azon a listán, amiből új eszközhöz
 * tulajdonost lehet választani. Az ESZKÖZ-LISTA nem használta, tehát a telefonon
 * a szerelő a webshopos vevők eszközeit is látta. Ugyanaz a bejelentés
 * (2026-08-25), ugyanaz a fogalom, csak a másik oldalon.
 *
 * A szűrő EXPLICIT, és nem alapértelmezés: ugyanezt a végpontot használja a
 * webes nyilvántartás is, ahol a TELJESSÉG az érték, és egy csendben szűkített
 * lista pontosan az a hibaosztály, amit sehol nem akarunk -- nem hibásnak
 * látszó lista, hanem rossz sorokat tartalmazó. A hívó mondja meg, mit kér.
 *
 * A `supplier: { is: ... }` alak a vevő-tulajdonosú eszközt is kizárja, mert
 * annak nincs partnere. Ez szándékos: a szerelő listája a szerviz-partnerek
 * eszközeié.
 */
export function assetOwnerScopeWhere(
  scope: "SERVICE_PARTNER" | undefined,
): Prisma.AssetWhereInput {
  return scope === "SERVICE_PARTNER"
    ? { supplier: { is: { ...SERVICE_OWNER_WHERE } } }
    : {};
}

export const assetSummaryInclude = {
  customer: true,
  supplier: true,
  customerAddress: true,
  aquarium: true,
  parentAsset: true,
  _count: { select: { childAssets: true } },
} satisfies Prisma.AssetInclude;

export const assetDetailInclude = {
  ...assetSummaryInclude,
  productVariant: { include: { product: true } },
  childAssets: { orderBy: [{ name: "asc" as const }, { id: "asc" as const }] },
  events: {
    include: { actorUser: true },
    orderBy: { occurredAt: "desc" as const },
    take: 100,
  },
  documents: {
    select: {
      id: true,
      type: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      sha256: true,
      createdAt: true,
      uploadedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.AssetInclude;

export type AssetSummaryRow = Prisma.AssetGetPayload<{
  include: typeof assetSummaryInclude;
}>;

export type AssetDetailRow = Prisma.AssetGetPayload<{
  include: typeof assetDetailInclude;
}>;
