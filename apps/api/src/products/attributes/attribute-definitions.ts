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
    | "VARIANT_BARCODE"
    | null;
}

/**
 * A `FIELD_SPECS` `kind` -> `dataType` LEKEPEZES (3. dontes). A `gtin` es az
 * `identifier` STRING, `validation`-nel; a `dose` sajat DOSE tipus (2. dontes),
 * mert a QUANTITY egyetlen szamot tarol, egy feloldott adagolas viszont
 * mennyiseg / viztérfogat / idoszak.
 */
export const KIND_DATA_TYPE: Record<
  "gtin" | "identifier" | "quantity" | "dose" | "parameterEffects" | "text",
  AttributeDataType
> = {
  gtin: "STRING",
  identifier: "STRING",
  quantity: "QUANTITY",
  dose: "DOSE",
  // a kanonikus `KOD:IRANY;...` szöveg (JEV `water-parameters.ts`)
  parameterEffects: "TEXT",
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
  return [
    'INSERT INTO "AttributeDefinition" ("key", "label", "dataType", "dimension", "canonicalUnit", "scope", "tier", "claimPolicy", "validation", "public", "aiVisible", "merchantVisible", "medusaNativeField", "updatedAt") VALUES',
    ATTRIBUTE_DEFINITIONS.map(sorSql).join(",\n"),
    'ON CONFLICT ("key") DO NOTHING;',
  ].join("\n");
}

/** Egy definíció VALUES-sora, ahogy a seed és a későbbi hozzáadások írják. */
function sorSql(d: AttributeDefinitionSeed): string {
  return `(${[
    sqlSzoveg(d.key),
    sqlSzoveg(d.label),
    `'${d.dataType}'`,
    d.dimension ? `'${d.dimension}'` : "NULL",
    sqlSzoveg(d.canonicalUnit),
    `'${d.scope}'`,
    `'${d.tier}'`,
    `'${d.claimPolicy}'`,
    d.validation ? `${sqlSzoveg(JSON.stringify(d.validation))}::jsonb` : "NULL",
    String(d.public),
    String(d.aiVisible),
    String(d.merchantVisible),
    d.medusaNativeField ? `'${d.medusaNativeField}'` : "NULL",
    "CURRENT_TIMESTAMP",
  ].join(", ")})`;
}

/**
 * A SEED UTÁNI VÁLTOZÁSOK, migrációnként (SEO P0 PR 4).
 *
 * A fenti `ATTRIBUTE_DEFINITIONS` a 20261007160000-s migráció INSERT-je, betűre
 * (a teszt őrzi); egy későbbi átállítás nem írhatja át, különben a régi migráció
 * és a táblázat elválna egymástól. Ezért a változás külön sor, a saját
 * migrációjával, és a MAI állapot a kettő összege (`CURRENT_ATTRIBUTE_DEFINITIONS`).
 */
export const ATTRIBUTE_DEFINITION_CHANGES: readonly {
  migration: string;
  key: string;
  change: Pick<
    AttributeDefinitionSeed,
    "scope" | "medusaNativeField" | "public"
  >;
}[] = [
  {
    // az elfogadott EAN `ProductBarcode` sor, változatonként, és nem tény (C3, D1)
    migration: "20261007200100_gtin_ean_definition",
    key: "ean",
    change: {
      scope: "VARIANT",
      medusaNativeField: "VARIANT_BARCODE",
      public: false,
    },
  },
];

/**
 * A SEED UTÁN FELVETT DEFINÍCIÓK, migrációnként. Ugyanaz az ok, mint a
 * változásoknál: a seed a régi migráció INSERT-je betűre, tehát egy új kulcs nem
 * kerülhet bele, hanem a saját migrációjával áll itt.
 */
export const ATTRIBUTE_DEFINITION_ADDITIONS: readonly {
  migration: string;
  definition: AttributeDefinitionSeed;
}[] = [
  {
    // a vízmérési ajánlás bemenete (kártya 2b3983e1): a JEV állítása arról, mit
    // mozgat a termék; nem bolti tény, ezért nem `public`, de az AI látja
    migration: "20261009000000_water_parameter_effects_definition",
    definition: {
      key: "waterParameterEffects",
      label: "Mozgatott vízparaméterek",
      dataType: "TEXT",
      dimension: null,
      canonicalUnit: null,
      scope: "PRODUCT",
      tier: "C",
      claimPolicy: "VALUE",
      validation: null,
      public: false,
      aiVisible: true,
      merchantVisible: false,
      medusaNativeField: null,
    },
  },
];

/** Egy hozzáadás INSERT-je, ahogy a migrációjában áll. */
export function additionSql(
  a: (typeof ATTRIBUTE_DEFINITION_ADDITIONS)[number],
): string {
  return [
    'INSERT INTO "AttributeDefinition" ("key", "label", "dataType", "dimension", "canonicalUnit", "scope", "tier", "claimPolicy", "validation", "public", "aiVisible", "merchantVisible", "medusaNativeField", "updatedAt") VALUES',
    sorSql(a.definition),
    'ON CONFLICT ("key") DO NOTHING;',
  ].join("\n");
}

/** A definíciók MA: a seed és a hozzáadások, a későbbi változásokkal. */
export const CURRENT_ATTRIBUTE_DEFINITIONS: readonly AttributeDefinitionSeed[] =
  [
    ...ATTRIBUTE_DEFINITIONS,
    ...ATTRIBUTE_DEFINITION_ADDITIONS.map((a) => a.definition),
  ].map((d) =>
    ATTRIBUTE_DEFINITION_CHANGES.filter((c) => c.key === d.key).reduce(
      (acc, c) => ({ ...acc, ...c.change }),
      d,
    ),
  );

/** Egy változás UPDATE-je, ahogy a migrációjában áll. */
export function changeSql(
  c: (typeof ATTRIBUTE_DEFINITION_CHANGES)[number],
): string {
  return (
    `UPDATE "AttributeDefinition" SET "scope" = '${c.change.scope}', ` +
    `"medusaNativeField" = ${c.change.medusaNativeField ? `'${c.change.medusaNativeField}'` : "NULL"}, ` +
    `"public" = ${String(c.change.public)}, "updatedAt" = CURRENT_TIMESTAMP ` +
    `WHERE "key" = ${sqlSzoveg(c.key)};`
  );
}
