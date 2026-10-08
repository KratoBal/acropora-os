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

/** Csak az eltérő mezők; ürítés nincs (a hiányzó tény nem töröl a boltból). */
export function measurePatch(
  wanted: MedusaVariantMeasurePatch,
  row: MedusaVariantMeasureRow,
): MedusaVariantMeasurePatch {
  const patch: MedusaVariantMeasurePatch = {};
  for (const [mezo, ertek] of Object.entries(wanted) as [Mezo, number][])
    if (row[mezo] !== ertek) patch[mezo] = ertek;
  return patch;
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
    skipped.length
      ? `kihagyva: ${skipped.map((s) => `${s.field}${s.variantId ? `@${s.variantId}` : ""} (${s.reason})`).join(", ")}`
      : "",
  ].filter(Boolean);
  return reszek.length ? `      tömeg/méret: ${reszek.join("; ")}\n` : "";
}
