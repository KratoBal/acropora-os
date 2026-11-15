import {
  categoryHandle,
  medusaDefaultHandle,
} from "../../integrations/medusa/medusa-category-handle.js";
import {
  categoryRowsFromOurTree,
  categoryTitle,
  legacyCategoryTitle,
  utkozoNevek,
} from "../../integrations/medusa/medusa-category-tree.js";
import { MemoryRedirectStore } from "./redirect-memory-store.js";
import { normalizeRedirectPath, redirectPathLower } from "./redirect-path.js";
import {
  RedirectError,
  redirectInvariantViolations,
  writeRedirect,
  type RedirectRule,
} from "./redirect-writer.js";

/**
 * A RÉGI UNAS-KATEGÓRIACÍMEK ÁTIRÁNYÍTÁSA (commerce audit P1, "régi UNAS-linkek";
 * a séma megjegyzésében "PR 10c" néven várt). A termékcímek átirányítása
 * (`redirect-backfill.ts`) megvan; a kategóriáké nem volt: a teszt kirakat a régi
 * bolt 1833 útjából 1578-ra adott 301-et, a maradék 255-ből 107 `/spl/`, 30 `/sct/`
 * és ~70 egy- vagy többszegmensű kategóriacím volt (mérve 2026-10-30).
 *
 * A BEMENET A RÉGI BOLT ÚTLISTÁJA (a sitemap), NEM KITALÁLT CÍMEK. Egy UNAS
 * kategóriának több címe van (`/spl/<id>/<név>`, `/sct/<id>/<név>`, a
 * névszlugos út), és a `<név>` részt a UNAS képzi; az ÉLŐ listából vett pontos út
 * az egyetlen, ami biztosan egyezik azzal, amit a vevő vagy a Google kapott.
 *
 * MELYIK KATEGÓRIÁHOZ TARTOZIK EGY ÚT:
 *  - `/spl/<id>/…` és `/sct/<id>/…`: a UNAS-azonosító (`ExternalReference`
 *    UNAS/Category) egyértelműen megmondja. Ismeretlen azonosító (pl. `/sct/0/`)
 *    vagy törölt kategória: nincs szabály, a jelentés listázza.
 *  - névszlugos út (`/eledelek`, `/eledelek/koralltapok/aquaforest`): minden
 *    szegmens a kategória nevének webcíme (`categoryHandle`), és a szegmensek a
 *    szülőláncot adják (a gyökér, a "Termékek", elmaradhat). EGYETLEN találat
 *    kell: kettő vagy több (egy `/aquaforest` sok szülő alatt) KÉTÉRTELMŰ, ahhoz
 *    nem írunk, és a jelentés felsorolja a jelölteket. Találat nélkül sem írunk
 *    (a termékcímek, a `/spg/` blog- és információs oldalak és a statikus lapok
 *    ide esnek, és nem kategóriák).
 *
 * A CÉL: `/hu/categories/<handle>`: a kirakat a kategóriát a Medusa HANDLE-jével
 * szolgálja (`categories/[...category]`), az OS `webshopCategoryPath`
 * (`/hu/kategoria/<slug>`) a kirakaton nem létezik, oda a 301 egy 404-re vinne.
 * A handle UGYANAZ a számítás, amivel a Medusába kerül (`categoryHandle` a
 * `categoryTitle`-ből), tehát nincs külön szabály, ami elcsúszhatna.
 *
 * KÉT CÍMKÉPLET: `current` a döntött szabály (a szülő neve csak ütközésnél kerül a
 * címbe, Balázs 2026-09-04), `legacy` a teszt Medusa MAI 219 kategóriájáé (minden
 * nem gyökéren `{név} - {szülő}`). A cél csak akkor 200, ha a Medusában az a
 * handle él: a teszten a mai alak a `legacy` a kategória-átvétel (adopt) előtt, a
 * `current` utána. A parancs ezért nem tippel: a hívó mondja meg.
 *
 * Alapból SZÁRAZFUTÁS, és a `writeRedirect` a termékekkel azonos őrökkel fut
 * (lánc, kör, kisbetűs ütközés, idegen cél).
 */
export type CategoryHandleForm = "current" | "legacy" | "medusa";

/**
 * A MEDUSA TÉNYLEGES KATEGÓRIÁJA (a kirakat `/store/product-categories` listájából): a `handle` az,
 * amit a kirakat szolgál. `parent`: a szülő handle-je (gyökér: null).
 */
export interface MedusaCategoryRef {
  handle: string;
  name: string;
  parent: string | null;
}

/**
 * A lista bemenete két alakban jöhet: a tömör ({handle, name, parent}) és a Medusa nyers válaszáé
 * ({id, handle, name, parent_category_id}); az utóbbit a szülő azonosítóból handle-re fordítja.
 */
export function normalizeMedusaCategories(raw: unknown): MedusaCategoryRef[] {
  const list = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === "object" &&
        Array.isArray(
          (raw as { product_categories?: unknown }).product_categories,
        )
      ? (raw as { product_categories: unknown[] }).product_categories
      : null;
  if (!list)
    throw new Error("a Medusa-kategóriák listája hiányzik vagy nem lista");
  const rows = list as Record<string, unknown>[];
  const handleById = new Map<string, string>();
  for (const r of rows)
    if (typeof r.id === "string" && typeof r.handle === "string")
      handleById.set(r.id, r.handle);
  return rows.map((r) => {
    if (typeof r.handle !== "string" || typeof r.name !== "string")
      throw new Error("a Medusa-kategóriának handle és name mezője kell");
    const parent =
      typeof r.parent === "string"
        ? r.parent
        : typeof r.parent_category_id === "string"
          ? (handleById.get(r.parent_category_id) ?? null)
          : null;
    if (typeof r.parent_category_id === "string" && parent === null)
      throw new Error(`a(z) ${r.handle} kategória szülője nincs a listában`);
    return { handle: r.handle, name: r.name, parent };
  });
}

export interface CategoryForRedirect {
  /** Az OS `Category.id`-je. */
  id: string;
  /** A UNAS-azonosító (`ExternalReference` UNAS/Category `externalId`); nincs: null. */
  unasId: string | null;
  name: string;
  parentId: string | null;
}

export interface CategoryRedirectReport {
  paths: number;
  categories: number;
  created: number;
  /** Az új szabályok soronként (barracuda 38327 a): a szárazfutás után végigolvasható. */
  createdRules: { source: string; destination: string }[];
  unchanged: number;
  repointed: number;
  /** Egy út, amihez már van MÁS célú szabály: nem írtuk felül. */
  conflicts: { source: string; existing: string; wanted: string }[];
  /**
   * `repoint` módban: a meglévő `UNAS_CATEGORY` szabály, aminek a célját a mai handle-re írtuk át (a kategória-átvétel
   * (adopt) óta a régi `név---szülő` handle-alak 404-et ad). Kézi vagy más eredetű szabályhoz nem nyúl: az a `conflicts`-ban marad.
   */
  rewritten: { source: string; from: string; to: string }[];
  refused: { source: string; kind: string; message: string }[];
  /** `/spl/` vagy `/sct/` út, amelynek azonosítója nem kategóriánk. */
  unknownId: string[];
  /** Névszlugos út, amihez több kategória illik. A `fallback` a meglévő szabály régi kezelőjének ítélete (lásd `LegacyVerdict`). */
  ambiguous: {
    source: string;
    candidates: string[];
    fallback?: LegacyVerdict;
    rule?: RuleOrigin;
  }[];
  /** Nem kategória-szerű út (termék, blog, statikus lap): nem érintjük. */
  skipped: number;
  /**
   * A KIHAGYOTT UTAK SORONKÉNT (card f6cb0a51, a #2595 szárazfutása után): MIÉRT maradt ki, mi áll az úton a meglévő szabályok közt
   * (cél, eredet, aktív-e), és mit mondott a régi kezelős tartalék. Egy szám nem mondja meg, melyik ágon akadt el a 21 kategória-célú út.
   */
  skippedDetails: SkippedDetail[];
  /** Két kategória ugyanazt a handle-t kapná: a cél nem egyedi, egyik sem íródik. */
  handleCollisions: string[];
  /** `medusa` képletnél: az út kategóriájához nincs (vagy kettő) Medusa-kategória, nincs szabály. */
  noMedusaCategory: string[];
  invariantViolations: RedirectRule[];
}

/** Miért nem döntött a meglévő szabály régi kezelője (vagy hogy döntött). */
export type LegacyVerdict =
  /** A tartalékot nem kérdeztük meg: az út a névtől függetlenül kimaradt (nem út, spg/spd lap, statikus lap). */
  | "not-consulted"
  | "no-rule"
  | "rule-inactive"
  | `rule-reason-${string}`
  | "destination-not-category-path"
  | "legacy-no-match"
  | "legacy-multiple"
  | "legacy-found";

/**
 * EGY MEGLÉVŐ SZABÁLY EREDETE, ahogy a riport kiírja (card f6cb0a51): a cél, az eredet-jelölő, az aktív-e, és KI és MIKOR hozta létre. A
 * keletkezés ideje és szerzője mondja meg, hogy egy MANUAL szabály tömeges importból jött (egy szerző, egy időablak) vagy kézzel (szétszórva).
 */
export interface RuleOrigin {
  destination: string;
  reason: string;
  isActive: boolean;
  createdAt?: string;
  createdById?: string | null;
}

export interface SkippedDetail {
  source: string;
  /** Az ok: nem út, spg/spd lap, statikus lap, vagy hogy a név nem talált kategóriát. */
  why: "not-a-path" | "spg-spd-page" | "static-page" | "no-name-match";
  /** A meglévő szabály ezen az úton (nincs: hiányzik). */
  rule?: RuleOrigin;
  fallback: LegacyVerdict;
}

interface Resolved {
  id: string;
  handle: string;
}

/**
 * A kategóriák handle-je. `current` és `legacy`: a Medusába kerülő számítás ugyanaz, a képlet a
 * címet választja. `medusa`: a kirakat TÉNYLEGES handle-je, a Medusa-kategória nevéből és szülőjéből
 * párosítva (a mai teszt Medusa kategóriái a nyers `kebabCase(cím)` handle-t hordják: ékezettel és
 * három kötőjellel, `eledelek---termékek`, amit sem a `current`, sem a `legacy` nem ad vissza; az
 * átvétel (adopt) előtt csak a `medusa` alak mutat élő oldalra). Nem párosítható kategória
 * (nincs, vagy kettő illik) NINCS a térképben.
 */
export function categoryHandles(
  categories: readonly CategoryForRedirect[],
  form: CategoryHandleForm,
  medusa?: readonly MedusaCategoryRef[],
): Map<string, string> {
  if (form === "medusa") return medusaHandles(categories, medusa ?? []);
  const rows = categoryRowsFromOurTree(
    categories.map((c) => ({ id: c.id, parentId: c.parentId, name: c.name })),
  );
  const nevek = new Map(rows.map((r) => [r.ourId, r.name]));
  const utkozo = utkozoNevek(rows);
  const out = new Map<string, string>();
  for (const sor of rows) {
    const szulo = sor.parentOurId ? (nevek.get(sor.parentOurId) ?? null) : null;
    const cim =
      form === "legacy"
        ? legacyCategoryTitle(sor.name, szulo)
        : categoryTitle(sor.name, szulo, utkozo.has(sor.name));
    out.set(sor.ourId, categoryHandle(cim));
  }
  return out;
}

/** Egy kategória nevei a gyökértől: az összevetés kulcsa (név és szülő-útvonal EGYÜTT, mint az átvételnél). */
const pathKey = (names: readonly string[]) =>
  names.map((n) => n.trim().toLowerCase()).join(" > ");

function medusaHandles(
  categories: readonly CategoryForRedirect[],
  medusa: readonly MedusaCategoryRef[],
): Map<string, string> {
  const byHandle = new Map(medusa.map((m) => [m.handle, m]));
  // a Medusa-kategória NEVE a cím (`{név} - {szülő}` vagy csak a név, a képlettől függően): a tiszta
  // nevet a szülő tiszta nevének lecsípésével kapjuk, és CSAK ha a cím azzal végződik (egy tiszta név,
  // ami maga tartalmaz " - "-t, ép marad: "RKS - Fogyáshoz igazított nyomelem rendszer")
  const plainCache = new Map<string, string>();
  const plainOf = (m: MedusaCategoryRef, guard = 0): string => {
    const cached = plainCache.get(m.handle);
    if (cached !== undefined) return cached;
    let plain = m.name;
    const parent = m.parent && guard < 64 ? byHandle.get(m.parent) : undefined;
    if (parent) {
      const suffix = ` - ${plainOf(parent, guard + 1)}`;
      if (m.name.endsWith(suffix)) plain = m.name.slice(0, -suffix.length);
    }
    plainCache.set(m.handle, plain);
    return plain;
  };
  const medusaPath = (m: MedusaCategoryRef): string[] => {
    const out: string[] = [];
    let cur: MedusaCategoryRef | undefined = m;
    for (let guard = 0; cur && guard < 64; guard++) {
      out.unshift(plainOf(cur));
      cur = cur.parent ? byHandle.get(cur.parent) : undefined;
    }
    return out;
  };
  const medusaByPath = new Map<string, MedusaCategoryRef[]>();
  for (const m of medusa) {
    const k = pathKey(medusaPath(m));
    medusaByPath.set(k, [...(medusaByPath.get(k) ?? []), m]);
  }
  const byId = new Map(categories.map((c) => [c.id, c]));
  const ourPath = (c: CategoryForRedirect): string[] => {
    const out: string[] = [];
    let cur: CategoryForRedirect | undefined = c;
    for (let guard = 0; cur && guard < 64; guard++) {
      out.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  };
  const out = new Map<string, string>();
  for (const c of categories) {
    const hits = medusaByPath.get(pathKey(ourPath(c))) ?? [];
    if (hits.length === 1) out.set(c.id, hits[0]!.handle);
  }
  return out;
}

const ID_UTAK = /^\/(?:spl|sct)\/([^/]+)(?:\/.*)?$/i;

/** Egy szegmens összevetési alakja: ugyanaz a webcím-képzés, mint a handle-nél, nagybetű nélkül. */
const szegmens = (text: string): string => categoryHandle(text);

export async function planCategoryRedirectBackfill(
  paths: readonly string[],
  categories: readonly CategoryForRedirect[],
  existing: readonly RedirectRule[],
  options: {
    form: CategoryHandleForm;
    medusa?: readonly MedusaCategoryRef[];
    /** A meglévő `UNAS_CATEGORY` szabály célját átírja a mai handle-re (alapból hamis: felülírás nincs). */
    repoint?: boolean;
  } = { form: "current" },
): Promise<{ store: MemoryRedirectStore; report: CategoryRedirectReport }> {
  const store = new MemoryRedirectStore(existing);
  const existingBySource = new Map(
    existing.map((r) => [redirectPathLower(r.sourcePath), r]),
  );
  const report: CategoryRedirectReport = {
    paths: paths.length,
    categories: categories.length,
    created: 0,
    createdRules: [],
    unchanged: 0,
    repointed: 0,
    conflicts: [],
    rewritten: [],
    refused: [],
    unknownId: [],
    ambiguous: [],
    skipped: 0,
    skippedDetails: [],
    handleCollisions: [],
    noMedusaCategory: [],
    invariantViolations: [],
  };
  const handles = categoryHandles(categories, options.form, options.medusa);
  // egy handle csak egy kategóriáé lehet: ütközésnél egyik sem kap szabályt (a cél nem egyértelmű)
  const handleOwners = new Map<string, string[]>();
  for (const [id, handle] of handles)
    handleOwners.set(handle, [...(handleOwners.get(handle) ?? []), id]);
  const colliding = new Set<string>();
  for (const [handle, owners] of handleOwners)
    if (owners.length > 1) {
      report.handleCollisions.push(handle);
      for (const id of owners) colliding.add(id);
    }

  const byUnasId = new Map<string, CategoryForRedirect>();
  for (const c of categories) if (c.unasId) byUnasId.set(c.unasId, c);
  const byId = new Map(categories.map((c) => [c.id, c]));
  // névszlug -> a kategóriák, amelyek ezt a nevet viselik
  const bySlug = new Map<string, CategoryForRedirect[]>();
  for (const c of categories) {
    const slug = szegmens(c.name);
    if (slug) bySlug.set(slug, [...(bySlug.get(slug) ?? []), c]);
  }

  /** A kategória szülőláncának névszlugjai, a legközelebbi szülő elöl. */
  const chainOf = (c: CategoryForRedirect): string[] => {
    const out: string[] = [];
    let cur = c.parentId ? byId.get(c.parentId) : undefined;
    for (let guard = 0; cur && guard < 64; guard++) {
      out.push(szegmens(cur.name));
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  };

  /**
   * A REGI KEZELO: a kategoria cime a szuloveles (`{nev} - {szulo}`), a Medusa sajat kebab-alakjaban. A meglevo UNAS_CATEGORY
   * szabaly celja (`/hu/categories/<regi kezelo>`) ezt hordozza, tehat egy olyan utat is vissza lehet vele keresni, amelynek a neve
   * nem egyezik a kategoriaeval (marka-alut: `/aramoltatok/aquamedic`; atnevezes: `aqualight` kontra `AquaLight`).
   */
  const byLegacyHandle = new Map<string, CategoryForRedirect[]>();
  for (const c of categories) {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    const key = medusaDefaultHandle(
      legacyCategoryTitle(c.name, parent?.name ?? null),
    );
    byLegacyHandle.set(key, [...(byLegacyHandle.get(key) ?? []), c]);
  }
  /**
   * A meglevo, SAJAT eredetu szabaly celjabol a kategoriak, amelyeknek a regi kezeloje az, ES az itelet, hogy miert (nem) talalt:
   * a jelentes ebbol mondja meg, melyik agon akadt el egy ut.
   */
  const legacyLookup = (
    source: string,
  ): { categories: CategoryForRedirect[]; verdict: LegacyVerdict } => {
    const rule = existingBySource.get(redirectPathLower(source));
    if (!rule) return { categories: [], verdict: "no-rule" };
    if (!rule.isActive) return { categories: [], verdict: "rule-inactive" };
    if (rule.reason !== "UNAS_CATEGORY")
      return {
        categories: [],
        verdict: `rule-reason-${rule.reason ?? "none"}`,
      };
    const match = /^\/hu\/categories\/(.+)$/.exec(rule.destinationPath);
    if (!match)
      return { categories: [], verdict: "destination-not-category-path" };
    let handle = match[1]!;
    try {
      handle = decodeURIComponent(handle);
    } catch {
      // nem dekodolhato alak: a nyers szoveg marad, es valoszinuleg nem talal
    }
    const found = byLegacyHandle.get(handle.toLowerCase()) ?? [];
    return {
      categories: found,
      verdict:
        found.length === 0
          ? "legacy-no-match"
          : found.length > 1
            ? "legacy-multiple"
            : "legacy-found",
    };
  };
  const viaExistingRule = (source: string): CategoryForRedirect[] =>
    legacyLookup(source).categories;
  /** A meglevo szabaly eredete a riporthoz (nincs szabaly: nincs mezo). */
  const ruleOrigin = (source: string): { rule?: RuleOrigin } => {
    const rule = existingBySource.get(redirectPathLower(source));
    if (!rule) return {};
    return {
      rule: {
        destination: rule.destinationPath,
        reason: rule.reason ?? "none",
        isActive: rule.isActive,
        ...(rule.createdAt !== undefined
          ? { createdAt: new Date(rule.createdAt).toISOString() }
          : {}),
        ...(rule.createdById !== undefined
          ? { createdById: rule.createdById }
          : {}),
      },
    };
  };
  /** Miert maradt ki egy ut: ugyanazok a feltetelek, mint a `resolve`-ban, sorrendben. */
  const whySkipped = (source: string): SkippedDetail["why"] => {
    const segs = source.split("/").filter(Boolean).map(szegmens);
    if (segs.length === 0 || segs.some((x) => x === "")) return "not-a-path";
    if (/^(spg|spd|sct|spl)$/i.test(source.split("/")[1] ?? ""))
      return "spg-spd-page";
    if (source.toLowerCase().includes(".php")) return "static-page";
    return "no-name-match";
  };

  const resolve = (
    source: string,
  ): Resolved | "unknown" | "no-medusa" | CategoryForRedirect[] | null => {
    const idMatch = ID_UTAK.exec(source);
    if (idMatch) {
      const cat = byUnasId.get(idMatch[1]!);
      if (!cat) return "unknown";
      const handle = handles.get(cat.id);
      return handle ? { id: cat.id, handle } : "no-medusa";
    }
    const segs = source.split("/").filter(Boolean).map(szegmens);
    if (segs.length === 0 || segs.some((s) => s === "")) return null;
    // a /spg/ blog- és információs lapok, a *.php statikus lapok nem kategóriák
    if (/^(spg|spd|sct|spl)$/i.test(source.split("/")[1] ?? "")) return null;
    if (source.toLowerCase().includes(".php")) return null;
    const last = segs[segs.length - 1]!;
    const candidates = (bySlug.get(last) ?? []).filter((c) => {
      const chain = chainOf(c);
      // a szegmensek a szülőláncot követik; a gyökér ("Termékek") elmaradhat
      return segs
        .slice(0, -1)
        .reverse()
        .every((s, i) => chain[i] === s);
    });
    const pick = (c: CategoryForRedirect) => {
      const handle = handles.get(c.id);
      return handle ? { id: c.id, handle } : ("no-medusa" as const);
    };
    if (candidates.length === 1) return pick(candidates[0]!);
    // a NEV nem dont (nincs vagy tobb jelolt): a meglevo szabaly regi kezeloje dont, CSAK ha pontosan egy kategoriat jelol
    const viaRule = viaExistingRule(source);
    if (candidates.length === 0)
      return viaRule.length === 1 ? pick(viaRule[0]!) : null;
    const narrowed = candidates.filter((c) =>
      viaRule.some((v) => v.id === c.id),
    );
    return narrowed.length === 1 ? pick(narrowed[0]!) : candidates;
  };

  // a sorrend rögzített: kétszer ugyanaz a lista ugyanazt a jelentést adja
  const sorted = [
    ...new Set(
      paths
        .map((p) => normalizeRedirectPath(p))
        .filter((p): p is string => p !== null && p !== "/"),
    ),
  ].sort();
  for (const source of sorted) {
    const found = resolve(source);
    if (found === null) {
      report.skipped += 1;
      const why = whySkipped(source);
      report.skippedDetails.push({
        source,
        why,
        ...ruleOrigin(source),
        fallback:
          why === "no-name-match"
            ? legacyLookup(source).verdict
            : "not-consulted",
      });
      continue;
    }
    if (found === "unknown") {
      report.unknownId.push(source);
      continue;
    }
    if (found === "no-medusa") {
      report.noMedusaCategory.push(source);
      continue;
    }
    if (Array.isArray(found)) {
      report.ambiguous.push({
        source,
        candidates: found
          .map((c) => handles.get(c.id) ?? `(nincs Medusa: ${c.name})`)
          .sort(),
        fallback: legacyLookup(source).verdict,
        ...ruleOrigin(source),
      });
      continue;
    }
    if (colliding.has(found.id)) {
      report.refused.push({
        source,
        kind: "handle-collision",
        message: `a(z) ${found.handle} handle-t több kategória kapná`,
      });
      continue;
    }
    const destination = `/hu/categories/${found.handle}`;
    // csak a SAJAT eredetű (UNAS_CATEGORY) szabály írható át; a kézi vagy más eredetű marad, és a `conflicts`-ba kerül
    const meglevo = existingBySource.get(redirectPathLower(source));
    const atirhato =
      options.repoint === true &&
      meglevo?.isActive === true &&
      meglevo.reason === "UNAS_CATEGORY";
    try {
      const eredmeny = await writeRedirect(store, {
        source,
        destination,
        reason: "UNAS_CATEGORY",
        onExisting: atirhato ? "replace" : "keep",
      });
      report.repointed += eredmeny.repointed;
      if (eredmeny.status === "unchanged") report.unchanged += 1;
      else if (eredmeny.status === "updated" && meglevo)
        report.rewritten.push({
          source,
          from: meglevo.destinationPath,
          to: destination,
        });
      else if (eredmeny.status === "conflict")
        report.conflicts.push({
          source,
          existing: eredmeny.existingDestination,
          wanted: destination,
        });
      else {
        report.created += 1;
        report.createdRules.push({ source, destination });
      }
    } catch (error) {
      if (!(error instanceof RedirectError)) throw error;
      report.refused.push({
        source,
        kind: error.kind,
        message: error.message,
      });
    }
  }
  report.invariantViolations = await redirectInvariantViolations(store);
  return { store, report };
}

/** A szabaly eredete egy sorban: eredet, aktiv-e, keszito es ido (ha az olvaso betoltotte). */
function describeRuleOrigin(rule: RuleOrigin): string {
  return [
    rule.reason,
    rule.isActive ? "" : "inaktiv",
    rule.createdById !== undefined
      ? `keszito: ${rule.createdById ?? "nincs"}`
      : "",
    rule.createdAt ? `letrehozva: ${rule.createdAt}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function describeCategoryRedirectBackfill(
  r: CategoryRedirectReport,
  form: CategoryHandleForm,
): string {
  return [
    `Cimkeplet: ${form === "legacy" ? "regi ({nev} - {szulo} minden nem gyokeren)" : form === "medusa" ? "a Medusa tenyleges handle-je (nev es szulo-utvonal szerint parositva)" : "dontott (a szulo csak utkozeskor)"}`,
    `Utak: ${r.paths}; kategoria: ${r.categories}; nem kategoria-szeru (termek, blog, statikus lap): ${r.skipped}`,
    `Uj szabaly: ${r.created}; valtozatlan: ${r.unchanged}; atirt korabbi cel (lanc-osszevonas): ${r.repointed}`,
    `Ismeretlen UNAS-azonosito (nincs szabaly): ${r.unknownId.length}; ketertelmu (nincs szabaly): ${r.ambiguous.length}; nincs hozza Medusa-kategoria (nincs szabaly): ${r.noMedusaCategory.length}`,
    `Elteroen mar meglevo (nem irtuk felul): ${r.conflicts.length}; atirt cel (repoint, sajat eredetu szabaly): ${r.rewritten.length}; elutasitva: ${r.refused.length}; kozos handle: ${r.handleCollisions.length}`,
    `Invarians (aktiv cel, ami forras): ${r.invariantViolations.length}`,
    ...r.createdRules.map((c) => `  uj: ${c.source} -> ${c.destination}`),
    ...r.unknownId.map((s) => `  ismeretlen azonosito: ${s}`),
    ...r.noMedusaCategory.map((s) => `  nincs Medusa-kategoria: ${s}`),
    ...r.ambiguous.map(
      (a) =>
        `  ketertelmu: ${a.source} -> ${a.candidates.join(" | ")}${a.fallback ? ` (tartalek: ${a.fallback})` : ""}${a.rule ? `; szabaly: ${a.rule.destination} (${describeRuleOrigin(a.rule)})` : ""}`,
    ),
    ...r.skippedDetails.map(
      (d) =>
        `  kihagyva: ${d.source} [${d.why}] szabaly: ${d.rule ? `${d.rule.destination} (${describeRuleOrigin(d.rule)})` : "nincs"}; tartalek: ${d.fallback}`,
    ),
    ...r.conflicts.map(
      (c) =>
        `  elteroen meglevo: ${c.source} -> ${c.existing} (kellene: ${c.wanted})`,
    ),
    ...r.rewritten.map((c) => `  atirva: ${c.source}: ${c.from} -> ${c.to}`),
    ...r.refused.map(
      (x) => `  elutasitva: ${x.source} ${x.kind}: ${x.message}`,
    ),
    ...r.handleCollisions.map((h) => `  kozos handle: ${h}`),
    ...r.invariantViolations.map(
      (v) => `  lanc: ${v.sourcePath} -> ${v.destinationPath}`,
    ),
    "",
  ].join("\n");
}
