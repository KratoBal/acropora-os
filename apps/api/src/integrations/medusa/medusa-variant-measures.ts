import type {
  MedusaVariantMeasurePatch,
  MedusaVariantMeasureRow,
} from "./medusa-admin.client.js";

/**
 * A TÖMEG ÉS A MÉRETEK A MEDUSA NATÍV VÁLTOZAT-MEZŐIBE (SEO P0 PR 8; C2, D1/D4).
 *
 * A forrás a VERIFIED tény, amelynek definíciójában van `medusaNativeField`. A
 * definíciót a hívó az adatbázisból olvassa, tehát a natív cél törlése a
 * definícióból kikapcsolja a vetítést (a terv visszaútja). Az egység a
 * kanonikus: a tömeg g, a méret mm (az elfogadás mást elutasít); egy más
 * egységű régi sor kimarad, és a jelentés megnevezi.
 */
export const NATIVE_MEASURE_FIELDS = {
  VARIANT_WEIGHT: { mezo: "weight", egyseg: "g" },
  VARIANT_LENGTH: { mezo: "length", egyseg: "mm" },
  VARIANT_WIDTH: { mezo: "width", egyseg: "mm" },
  VARIANT_HEIGHT: { mezo: "height", egyseg: "mm" },
} as const;

export type NativeMeasureField = keyof typeof NATIVE_MEASURE_FIELDS;
type Mezo = (typeof NATIVE_MEASURE_FIELDS)[NativeMeasureField]["mezo"];

export interface MeasureFact {
  field: string;
  variantId: string | null;
  value: string | null;
  unit: string | null;
}

export interface VariantMeasureInput {
  sku: string;
  patch: MedusaVariantMeasurePatch;
}

export interface MeasureSkip {
  field: string;
  variantId: string | null;
  reason: "multi-variant-product-fact" | "unit" | "not-a-number" | "no-sku";
}

/**
 * `facts`: a termék VERIFIED tényei. `nativeFields`: tény-kulcs → natív cél (az
 * adatbázis definíciójából). `variants`: a termék aktív változatai.
 *
 * Egy termék-szintű tény (régi sor) csak EGYVÁLTOZATOS terméknél megy ki, arra az
 * egy változatra: ez az elfogadás `factScope` szabályának tükre.
 */
export function decideVariantMeasures(
  facts: readonly MeasureFact[],
  nativeFields: ReadonlyMap<string, NativeMeasureField>,
  variants: readonly { id: string; sku: string | null }[],
): { measures: VariantMeasureInput[]; skipped: MeasureSkip[] } {
  const skipped: MeasureSkip[] = [];
  const bySku = new Map<string, MedusaVariantMeasurePatch>();
  for (const fact of facts) {
    const native = nativeFields.get(fact.field);
    if (!native) continue;
    const { mezo, egyseg } = NATIVE_MEASURE_FIELDS[native];
    const kihagy = (reason: MeasureSkip["reason"]) =>
      skipped.push({ field: fact.field, variantId: fact.variantId, reason });
    const valtozat = fact.variantId
      ? variants.find((v) => v.id === fact.variantId)
      : variants.length === 1
        ? variants[0]
        : undefined;
    if (!valtozat) {
      // egy inaktív változat ténye csendben kimarad: az a változat nincs a boltban
      if (!fact.variantId) kihagy("multi-variant-product-fact");
      continue;
    }
    if (!valtozat.sku) {
      kihagy("no-sku");
      continue;
    }
    if (fact.unit !== egyseg) {
      kihagy("unit");
      continue;
    }
    const ertek = fact.value === null ? NaN : Number(fact.value);
    if (!Number.isFinite(ertek) || ertek < 0) {
      kihagy("not-a-number");
      continue;
    }
    const patch = bySku.get(valtozat.sku) ?? {};
    // a változat-szintű tény erősebb a termék-szintűnél, sorrendtől függetlenül
    if (patch[mezo as Mezo] === undefined || fact.variantId)
      patch[mezo as Mezo] = ertek;
    bySku.set(valtozat.sku, patch);
  }
  return {
    measures: [...bySku].map(([sku, patch]) => ({ sku, patch })),
    skipped,
  };
}

/** A négy natív mérték-mező, a Medusa változat neveivel. */
export const MEASURE_FIELDS = ["weight", "length", "width", "height"] as const;

/**
 * AMIT AZ OS KIÍRT (az árva-kezelés nyilvántartása): cikkszám → mező → érték. Egy
 * `ExternalReference` sor `metadata`-jában él (`MEDUSA_MEASURE_REFERENCE`), nem a
 * termék-kötésén, mert azt a termék-vetítés olvassa-írja, és két író felülírná
 * egymást (ugyanaz az indok, mint az ár-sornál).
 */
export type WrittenMeasures = Record<string, Partial<Record<Mezo, number>>>;

export const MEDUSA_MEASURE_REFERENCE = {
  system: "MEDUSA",
  entityType: "ProductMeasure",
} as const;

/**
 * EGY VÁLTOZAT ÍRÁSI TERVE, MEZŐNKÉNT:
 *   - van VERIFIED érték: eltérésnél kiírja, és a nyilvántartásba veszi;
 *   - nincs, és a boltban áll érték, ami PONTOSAN az, amit mi írtunk ki: üríti;
 *   - nincs, és a boltban más érték áll: ÁRVA, nem nyúl hozzá, a jelentés
 *     megnevezi (kézzel vagy más úton került oda; a vetítés nem dönthet róla).
 */
export function planVariantMeasureWrite(
  wanted: MedusaVariantMeasurePatch | undefined,
  row: MedusaVariantMeasureRow,
  written: Partial<Record<Mezo, number>> | undefined,
): {
  patch: MedusaVariantMeasurePatch;
  orphans: Mezo[];
  cleared: Mezo[];
  record: Partial<Record<Mezo, number>>;
} {
  const patch: MedusaVariantMeasurePatch = {};
  const orphans: Mezo[] = [];
  const cleared: Mezo[] = [];
  const record: Partial<Record<Mezo, number>> = {};
  for (const mezo of MEASURE_FIELDS) {
    const kert = wanted?.[mezo];
    const most = row[mezo];
    if (typeof kert === "number") {
      if (most !== kert) patch[mezo] = kert;
      record[mezo] = kert;
    } else if (most !== null && most !== undefined) {
      if (written?.[mezo] === most) {
        patch[mezo] = null;
        cleared.push(mezo);
      } else orphans.push(mezo);
    }
  }
  return { patch, orphans, cleared, record };
}

/** Az adatbázis annyija, amennyit a mérték-forrás olvas. */
export interface MeasureSourceDatabase {
  attributeDefinition: {
    findMany(args: {
      where: {
        medusaNativeField: { in: NativeMeasureField[] };
        isActive: true;
      };
      select: { key: true; medusaNativeField: true };
    }): Promise<{ key: string; medusaNativeField: string | null }[]>;
  };
  productKnowledgeFact: {
    findMany(args: {
      where: { productId: string; field: { in: string[] }; status: "VERIFIED" };
      select: { field: true; variantId: true; value: true; unit: true };
    }): Promise<MeasureFact[]>;
  };
}

/**
 * EGY TERMÉK MÉRTÉKEI A VETÍTÉSHEZ. A natív cél a definíció mai sorából jön (nem
 * a seedből): ha valaki a definícióról leveszi a célt, a vetítés megáll.
 */
export async function variantMeasuresFor(
  db: MeasureSourceDatabase,
  productId: string,
  variants: readonly { id: string; sku: string | null }[],
): Promise<{ measures: VariantMeasureInput[]; skipped: MeasureSkip[] }> {
  const definiciok = await db.attributeDefinition.findMany({
    where: {
      medusaNativeField: {
        in: Object.keys(NATIVE_MEASURE_FIELDS) as NativeMeasureField[],
      },
      isActive: true,
    },
    select: { key: true, medusaNativeField: true },
  });
  const nativeFields = new Map(
    definiciok.map((d) => [d.key, d.medusaNativeField as NativeMeasureField]),
  );
  if (!nativeFields.size) return { measures: [], skipped: [] };
  const facts = await db.productKnowledgeFact.findMany({
    where: {
      productId,
      field: { in: [...nativeFields.keys()] },
      status: "VERIFIED",
    },
    select: { field: true, variantId: true, value: true, unit: true },
  });
  return decideVariantMeasures(facts, nativeFields, variants);
}

/** A jelentés sora, a vonalkódéval azonos alakban; üres, ha nincs mit mondani. */
export function describeVariantMeasures(
  r:
    | {
        written: string[];
        missing: string[];
        failed: { sku: string; error: string }[];
        cleared?: string[];
        orphans?: string[];
      }
    | undefined,
  skipped: readonly MeasureSkip[],
): string {
  const reszek = [
    r?.written.length ? `${r.written.length} írva` : "",
    r?.missing.length ? `nincs a boltban: ${r.missing.join(", ")}` : "",
    r?.failed.length
      ? `HIBA: ${r.failed.map((f) => `${f.sku} (${f.error})`).join("; ")}`
      : "",
    r?.cleared?.length
      ? `saját, tény nélküli ürítve: ${r.cleared.join(", ")}`
      : "",
    r?.orphans?.length
      ? `ÁRVA (tény nélkül áll, nem mi írtuk, érintetlen): ${r.orphans.join(", ")}`
      : "",
    skipped.length
      ? `kihagyva: ${skipped.map((s) => `${s.field}${s.variantId ? `@${s.variantId}` : ""} (${s.reason})`).join(", ")}`
      : "",
  ].filter(Boolean);
  return reszek.length ? `      tömeg/méret: ${reszek.join("; ")}\n` : "";
}

/** A nyilvántartás-sor olvasásához és írásához kellő tábla. */
export interface MeasureLedgerDatabase {
  externalReference: {
    findUnique(args: unknown): Promise<{ metadata: unknown } | null>;
    upsert(args: unknown): Promise<unknown>;
  };
}

const kulcs = (productId: string) => ({
  system_entityType_entityId: {
    ...MEDUSA_MEASURE_REFERENCE,
    entityId: productId,
  },
});

/** Amit a vetítés eddig kiírt; üres, ha még semmit (vagy a sor más alakú). */
export async function loadWrittenMeasures(
  db: MeasureLedgerDatabase,
  productId: string,
): Promise<WrittenMeasures> {
  const sor = await db.externalReference.findUnique({
    where: kulcs(productId),
    select: { metadata: true },
  });
  const written = (sor?.metadata as { written?: unknown } | null)?.written;
  return written && typeof written === "object"
    ? (written as WrittenMeasures)
    : {};
}

/** Kulcs-sorrendtől független egyezés: csak változásnál írunk. */
export function sameLedger(a: WrittenMeasures, b: WrittenMeasures): boolean {
  const kanon = (l: WrittenMeasures) =>
    JSON.stringify(
      Object.keys(l)
        .sort()
        .map((sku) => [sku, MEASURE_FIELDS.map((m) => l[sku]?.[m] ?? null)]),
    );
  return kanon(a) === kanon(b);
}

export async function saveWrittenMeasures(
  db: MeasureLedgerDatabase,
  productId: string,
  medusaProductId: string,
  ledger: WrittenMeasures,
  now: Date,
): Promise<void> {
  await db.externalReference.upsert({
    where: kulcs(productId),
    create: {
      ...MEDUSA_MEASURE_REFERENCE,
      entityId: productId,
      externalId: medusaProductId,
      lastSyncedAt: now,
      metadata: { written: ledger },
    },
    update: {
      externalId: medusaProductId,
      lastSyncedAt: now,
      metadata: { written: ledger },
    },
  });
}
