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
 * AKI ÚJ ESZKÖZ TULAJDONOSÁNAK VÁLASZTHATÓ -- SZŰKEBB, MINT A FENTI, ÉS EZ A
 * KÜLÖNBSÉG SZÁNDÉKOS.
 *
 * A törölt partnert töröltnek AKARTUK: nem lehetett fizikailag törölni, mert egy
 * régi bejegyzés hivatkozik rá, de a választókban nem lehet ott (a tulajdonos
 * kérése, 2026-08-21). Új eszközt tehát nem rendelhetünk hozzá.
 *
 * A LISTA HATÓKÖRE (`assetOwnerScopeWhere`) VISZONT NEM KAPJA MEG EZT. Egy
 * törölt partnernél álló eszköz FIZIKAILAG OTT VAN, és a szerelő listájáról
 * eltüntetni pont az a hibaosztály, amit ez a fájl máshol is kerül: nem hibásnak
 * látszó lista, hanem hiányos. A kettő tehát KÉT szabály, nem egy -- ezért áll
 * két konstansban.
 *
 * MA A VISELKEDÉS UGYANEZ LENNE E SOR NÉLKÜL IS, mert a törlés az `isActive`
 * mezőt is hamisra állítja. Ez viszont ESIK, nem ki van mondva: ha valaha
 * keletkezik újraaktiváló út (ma nincs), a törölt partner szó nélkül
 * visszakerülne a választóba.
 */
export const SERVICE_OWNER_PICKABLE_WHERE = {
  ...SERVICE_OWNER_WHERE,
  deletedAt: null,
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
  department: {
    select: {
      id: true,
      code: true,
      name: true,
      parentId: true,
      customerId: true,
    },
  },
  aquarium: true,
  parentAsset: true,
  _count: { select: { childAssets: true } },
} satisfies Prisma.AssetInclude;

/**
 * AMI EGY DOKUMENTUM OSSZEFOGLALOJAHOZ KELL, ES AMI NEM.
 *
 * A `content` SZANDEKOSAN HIANYZIK, es ezert kell nevesitett lista, nem
 * `include`: a bajtok legfeljebb 10 MB-osak, es egyetlen olyan ut sincs, ahol
 * az osszefoglalo hasznalna oket. Egy `include` minden skalar mezot visszahoz,
 * tehat csendben behuzna a teljes fajlt is.
 *
 * A LISTA AZERT ALL EGY HELYEN, mert ket ut olvassa (az adatlap dokumentum-
 * listaja es a feltoltes visszaolvasasa), es a ketto kulon romlana el. Amikor
 * a tartalom kesobb kulon taroloba kerul, ez az egy hely valtozik.
 */
export const assetDocumentSummarySelect = {
  id: true,
  type: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  createdAt: true,
  uploadedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.AssetDocumentSelect;

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
    select: assetDocumentSummarySelect,
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.AssetInclude;

export type AssetSummaryRow = Prisma.AssetGetPayload<{
  include: typeof assetSummaryInclude;
}>;

export type AssetDetailRow = Prisma.AssetGetPayload<{
  include: typeof assetDetailInclude;
}>;
