/**
 * AZ ATTRIBUTUM-DEFINICIOK SEEDJE (SEO P0 PR 2; terv: C1 es a tiz kiegeszito
 * dontes).
 *
 * EGY HELYEN, ES EXPLICIT SOROKKAL: a 25 teny-jellegu `FIELD_SPECS` kulcs,
 * soronkent kiirva, nem a `FIELD_SPECS`-bol generalva. Igy az egyezesi teszt
 * (`attribute-definitions.spec.ts`) ket fuggetlen forrast vet ossze, nem egyet
 * onmagaval (3. dontes).
 *
 * A MIGRACIO EBBOL IRODOTT (`seedSql()`), es a teszt orzi, hogy a migracio
 * INSERT-je ugyanezt tartalmazza: ha valaki itt valtoztat, a migracio-szoveg
 * nem egyezik, es az pirosit.
 *
 * MIERT A MIGRACIOBAN, ES NEM EGY KULON SEED-LEPESBEN: a vetites `public`-kapuja
 * a definiciokat olvassa. Egy ures tabla mellett MINDEN tenyt elvenne a
 * vevotol; egy kihagyhato seed-lepes ezt egy telepitesi sorrendre bizna.
 */

export type AttributeDataType =
  | "STRING"
  | "TEXT"
  | "NUMBER"
  | "BOOLEAN"
  | "ENUM"
  | "RANGE"
  | "QUANTITY"
  | "RELATION"
  | "DOSE";

export type AttributeDimension =
  | "LENGTH"
  | "MASS"
  | "VOLUME"
  | "FLOW"
  | "POWER"
  | "VOLTAGE"
  | "DOSE"
  | "TEMPERATURE"
  | "CONCENTRATION";

export interface AttributeDefinitionSeed {
  key: string;
  label: string;
  dataType: AttributeDataType;
  dimension: AttributeDimension | null;
  canonicalUnit: string | null;
  scope: "PRODUCT" | "VARIANT";
  tier: "A" | "B" | "C";
  claimPolicy: "NONE" | "VALUE" | "PROSE";
  validation: Record<string, unknown> | null;
  public: boolean;
  aiVisible: boolean;
  merchantVisible: boolean;
  medusaNativeField:
    | "VARIANT_WEIGHT"
    | "VARIANT_LENGTH"
    | "VARIANT_WIDTH"
    | "VARIANT_HEIGHT"
    | null;
}

/**
 * A `FIELD_SPECS` `kind` -> `dataType` LEKEPEZES (3. dontes). A `gtin` es az
 * `identifier` STRING, `validation`-nel; a `dose` sajat DOSE tipus (2. dontes),
 * mert a QUANTITY egyetlen szamot tarol, egy feloldott adagolas viszont
 * mennyiseg / viztérfogat / idoszak.
 */
export const KIND_DATA_TYPE: Record<
  "gtin" | "identifier" | "quantity" | "dose" | "text",
  AttributeDataType
> = {
  gtin: "STRING",
  identifier: "STRING",
  quantity: "QUANTITY",
  dose: "DOSE",
  text: "TEXT",
};

/** A JEV dimenzio -> a definicio dimenzioja es kanonikus egysege (C1). */
export const DIMENSION_UNIT: Record<
  "length" | "mass" | "volume" | "flow" | "power" | "voltage",
  { dimension: AttributeDimension; unit: string }
> = {
  length: { dimension: "LENGTH", unit: "mm" },
  mass: { dimension: "MASS", unit: "g" },
  volume: { dimension: "VOLUME", unit: "ml" },
  flow: { dimension: "FLOW", unit: "l/h" },
  power: { dimension: "POWER", unit: "W" },
  voltage: { dimension: "VOLTAGE", unit: "V" },
};

/**
 * A SZOVEG-JELLEGU KULCSOK NEM ATTRIBUTUMOK: a `ProductCopy` blokkjai vagy
 * javaslatok (C1, "A FIELD_SPECS sorsa").
 */
export const COPY_KEYS = [
  "searchKeywords",
  "seoTitle",
  "metaDescription",
  "featureBullets",
  "categorySuggestion",
  "shortDescription",
  "longDescription",
  "title",
  "category",
] as const;

type Sor = Omit<
  AttributeDefinitionSeed,
  "public" | "aiVisible" | "merchantVisible" | "medusaNativeField" | "scope"
> &
  Partial<
    Pick<
      AttributeDefinitionSeed,
      "aiVisible" | "merchantVisible" | "medusaNativeField" | "scope"
    >
  >;

const szoveg = (
  key: string,
  label: string,
  tier: "B" | "C",
  claimPolicy: "NONE" | "VALUE" | "PROSE" = "VALUE",
): Sor => ({
  key,
  label,
  dataType: "TEXT",
  dimension: null,
  canonicalUnit: null,
  tier,
  claimPolicy,
  validation: null,
});

const mennyiseg = (
  key: string,
  label: string,
  dimension: AttributeDimension,
  canonicalUnit: string,
  extra: Partial<Sor> = {},
): Sor => ({
  key,
  label,
  dataType: "QUANTITY",
  dimension,
  canonicalUnit,
  tier: "C",
  claimPolicy: "VALUE",
  validation: null,
  ...extra,
});

/**
 * A 25 SOR. A `public` MINDEN soron igaz (a seed szabalya, C1): ma minden
 * VERIFIED teny kimegy, tehat a PR 2 kapuja egyetlen ma lathato tenyt sem
 * vehet el. A cimkek a webes `FIELD_LABEL`-bol, a 8. dontes harom javitasaval
 * (`volume` "Űrtartalom", `flowRate` "Áramlás", `power` "Teljesítményfelvétel").
 *
 * Ket tudatos elteres a C1 peldaitol: a `packSize` TERMEKSZINTU marad (a mai
 * tenyek termekszintuek, es a PR 3 ervenyesitese egyet sem utasithat el), es az
 * `ean` tarolasa KNOWLEDGE_FACT marad, amig a PR 4 at nem viszi a vonalkodra.
 */
const SOROK: readonly Sor[] = [
  szoveg("compatibility", "Kompatibilitás", "B"),
  szoveg("application", "Felhasználás", "B"),
  szoveg("dosingText", "Adagolás", "B"),
  szoveg("productFamily", "Termékcsalád", "B", "NONE"),
  {
    key: "ean",
    label: "EAN",
    dataType: "STRING",
    dimension: null,
    canonicalUnit: null,
    tier: "C",
    claimPolicy: "VALUE",
    validation: { pattern: "^(\\d{8}|\\d{12,14})$" },
  },
  {
    key: "manufacturerSku",
    label: "Gyártói cikkszám",
    dataType: "STRING",
    dimension: null,
    canonicalUnit: null,
    tier: "C",
    claimPolicy: "VALUE",
    validation: { maxLength: 64 },
  },
  mennyiseg("lengthMm", "Hosszúság", "LENGTH", "mm", {
    scope: "VARIANT",
    medusaNativeField: "VARIANT_LENGTH",
  }),
  mennyiseg("widthMm", "Szélesség", "LENGTH", "mm", {
    scope: "VARIANT",
    medusaNativeField: "VARIANT_WIDTH",
  }),
  mennyiseg("heightMm", "Magasság", "LENGTH", "mm", {
    scope: "VARIANT",
    medusaNativeField: "VARIANT_HEIGHT",
  }),
  mennyiseg("volume", "Űrtartalom", "VOLUME", "ml"),
  mennyiseg("weight", "Tömeg", "MASS", "g", {
    scope: "VARIANT",
    medusaNativeField: "VARIANT_WEIGHT",
  }),
  mennyiseg("flowRate", "Áramlás", "FLOW", "l/h"),
  mennyiseg("power", "Teljesítményfelvétel", "POWER", "W"),
  mennyiseg("voltage", "Feszültség", "VOLTAGE", "V", {
    validation: { unitQualifiers: ["AC", "DC"] },
  }),
  szoveg("dosingAmount", "Adagolási mennyiség", "C"),
  szoveg("composition", "Összetétel", "C"),
  szoveg("warranty", "Garancia", "C"),
  szoveg("safetyInformation", "Biztonsági adatok", "C"),
  // a RELATION a PR 11-gyel jon (4. dontes): addig TEXT, kulonben a mai
  // markateny a PR 3 ervenyesitesen elbukna
  szoveg("brand", "Márka", "C"),
  mennyiseg("capacity", "Kapacitás", "VOLUME", "ml"),
  // a kiirt kiszereles-felirat (8. dontes); a mennyisegi alak kesobbi, kulon PR
  szoveg("packSize", "Kiszerelés", "C"),
  szoveg("packageContents", "A csomag tartalma", "C"),
  {
    key: "dosing",
    label: "Adagolási rend",
    dataType: "DOSE",
    dimension: "DOSE",
    canonicalUnit: null,
    tier: "C",
    claimPolicy: "VALUE",
    validation: null,
  },
  {
    ...szoveg("manufacturerClaims", "A gyártó állításai", "C", "PROSE"),
    aiVisible: true,
  },
  { ...szoveg("manufacturerInfo", "Gyártó (GPSR)", "C"), aiVisible: true },
];

export const ATTRIBUTE_DEFINITIONS: readonly AttributeDefinitionSeed[] =
  SOROK.map((sor) => ({
    scope: "PRODUCT",
    aiVisible: false,
    merchantVisible: false,
    medusaNativeField: null,
    ...sor,
    public: true,
  }));

const sqlSzoveg = (v: string | null) =>
  v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`;

/**
 * A MIGRACIO INSERT-JE, ebbol a tablabol. `ON CONFLICT DO NOTHING`: ujrafuttatva
 * sem ir felul egy kesobb (az admin-feluleten) modositott sort.
 */
export function seedSql(): string {
  const sorok = ATTRIBUTE_DEFINITIONS.map(
    (d) =>
      `(${[
        sqlSzoveg(d.key),
        sqlSzoveg(d.label),
        `'${d.dataType}'`,
        d.dimension ? `'${d.dimension}'` : "NULL",
        sqlSzoveg(d.canonicalUnit),
        `'${d.scope}'`,
        `'${d.tier}'`,
        `'${d.claimPolicy}'`,
        d.validation
          ? `${sqlSzoveg(JSON.stringify(d.validation))}::jsonb`
          : "NULL",
        String(d.public),
        String(d.aiVisible),
        String(d.merchantVisible),
        d.medusaNativeField ? `'${d.medusaNativeField}'` : "NULL",
        "CURRENT_TIMESTAMP",
      ].join(", ")})`,
  );
  return [
    'INSERT INTO "AttributeDefinition" ("key", "label", "dataType", "dimension", "canonicalUnit", "scope", "tier", "claimPolicy", "validation", "public", "aiVisible", "merchantVisible", "medusaNativeField", "updatedAt") VALUES',
    sorok.join(",\n"),
    'ON CONFLICT ("key") DO NOTHING;',
  ].join("\n");
}
