import { liveAnimalProductIds } from "./medusa-leftover-kind.js";
import {
  skuParositas,
  type ShippingAttributesCliDatabase,
} from "./medusa-shipping-attributes.cli.js";
import type { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

/**
 * A MULTBELI MARADEK EGYSZERI LISTAJA ES ATNEZETT ATVETELE (kartya c603774e, acrobot 45810, 45825).
 *
 * A commerce #724 elott az OS ugy irta a `pickup_only` erteket, hogy nem jelolte meg. A bolti sor ezert nem mondja meg, hogy az
 * "csak bolti atvetel" az OS levezetese, egy marad (a termek kikerult az elo allat kategoriabol), vagy egy ember keze. A
 * levetel lepese csak a JELOLT sorhoz nyul, tehat ezekhez nem. Ket lepesben, ebben a sorrendben:
 *
 *   1. LISTA (csak olvas): a bolt minden igaz, jelolo nelkuli atvetel sora, az OS-termekkel es azzal, hogy az OS mit mondana rola.
 *   2. ADOPT (csak egy atnezett fajlbol, `--apply` kell hozza): a fajlban felsorolt OS-termekek sora jelolt lesz, ezutan
 *      a levetel lepese kezeli. Amit nem soroltak fel, azt a parancs nem erinti.
 *
 * A besorolas:
 *   live      az OS levezeti (a termek elo allat kategoriaban van): a bolti ertek egyezik azzal, amit az OS mondana
 *   profile   a profil-sor maga mondja ki az atvetelt (tudatos ertek): az OS a profilbol vezeti, jelolo itt nem kell
 *   none      az OS NEM vezetne le: vagy egy kikerult termek maradeka, vagy kezi ertek. EZ A KERDOES RESZ, ezt kell atnezni
 *   unpaired  a bolti sorhoz nincs OS-termek (kotes-sor, egyertelmu SKU-par): nem nyulunk hozza
 * Adoptalhato csak `live` es `none`.
 */
export type PickupAdoptionService = Pick<
  MedusaShippingAttributesService,
  "listShopShippingAttributes" | "osProductOfShop" | "adoptPickupMark"
>;

export type PickupVerdict = "live" | "profile" | "none" | "unpaired";

export interface UnmarkedPickupEntry {
  shopProductId: string;
  osProductId: string | null;
  verdict: PickupVerdict;
  name: string | null;
}

export interface UnmarkedPickupReport {
  /** a bolt szallitasi-jellemzo soranak szama */
  rows: number;
  /** a bolt valaszaban van-e jelolo mezo (egy regebbi bolt nem adja: ott nincs mit jelolni) */
  markKnown: boolean;
  /** hany sor mar jelolt */
  marked: number;
  unmarked: UnmarkedPickupEntry[];
}

const VERDICT_ORDER: Record<PickupVerdict, number> = {
  none: 0,
  live: 1,
  profile: 2,
  unpaired: 3,
};

export async function listUnmarkedPickup(
  service: Pick<
    PickupAdoptionService,
    "listShopShippingAttributes" | "osProductOfShop"
  >,
  options: {
    /** OS-termek -> bolti termek (SKU-par), a kotes-sor mellett. LUSTA: csak akkor hivodik, ha van kotes-sor nelkuli sor. */
    pairing: () => Promise<ReadonlyMap<string, string>>;
    /** az elo allat besorolasu OS-termekek */
    live: ReadonlySet<string>;
    /** az OS-termekek, amelyek profil-sora kimondja a bolti atvetelt */
    profilePickup: ReadonlySet<string>;
    /** OS-termek azonosito -> nev (a lista olvashatosagaert) */
    names: (ids: string[]) => Promise<ReadonlyMap<string, string>>;
  },
): Promise<UnmarkedPickupReport> {
  const rows = await service.listShopShippingAttributes();
  const markKnown =
    !rows.length || rows.some((r) => "pickup_only_derived" in r);
  const marked = rows.filter(
    (r) => r.pickup_only === true && r.pickup_only_derived === true,
  ).length;
  if (!markKnown) return { rows: rows.length, markKnown, marked, unmarked: [] };
  const open = rows.filter(
    (r) => r.pickup_only === true && r.pickup_only_derived !== true,
  );
  let shopToOs: Map<string, string> | null = null;
  const bySku = async (shopProductId: string): Promise<string | null> => {
    if (!shopToOs)
      shopToOs = new Map(
        [...(await options.pairing())].map(([os, shop]) => [shop, os]),
      );
    return shopToOs.get(shopProductId) ?? null;
  };
  const found: { shopProductId: string; osProductId: string | null }[] = [];
  for (const row of open)
    found.push({
      shopProductId: row.product_id,
      osProductId:
        (await service.osProductOfShop(row.product_id)) ??
        (await bySku(row.product_id)),
    });
  const ids = found.flatMap((f) => (f.osProductId ? [f.osProductId] : []));
  const names = ids.length
    ? await options.names(ids)
    : new Map<string, string>();
  const unmarked = found.map((f): UnmarkedPickupEntry => {
    const verdict: PickupVerdict = !f.osProductId
      ? "unpaired"
      : options.profilePickup.has(f.osProductId)
        ? "profile"
        : options.live.has(f.osProductId)
          ? "live"
          : "none";
    return {
      ...f,
      verdict,
      name: f.osProductId ? (names.get(f.osProductId) ?? null) : null,
    };
  });
  unmarked.sort(
    (a, b) =>
      VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] ||
      (a.osProductId ?? a.shopProductId).localeCompare(
        b.osProductId ?? b.shopProductId,
      ),
  );
  return { rows: rows.length, markKnown, marked, unmarked };
}

/** A lista szovege: osszegzes, majd soronkent `OS-azonosito | bolti azonosito | besorolas | nev` (az atnezett fajl elso oszlopa az OS-azonosito). */
export function describeUnmarkedPickup(report: UnmarkedPickupReport): string {
  if (!report.markKnown)
    return `A bolt ${report.rows} szállítási-jellemző sort adott, de a válaszában nincs jelölő mező (a commerce #724 még nincs kint): nincs mit listázni, és jelölni sem lehet.\n`;
  const count = (verdict: PickupVerdict) =>
    report.unmarked.filter((e) => e.verdict === verdict).length;
  const sorok = [
    `Csak bolti átvétel jelölő nélkül: ${report.unmarked.length} sor (a bolt ${report.rows} szállítási-jellemző sort adott, ${report.marked} már jelölt).\n`,
    `  none (az OS nem vezetné le: kikerült termék maradéka vagy kézi érték, EZT KELL ÁTNÉZNI): ${count("none")}\n`,
    `  live (az OS levezeti, a bolti érték egyezik): ${count("live")}\n`,
    `  profile (a profil-sor mondja ki): ${count("profile")}\n`,
    `  unpaired (nincs OS-termék, nem nyúlunk hozzá): ${count("unpaired")}\n`,
  ];
  for (const e of report.unmarked)
    sorok.push(
      `${e.osProductId ?? "-"} | ${e.shopProductId} | ${e.verdict} | ${e.name ?? "-"}\n`,
    );
  return sorok.join("");
}

export interface PickupAdoptionResult {
  /** a fajlban felsorolt, adoptalhato sorok, es hogy mi tortent */
  adopted: {
    osProductId: string;
    medusaProductId: string;
    action: "planned" | "applied" | "unchanged";
  }[];
  /** a fajlban felsorolt azonosito, amit nem adoptalhattunk, es az OKA: egy elgepeles ne maradjon csendben */
  refused: { id: string; reason: string }[];
}

/** Az atnezett fajl: soronkent egy OS-azonosito (az elso szo), a `#` kezdetu es az ures sorok nem szamitanak. */
export function parseReviewedIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    ids.add(trimmed.split(/[\s|]+/)[0]!);
  }
  return ids;
}

export async function adoptPickup(
  service: Pick<PickupAdoptionService, "adoptPickupMark">,
  report: UnmarkedPickupReport,
  reviewed: ReadonlySet<string>,
  apply: boolean,
): Promise<PickupAdoptionResult> {
  const result: PickupAdoptionResult = { adopted: [], refused: [] };
  const byOs = new Map(
    report.unmarked.flatMap((e) =>
      e.osProductId ? [[e.osProductId, e] as const] : [],
    ),
  );
  for (const id of reviewed) {
    const entry = byOs.get(id);
    if (!entry) {
      result.refused.push({
        id,
        reason:
          "nincs a jelölő nélküli átvételek között (már jelölt, nem átvétel, vagy elgépelt azonosító)",
      });
      continue;
    }
    if (entry.verdict !== "none" && entry.verdict !== "live") {
      result.refused.push({
        id,
        reason: `${entry.verdict}: ezt nem lehet adoptálni`,
      });
      continue;
    }
    const outcome = await service.adoptPickupMark(
      { product_id: entry.shopProductId },
      apply,
    );
    result.adopted.push({
      osProductId: id,
      medusaProductId: outcome.medusaProductId,
      action: outcome.action,
    });
  }
  return result;
}

export function describePickupAdoption(
  result: PickupAdoptionResult,
  apply: boolean,
): string {
  const sorok = result.adopted.map(
    (a) =>
      `${a.osProductId}: ${
        a.action === "applied"
          ? "most jelöltük"
          : a.action === "unchanged"
            ? "közben megváltozott, nem nyúltunk hozzá"
            : "JELÖLNÉNK"
      } -> ${a.medusaProductId}\n`,
  );
  for (const r of result.refused)
    sorok.push(`${r.id}: NEM adoptáltuk (${r.reason})\n`);
  const done = result.adopted.filter((a) => a.action !== "unchanged").length;
  sorok.push(
    `Átvétel adoptálása: ${result.adopted.length} adoptálható sor a fájlban, ${done} ${apply ? "jelölve" : "jelölendő"}, ${result.refused.length} elutasítva.\n`,
  );
  return sorok.join("");
}

/** Amit a lista osszeallitasa az OS adatbazisabol olvas: az elo allat besorolas, a profil-sorok, a SKU-parositas es a nev. */
export type PickupAdoptionDatabase = Pick<
  ShippingAttributesCliDatabase,
  | "category"
  | "productCategory"
  | "productShippingProfile"
  | "productVariant"
  | "unasProductSnapshot"
> & {
  product: {
    findMany(args: unknown): Promise<{ id: string; name: string }[]>;
  };
};

/**
 * A LISTA OSSZEALLITASA, EGY HELYEN: a parancs es a vegpont ugyanazt hivja, hogy a ket ut ne mondhasson mast. Csak olvas (a bolt
 * szallitasi-jellemzo sorait es SKU-listajat, az OS adatbazisat).
 */
export async function gatherUnmarkedPickup(
  shipping: Pick<
    MedusaShippingAttributesService,
    "listShopShippingAttributes" | "osProductOfShop" | "listShopSkus"
  >,
  database: PickupAdoptionDatabase,
): Promise<UnmarkedPickupReport> {
  const live = await liveAnimalProductIds(database);
  const profilePickup = new Set(
    (
      await database.productShippingProfile.findMany({
        where: { pickupOnly: true },
        select: { productId: true },
      })
    ).map((sor) => sor.productId),
  );
  return listUnmarkedPickup(shipping, {
    live,
    profilePickup,
    pairing: async () => (await skuParositas(shipping, database)).osToShop,
    names: async (ids) =>
      new Map(
        (
          await database.product.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        ).map((termek) => [termek.id, termek.name]),
      ),
  });
}
