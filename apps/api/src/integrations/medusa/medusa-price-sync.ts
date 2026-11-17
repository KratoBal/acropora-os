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

/**
 * Azok a termékek, amelyeknek az ára elbukott, és a visszalépési idő letelt. A `limit` nélkül mindet adja: az ütemező
 * előbb kiszűri a nem árazhatókat (inaktivált, kötés nélküli), és csak utána vág, különben azok kiszorítanák a valódiakat.
 */
export async function priceRetryProducts(
  db: PriceSyncDatabase,
  now: Date,
  limit = Number.POSITIVE_INFINITY,
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
 * A KÉTÉRTELMŰ ÁR ÜTKÖZŐ SORAINAK ALAKJA (550b80d1), azonosító nélkül. A stage-en az `ambiguous-price` a leggyakoribb
 * ár-kudarc, és az nem látszik, hogy a második forint sor árlistás, szabályos (régió), mennyiségi, vagy egy sima
 * kettőzés: ettől függ, hogy a vetítés számlálása téved-e, vagy a megállás véd. EZ CSAK MÉRÉS: hogy melyik sor a
 * miénk, azt nem változtatja.
 *
 *   rows       az ütköző forint sorok száma
 *   priceList  van `price_list_id`-je
 *   rules      `rules_count` > 0
 *   quantity   van `min_quantity` vagy `max_quantity`
 *   plain      a három jel ismert, és egyik sem áll
 *   unknown    a válasz egyik jelet sem hozta: a `*prices` alak nem adja, ezt kell tudni
 *
 * Egy sor több jelben is számíthat (árlistás ÉS szabályos), tehát a jelek összege nem a `rows`.
 */
export type PriceConflictShape = {
  rows: number;
  priceList: number;
  rules: number;
  quantity: number;
  plain: number;
  unknown: number;
};

export function priceConflictShape(
  rows: readonly {
    price_list_id?: string | null;
    rules_count?: number | null;
    min_quantity?: number | null;
    max_quantity?: number | null;
  }[],
): PriceConflictShape {
  const shape: PriceConflictShape = {
    rows: rows.length,
    priceList: 0,
    rules: 0,
    quantity: 0,
    plain: 0,
    unknown: 0,
  };
  for (const row of rows) {
    if (
      row.price_list_id === undefined &&
      row.rules_count === undefined &&
      row.min_quantity === undefined &&
      row.max_quantity === undefined
    ) {
      shape.unknown += 1;
      continue;
    }
    const list = row.price_list_id != null;
    const rules = (row.rules_count ?? 0) > 0;
    const quantity = row.min_quantity != null || row.max_quantity != null;
    if (list) shape.priceList += 1;
    if (rules) shape.rules += 1;
    if (quantity) shape.quantity += 1;
    if (!list && !rules && !quantity) shape.plain += 1;
  }
  return shape;
}

/** Két alak összege (a kör több kétértelmű változatáé). */
export function addPriceConflictShape(
  sum: PriceConflictShape | null,
  next: PriceConflictShape,
): PriceConflictShape {
  if (!sum) return { ...next };
  return {
    rows: sum.rows + next.rows,
    priceList: sum.priceList + next.priceList,
    rules: sum.rules + next.rules,
    quantity: sum.quantity + next.quantity,
    plain: sum.plain + next.plain,
    unknown: sum.unknown + next.unknown,
  };
}

/**
 * EGY ÁR-KUDARC FAJTÁJA (550b80d1), a health számára: csak a kód, a cikkszám és a részletek nélkül. A szövegek az
 * ár-futás (`medusa-pricing.cli.ts`, `priceTargets`) és az ütemező kudarc-üzenetei; egy új, ismeretlen alak `other`.
 *
 *   "<sku>: MEGÁLLT (<ok>) <részlet>"          a feloldó vagy a vetítés megállt:      <ok>
 *   "<sku>: <ok>"                              a vetítés megállt, vagy az előzmény:   <ok>
 *   "<argumentum>: nincs aktív változata ..."  nincs aktív változat:                  no-active-variant
 *   "sku:<x>: nincs ilyen cikkszámú ..."       nincs ilyen cikkszám:                  no-such-sku
 *   "az ar-futas kivetellel allt le: <név>"    az ár-futás dobott:                    run-threw
 *   "az ar-futas elbukott (kod <n>)"           termék nélküli bukás (pl. a bolt):     run-failed
 */
export function priceFailureKind(reason: string): string {
  const megallt = /MEGÁLLT \(([a-z0-9-]+)\)/.exec(reason);
  if (megallt) return megallt[1]!;
  if (reason.includes("nincs aktív változata")) return "no-active-variant";
  if (reason.includes("nincs ilyen cikkszámú")) return "no-such-sku";
  if (reason.startsWith("az ar-futas kivetellel allt le")) return "run-threw";
  if (reason.startsWith("az ar-futas elbukott")) return "run-failed";
  const ok = /: ([a-z0-9]+(?:-[a-z0-9]+)+)$/.exec(reason);
  return ok ? ok[1]! : "other";
}

/**
 * AZ ÁR-MEGÁLLÁSOK, AMIK EMBERI ADAT-ÁLLAPOTOT JELENTENEK, ÉS NEM TESZIK FAILED-DÉ A KÖRT (t-20261117-vetito-ar-megallas, kártya 7ee90727,
 * acrobot 54976 és 54985; ADR-017 szelleme). A megállás szándékos és marad: a termék ára nem megy ki, a fajta a `priceFailures`-ben látszik,
 * és a termék a következő körben újra próbálkozik. A KÖR FAILED-je viszont a valódi futási hibát jelentse: egy ilyen állapot, amíg az adatot
 * egy ember nem javítja, minden körben ugyanaz, és elfedné a valódi hibát (2026-11-17 17:44Z a stage-en három ilyen termék volt, a kör FAILED).
 *
 * A LISTA ZÁRT, ÉS A TÉVEDÉS IRÁNYA A HANGOS: ami nincs itt (új fajta, `other`, `run-failed`, `run-threw`, a bolt olvasása/írása, a bolti
 * oldali variáns-állapotok: `variant-not-found`, `variant-identity-chain-broken`) futási hibának számít, és FAILED-dé teszi a kört.
 */
const PRICE_DATA_STOPS: ReadonlySet<string> = new Set([
  "price-not-whole-forint",
  "own-price-missing",
  "mirror-price-missing",
  "mirror-row-missing",
  "authority-unknown",
  "price-negative",
  "ambiguous-price",
  "foreign-currency-price-present",
  "ambiguous-variant",
]);

/** Egy ár-kudarc fajtája (lásd `priceFailureKind`) futási hiba-e: minden, ami nem emberi adat-állapot. */
export function priceFailureIsRunFailure(kind: string): boolean {
  return !PRICE_DATA_STOPS.has(kind);
}

/** A kör ár-kudarcai fajtánként: minden üzenet egyszer számít (egy termék több változata többször). */
export function priceFailureCounts(
  failures: ReadonlyMap<string, readonly string[]>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reasons of failures.values())
    for (const reason of reasons) {
      const kind = priceFailureKind(reason);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  return counts;
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
