import { SLUG_ALAK, SLUG_MAX } from "../slug/slug.js";

/**
 * AZ ACROPORA-KATEGÓRIAFA BETÖLTÉSE JSON-FÁJLBÓL (SEO P0 PR 10, D1). A fát ma
 * nem szerkeszti felület: a pilot fáját mi állítjuk össze fájlban, Balázs vagy
 * Luca hagyja jóvá, és ez a terv dönti el, mi változik. Adatbázis nélkül
 * mérhető: csak állapot megy be, és csak terv jön ki.
 *
 * MIT JELENT A FÁJL:
 * - egy kategória a fájlban `id` szerint (meglévő sor, a slugja is cserélhető),
 *   vagy `slug` szerint (meglévő sor ugyanazzal a sluggal, különben új sor);
 * - a fájlban nem szereplő kategória érintetlen marad (nincs törlés; kivezetés:
 *   `isActive: false`);
 * - egy felsorolt termék besorolása PONTOSAN a felsorolt lesz (üres lista: a
 *   termék kikerül a fából, és a vetítés a régi útra áll vissza); a fel nem
 *   sorolt termékhez nem nyúl;
 * - a UNAS-leképezés soronként felülíródik.
 *
 * Bármely ütközés esetén a terv nem alkalmazható: részleges fát nem írunk.
 */

export interface StoreCategoryFileCategory {
  id?: string;
  slug: string;
  name: string;
  /** A szülő SLUGJA (a fájlbeli új slug, vagy egy meglévő kategória mai slugja). */
  parent?: string | null;
  seoTitle?: string | null;
  metaDescription?: string | null;
  intro?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface StoreCategoryFileProduct {
  sku: string;
  /** Kategória-slugok; a sorrend a `sortOrder`. */
  categories: string[];
  /** A primary kategória slugja; kötelező, ha a lista nem üres. */
  primary?: string | null;
}

export interface StoreCategoryFileMapping {
  /** A UNAS-fa sorának azonosítója (`Category.id`). */
  unasCategoryId: string;
  /** Az Acropora-kategória slugja, vagy `null`, ha szándékosan nincs párja. */
  storeCategory: string | null;
  note?: string | null;
}

export interface StoreCategoryFile {
  categories: StoreCategoryFileCategory[];
  products: StoreCategoryFileProduct[];
  unasMappings: StoreCategoryFileMapping[];
}

/** Egy meglévő kategória, ahogy az adatbázisban áll. */
export interface ExistingStoreCategory {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  seoTitle: string | null;
  metaDescription: string | null;
  intro: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface StoreCategoryState {
  categories: readonly ExistingStoreCategory[];
  /** A `SlugHistory` `STORE_CATEGORY` sorai: a régi slug és kié volt. */
  slugHistory: readonly { slug: string; entityId: string }[];
  /** A fájl cikkszámaihoz tartozó termékek (`ProductVariant.sku` -> `productId`). */
  productIdBySku: ReadonlyMap<string, string>;
  /** A fájl termékeinek mai besorolása. */
  assignments: readonly {
    productId: string;
    storeCategoryId: string;
    isPrimary: boolean;
  }[];
  /** A fájlban hivatkozott UNAS-kategóriák közül a létezők. */
  unasCategoryIds: ReadonlySet<string>;
  /** A fájlban hivatkozott UNAS-kategóriák mai leképezése. */
  mappings: readonly {
    unasCategoryId: string;
    storeCategoryId: string | null;
    note: string | null;
  }[];
}

/** A tartalmi mezők, amiket a fájl állít (a slug és a szülő külön). */
const MEZOK = [
  "name",
  "seoTitle",
  "metaDescription",
  "intro",
  "imageUrl",
  "sortOrder",
  "isActive",
] as const;
type Mezo = (typeof MEZOK)[number];
export type StoreCategoryFields = Pick<ExistingStoreCategory, Mezo>;

/** A kategória hivatkozása a tervben: meglévő (`id`) vagy most létrejövő (`slug`). */
export type CategoryRef = { id: string } | { newSlug: string };

export interface PlannedCreate {
  slug: string;
  parent: CategoryRef | null;
  fields: StoreCategoryFields;
}

export interface PlannedUpdate {
  id: string;
  slug: string;
  changes: Partial<Record<Mezo | "parent", { from: unknown; to: unknown }>>;
  data: Partial<StoreCategoryFields>;
  /** `undefined`: a szülő nem változik. */
  parent?: CategoryRef | null;
}

export interface PlannedSlugChange {
  id: string;
  from: string;
  to: string;
  /** A kategória a saját régi slugját kapja vissza: az előzmény-sora törlődik. */
  reclaimsOwnHistory: boolean;
}

export interface PlannedProduct {
  productId: string;
  sku: string;
  rows: { category: CategoryRef; slug: string; isPrimary: boolean }[];
}

export interface PlannedMapping {
  unasCategoryId: string;
  storeCategory: CategoryRef | null;
  storeCategorySlug: string | null;
  note: string | null;
}

export interface StoreCategoryLoadPlan {
  /** Szülő előbb, gyerek utána: a létrehozás sorrendje. */
  create: PlannedCreate[];
  update: PlannedUpdate[];
  slugChange: PlannedSlugChange[];
  /** Csak a változó besorolású termékek. */
  products: PlannedProduct[];
  /** Csak a változó leképezések. */
  mappings: PlannedMapping[];
  conflicts: string[];
}

const ures = (value: string | null | undefined) =>
  value === undefined || value === null || value.trim() === ""
    ? null
    : value.trim();

/**
 * A FÁJL ALAKJA. Egy rossz alakú fájl nem terv, hanem hiba: a hívó kiírja, és
 * nem kérdezi meg az adatbázist.
 */
export function parseStoreCategoryFile(
  json: unknown,
): { ok: true; file: StoreCategoryFile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const obj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!obj(json)) return { ok: false, errors: ["a fájl nem JSON-objektum"] };
  const lista = (key: string) => {
    const v = json[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errors.push(`"${key}": nem lista`);
      return [];
    }
    return v;
  };
  const szoveg = (where: string, v: unknown, kotelezo: boolean) => {
    if (v === undefined || v === null) {
      if (kotelezo) errors.push(`${where}: hiányzik`);
      return;
    }
    if (typeof v !== "string") errors.push(`${where}: nem szöveg`);
  };
  lista("categories").forEach((c, i) => {
    const w = `categories[${i}]`;
    if (!obj(c)) return void errors.push(`${w}: nem objektum`);
    szoveg(`${w}.slug`, c.slug, true);
    szoveg(`${w}.name`, c.name, true);
    for (const k of [
      "id",
      "parent",
      "seoTitle",
      "metaDescription",
      "intro",
      "imageUrl",
    ])
      szoveg(`${w}.${k}`, c[k], false);
    if (c.sortOrder !== undefined && !Number.isInteger(c.sortOrder))
      errors.push(`${w}.sortOrder: nem egész szám`);
    if (c.isActive !== undefined && typeof c.isActive !== "boolean")
      errors.push(`${w}.isActive: nem logikai érték`);
  });
  lista("products").forEach((p, i) => {
    const w = `products[${i}]`;
    if (!obj(p)) return void errors.push(`${w}: nem objektum`);
    szoveg(`${w}.sku`, p.sku, true);
    szoveg(`${w}.primary`, p.primary, false);
    if (
      !Array.isArray(p.categories) ||
      p.categories.some((s) => typeof s !== "string")
    )
      errors.push(`${w}.categories: nem szöveg-lista`);
  });
  lista("unasMappings").forEach((m, i) => {
    const w = `unasMappings[${i}]`;
    if (!obj(m)) return void errors.push(`${w}: nem objektum`);
    szoveg(`${w}.unasCategoryId`, m.unasCategoryId, true);
    szoveg(`${w}.storeCategory`, m.storeCategory, false);
    szoveg(`${w}.note`, m.note, false);
  });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    file: {
      categories: lista("categories") as StoreCategoryFileCategory[],
      products: lista("products") as StoreCategoryFileProduct[],
      unasMappings: lista("unasMappings") as StoreCategoryFileMapping[],
    },
  };
}

/** A fájl-kategória mezői, az alapértékekkel. */
function mezokBol(c: StoreCategoryFileCategory): StoreCategoryFields {
  return {
    name: c.name.trim(),
    seoTitle: ures(c.seoTitle),
    metaDescription: ures(c.metaDescription),
    intro: ures(c.intro),
    imageUrl: ures(c.imageUrl),
    sortOrder: c.sortOrder ?? 0,
    isActive: c.isActive ?? true,
  };
}

const refKulcs = (ref: CategoryRef | null) =>
  ref === null ? null : "id" in ref ? `id:${ref.id}` : `uj:${ref.newSlug}`;

/**
 * A TERV. Minden ütközést összegyűjt (nem az elsőnél áll meg), hogy egy
 * javítási kör elég legyen.
 */
export function planStoreCategoryLoad(
  file: StoreCategoryFile,
  state: StoreCategoryState,
): StoreCategoryLoadPlan {
  const conflicts: string[] = [];
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const bySlug = new Map(state.categories.map((c) => [c.slug, c]));
  const history = new Map(state.slugHistory.map((h) => [h.slug, h.entityId]));

  // 1. Melyik fájl-sor melyik meglévő sor, és mi lesz a végső slug-térkép.
  const fajlSlugok = new Set<string>();
  const egyezes = new Map<number, ExistingStoreCategory | null>();
  const foglaltMeglevo = new Set<string>();
  file.categories.forEach((c, i) => {
    const slug = c.slug.trim();
    if (slug.length > SLUG_MAX || !SLUG_ALAK.test(slug))
      conflicts.push(
        `"${slug}": a slug csak kisbetű, számjegy és egyes kötőjel lehet, legfeljebb ${SLUG_MAX} karakter`,
      );
    if (fajlSlugok.has(slug))
      conflicts.push(`"${slug}": kétszer szerepel a fájlban`);
    fajlSlugok.add(slug);
    let meglevo: ExistingStoreCategory | null = null;
    if (c.id !== undefined && c.id !== null) {
      meglevo = byId.get(c.id) ?? null;
      if (!meglevo)
        conflicts.push(
          `"${slug}": nincs ilyen azonosítójú kategória (${c.id})`,
        );
    } else meglevo = bySlug.get(slug) ?? null;
    if (meglevo) {
      if (foglaltMeglevo.has(meglevo.id))
        conflicts.push(
          `"${slug}": a(z) ${meglevo.id} kategóriára a fájl két sora is mutat`,
        );
      foglaltMeglevo.add(meglevo.id);
    }
    egyezes.set(i, meglevo);
  });

  /** A végső slug -> hivatkozás: a fájl sorai, plusz a fájlban nem szereplő meglévők. */
  const veglegesSlug = new Map<string, CategoryRef>();
  for (const c of state.categories)
    if (!foglaltMeglevo.has(c.id)) veglegesSlug.set(c.slug, { id: c.id });
  file.categories.forEach((c, i) => {
    const slug = c.slug.trim();
    const meglevo = egyezes.get(i);
    const elozo = veglegesSlug.get(slug);
    if (elozo && "id" in elozo && elozo.id !== meglevo?.id)
      conflicts.push(
        `"${slug}": ez a slug egy másik kategóriáé (${elozo.id}); slugcsere két kategória között nem megy egy fájlban`,
      );
    const maiGazda = bySlug.get(slug);
    if (
      maiGazda &&
      maiGazda.id !== meglevo?.id &&
      foglaltMeglevo.has(maiGazda.id)
    )
      conflicts.push(
        `"${slug}": ma a(z) ${maiGazda.id} kategória slugja, és a csere után régi címe lenne; egy régi cím nem kaphat új gazdát`,
      );
    veglegesSlug.set(slug, meglevo ? { id: meglevo.id } : { newSlug: slug });
    const regiGazda = history.get(slug);
    if (regiGazda !== undefined && regiGazda !== meglevo?.id)
      conflicts.push(
        `"${slug}": régi slugként a(z) ${regiGazda} kategóriáé volt; egy régi cím nem kaphat új gazdát`,
      );
  });

  const feloldas = (slug: string, hol: string): CategoryRef | null => {
    const ref = veglegesSlug.get(slug);
    if (!ref) conflicts.push(`${hol}: nincs "${slug}" slugú kategória`);
    return ref ?? null;
  };

  // 2. Kategóriák: létrehozás, frissítés, slugcsere, szülő.
  const create: PlannedCreate[] = [];
  const update: PlannedUpdate[] = [];
  const slugChange: PlannedSlugChange[] = [];
  /** A végső szülő-él, a kör-ellenőrzéshez: hivatkozás-kulcs -> szülő-kulcs. */
  const szuloEl = new Map<string, string | null>();
  for (const c of state.categories)
    szuloEl.set(`id:${c.id}`, c.parentId === null ? null : `id:${c.parentId}`);

  file.categories.forEach((c, i) => {
    const slug = c.slug.trim();
    const meglevo = egyezes.get(i) ?? null;
    const szuloSlug = ures(c.parent);
    const szulo = szuloSlug ? feloldas(szuloSlug, `"${slug}" szülője`) : null;
    const fields = mezokBol(c);
    const sajat = meglevo ? `id:${meglevo.id}` : `uj:${slug}`;
    szuloEl.set(sajat, refKulcs(szulo));
    if (!meglevo) {
      create.push({ slug, parent: szulo, fields });
      return;
    }
    const changes: PlannedUpdate["changes"] = {};
    const data: Partial<StoreCategoryFields> = {};
    for (const m of MEZOK)
      if (meglevo[m] !== fields[m]) {
        changes[m] = { from: meglevo[m], to: fields[m] };
        (data as Record<string, unknown>)[m] = fields[m];
      }
    const mostaniSzulo = meglevo.parentId ? `id:${meglevo.parentId}` : null;
    let parent: CategoryRef | null | undefined;
    if (refKulcs(szulo) !== mostaniSzulo) {
      parent = szulo;
      changes.parent = { from: mostaniSzulo, to: refKulcs(szulo) };
    }
    if (Object.keys(changes).length > 0)
      update.push({
        id: meglevo.id,
        slug: meglevo.slug,
        changes,
        data,
        ...(parent !== undefined ? { parent } : {}),
      });
    if (meglevo.slug !== slug)
      slugChange.push({
        id: meglevo.id,
        from: meglevo.slug,
        to: slug,
        reclaimsOwnHistory: history.get(slug) === meglevo.id,
      });
  });

  // kör a szülő-láncban (a végső fán)
  for (const kezdo of szuloEl.keys()) {
    const latott = new Set<string>([kezdo]);
    let akt = szuloEl.get(kezdo) ?? null;
    while (akt !== null) {
      if (latott.has(akt)) {
        conflicts.push(`kör a szülő-láncban: ${[...latott].join(" -> ")}`);
        break;
      }
      latott.add(akt);
      akt = szuloEl.get(akt) ?? null;
    }
  }

  // a létrehozás sorrendje: egy új kategória szülője előbb jöjjön létre
  const ujak = new Map(create.map((c) => [c.slug, c]));
  const rendezett: PlannedCreate[] = [];
  const kesz = new Set<string>();
  const felvesz = (c: PlannedCreate, utvonal: Set<string>) => {
    if (kesz.has(c.slug) || utvonal.has(c.slug)) return;
    utvonal.add(c.slug);
    if (c.parent && "newSlug" in c.parent) {
      const szulo = ujak.get(c.parent.newSlug);
      if (szulo) felvesz(szulo, utvonal);
    }
    kesz.add(c.slug);
    rendezett.push(c);
  };
  for (const c of create) felvesz(c, new Set());

  // 3. Termékek.
  const sajatSlug = (ref: CategoryRef) =>
    "newSlug" in ref
      ? ref.newSlug
      : ([...veglegesSlug].find(([, r]) => "id" in r && r.id === ref.id)?.[0] ??
        ref.id);
  const latottSku = new Set<string>();
  const products: PlannedProduct[] = [];
  for (const p of file.products) {
    const sku = p.sku.trim();
    if (latottSku.has(sku)) {
      conflicts.push(`"${sku}": kétszer szerepel a termékek között`);
      continue;
    }
    latottSku.add(sku);
    const productId = state.productIdBySku.get(sku);
    if (!productId) {
      conflicts.push(`"${sku}": nincs ilyen cikkszámú termék`);
      continue;
    }
    const slugok = p.categories.map((s) => s.trim());
    if (new Set(slugok).size !== slugok.length)
      conflicts.push(`"${sku}": egy kategória kétszer szerepel`);
    const primary = ures(p.primary);
    if (slugok.length > 0 && primary === null)
      conflicts.push(`"${sku}": nincs megadva primary kategória`);
    if (primary !== null && !slugok.includes(primary))
      conflicts.push(
        `"${sku}": a primary ("${primary}") nincs a kategóriái között`,
      );
    const rows: PlannedProduct["rows"] = [];
    for (const slug of slugok) {
      const ref = feloldas(slug, `"${sku}" kategóriája`);
      if (ref) rows.push({ category: ref, slug, isPrimary: slug === primary });
    }
    const ma = state.assignments
      .filter((a) => a.productId === productId)
      .map((a) => `id:${a.storeCategoryId}:${a.isPrimary}`)
      .sort();
    const lesz = rows
      .map((r) => `${refKulcs(r.category)}:${r.isPrimary}`)
      .sort();
    // a sorrend (`sortOrder`) is változás
    const maRendben = state.assignments
      .filter((a) => a.productId === productId)
      .map((a) => sajatSlug({ id: a.storeCategoryId }));
    if (
      ma.join("|") !== lesz.join("|") ||
      maRendben.join("|") !== slugok.join("|")
    )
      products.push({ productId, sku, rows });
  }

  // 4. UNAS-leképezés.
  const latottUnas = new Set<string>();
  const mappings: PlannedMapping[] = [];
  for (const m of file.unasMappings) {
    const unasId = m.unasCategoryId.trim();
    if (latottUnas.has(unasId)) {
      conflicts.push(`"${unasId}": kétszer szerepel a UNAS-leképezésben`);
      continue;
    }
    latottUnas.add(unasId);
    if (!state.unasCategoryIds.has(unasId)) {
      conflicts.push(`"${unasId}": nincs ilyen UNAS-kategória`);
      continue;
    }
    const slug = ures(m.storeCategory);
    const ref = slug ? feloldas(slug, `"${unasId}" leképezése`) : null;
    if (slug && !ref) continue;
    const note = ures(m.note);
    const ma = state.mappings.find((x) => x.unasCategoryId === unasId);
    const maKulcs = ma
      ? `${ma.storeCategoryId === null ? null : `id:${ma.storeCategoryId}`}|${ma.note}`
      : null;
    if (maKulcs !== `${refKulcs(ref)}|${note}`)
      mappings.push({
        unasCategoryId: unasId,
        storeCategory: ref,
        storeCategorySlug: slug,
        note,
      });
  }

  return {
    create: rendezett,
    update,
    slugChange,
    products,
    mappings,
    conflicts,
  };
}

/** A terv olvasható alakja: ezt látja a jóváhagyó a száraz futás után. */
export function describeStoreCategoryLoad(plan: StoreCategoryLoadPlan): string {
  const sorok: string[] = [];
  const ref = (r: CategoryRef | null) =>
    r === null ? "(gyökér)" : "id" in r ? r.id : `új:${r.newSlug}`;
  sorok.push(
    `KATEGÓRIA: ${plan.create.length} új, ${plan.update.length} módosul, ${plan.slugChange.length} slugcsere`,
  );
  for (const c of plan.create)
    sorok.push(`  + ${c.slug} "${c.fields.name}" (szülő: ${ref(c.parent)})`);
  for (const u of plan.update)
    sorok.push(
      `  ~ ${u.slug}: ${Object.entries(u.changes)
        .map(
          ([k, v]) =>
            `${k} ${JSON.stringify(v!.from)} -> ${JSON.stringify(v!.to)}`,
        )
        .join("; ")}`,
    );
  for (const s of plan.slugChange)
    sorok.push(
      `  > ${s.from} -> ${s.to} (SlugHistory + átirányítás${s.reclaimsOwnHistory ? ", a saját régi slugját kapja vissza" : ""})`,
    );
  sorok.push(`TERMÉK: ${plan.products.length} besorolás változik`);
  for (const p of plan.products)
    sorok.push(
      `  ${p.sku}: ${
        p.rows.length === 0
          ? "kikerül a fából"
          : p.rows.map((r) => (r.isPrimary ? `*${r.slug}` : r.slug)).join(", ")
      }`,
    );
  sorok.push(`UNAS-LEKÉPEZÉS: ${plan.mappings.length} változik`);
  for (const m of plan.mappings)
    sorok.push(
      `  ${m.unasCategoryId} -> ${m.storeCategorySlug ?? "(nincs pár)"}${m.note ? ` (${m.note})` : ""}`,
    );
  if (plan.conflicts.length) {
    sorok.push(`ÜTKÖZÉS: ${plan.conflicts.length}, a terv NEM alkalmazható`);
    for (const c of plan.conflicts) sorok.push(`  ! ${c}`);
  }
  return `${sorok.join("\n")}\n`;
}
