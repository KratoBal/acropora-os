import type { Prisma } from "@acropora/database";

/**
 * AZ ÁR-KIKÜLDÉS SAJÁT NYILVÁNTARTÁSA (kártya 329f8a2e; murena tény-kommentje,
 * acrobot 27698).
 *
 * Az ütemező az árat a termék-vetítés UTÁN, ugyanabban a körben viszi ki, de az
 * esedékességet a termék-kötés `lastSyncedAt`-je hozza, és azt csak a
 * termék-vetítés írja. Ha egy körben a termék kiment, de az ára elbukott
 * (`tax-inclusive-not-set`, `ambiguous-price`, `medusa-write-failed`), a termék a
 * következő forrás-változásig nem esedékes, tehát az ár NEM próbálkozik újra: a
 * bolt a régi árat tartja, és a napló sem ismétli.
 *
 * SAJÁT SOR, NEM A TERMÉK-KÖTÉS METAADATA, ugyanabból az okból, mint a készletnél
 * (`medusa-inventory-sync.ts`): a termék-kötés `metadata`-ját a termék-vetítés
 * olvassa-írja, és két író ugyanazon a mezőn felülírná egymást. Egy
 * `ExternalReference` sor `entityType: "ProductPrice"`-szal; a tábla meglévő,
 * migráció nem kell.
 *
 * CSAK A KUDARC TART ESEDÉKESEN, a soha nem árazott termék NEM. A kezdő ár-kör
 * (minden kötött termék ára egyszer) egy külön döntés, és itt nem dől el.
 */
export const MEDUSA_PRICE_REFERENCE = {
  system: "MEDUSA",
  entityType: "ProductPrice",
} as const;

/**
 * Egy elbukott ár ennyi idő múlva próbálkozik újra, ha a forrása nem változott.
 * Rövidebb, mint a készletnél (6 óra): az ár a vevő előtt áll, és egy átmeneti
 * írási hiba után egy óra a bolt felé is belátható késés. Egy tartós ok (például
 * a régió adóbeállítása) így óránként egyszer kerül a naplóba, nem minden körben.
 */
export const PRICE_RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * ÚJRA KELL-E PRÓBÁLNI EGY TERMÉK ÁRÁT, forrás-változás nélkül. Tiszta függvény.
 *
 *   - az utolsó próbálkozás kudarc volt (a `failedAt` újabb a sikernél, vagy
 *     siker még nem volt), és a kudarc régebbi a visszalépési időnél:  igen
 *   - minden más (siker, vagy friss kudarc, vagy soha nem próbált):      nem
 */
export function decidePriceRetry(input: {
  syncedAt: Date | null;
  failedAt: Date | null;
  now: Date;
  retryAfterMs?: number;
}): boolean {
  const { syncedAt, failedAt, now } = input;
  if (!failedAt) return false;
  if (syncedAt && syncedAt.getTime() >= failedAt.getTime()) return false;
  return (
    now.getTime() - failedAt.getTime() >=
    (input.retryAfterMs ?? PRICE_RETRY_AFTER_MS)
  );
}

export interface PriceSyncDatabase {
  externalReference: {
    findMany(
      args: unknown,
    ): Promise<
      { entityId: string; lastSyncedAt: Date | null; metadata: unknown }[]
    >;
    upsert(args: unknown): Promise<unknown>;
  };
}

function failedAtOf(metadata: unknown): Date | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).failedAt;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Azok a termékek, amelyeknek az ára elbukott, és a visszalépési idő letelt. */
export async function priceRetryProducts(
  db: PriceSyncDatabase,
  now: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db.externalReference.findMany({
    where: { ...MEDUSA_PRICE_REFERENCE },
    select: { entityId: true, lastSyncedAt: true, metadata: true },
  });
  return rows
    .filter((row) =>
      decidePriceRetry({
        syncedAt: row.lastSyncedAt,
        failedAt: failedAtOf(row.metadata),
        now,
      }),
    )
    .map((row) => row.entityId)
    .slice(0, limit);
}

/**
 * A PRÓBÁLKOZÁS RÖGZÍTÉSE, a készlet mintájára. Sikernél a `lastSyncedAt` a kör
 * kezdete, és a kudarc-jel törlődik; kudarcnál a `lastSyncedAt` nem mozdul, a
 * `metadata.failedAt` és az ok kerül rá.
 */
export async function recordPriceAttempt(
  db: PriceSyncDatabase,
  input: {
    productId: string;
    medusaProductId: string;
    startedAt: Date;
    failure: string | null;
  },
): Promise<void> {
  const failure = input.failure
    ? ({
        failedAt: input.startedAt.toISOString(),
        reason: input.failure.slice(0, 300),
      } satisfies Prisma.JsonObject)
    : null;
  await db.externalReference.upsert({
    where: {
      system_entityType_entityId: {
        ...MEDUSA_PRICE_REFERENCE,
        entityId: input.productId,
      },
    },
    create: {
      ...MEDUSA_PRICE_REFERENCE,
      entityId: input.productId,
      externalId: input.medusaProductId,
      lastSyncedAt: failure ? null : input.startedAt,
      metadata: failure ?? undefined,
    },
    update: failure
      ? { externalId: input.medusaProductId, metadata: failure }
      : {
          externalId: input.medusaProductId,
          lastSyncedAt: input.startedAt,
          metadata: {},
        },
  });
}
