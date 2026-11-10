import { liveAnimalSubtreeIds } from "./medusa-livestock.policy.js";
import {
  rowsCarryingDerivedPickup,
  rowsCarryingKind,
} from "./medusa-shipping-attributes.policy.js";
import type { MedusaShippingAttributesService } from "./medusa-shipping-attributes.service.js";

/**
 * A BOLTBAN MARADT ELO ALLAT FAJTA LETORLESE, ES EGYSZER LEIRVA (V2.6 S1b koveto, kartya 4b30b373).
 *
 * Egy termek, ami kikerult a harom elo allat kategoriabol, es nincs szallitasi-jellemzo sora, nem celpontja a
 * szallitasi-jellemzok parancsanak (a celok a profil-sorok es az elo allat besorolasok), ezert a boltban a regi
 * `livestock_kind` marad, es a vevoi level rossz akklimatizacios utmutatot adna. Ez a modul azt keresi meg es torli.
 * KET HIVOJA VAN, EGY SZABALLYAL: a parancs (a #2352-ben, kezi, tervfutassal) es a vetitesi kor egy lepese (alapbol KI,
 * `MEDUSA_CLEAR_LEFTOVER_KIND=true`), mert a rendszeres kezi parancs ellentetes az allo renddel, es a teszten nem is futtathato.
 *
 * AMIT EZ A LEPES TESZ, ES CSAK EZT (acrobot dontese, 2026-11-10): a bolti sor `livestock_kind` mezojet null-ra allitja,
 * azon a termeken, aminek az OS-ben NINCS elo allat besorolasa. Csak a fajta megy (reszleges frissites): a tobbi zaszlot nem kuldjuk, tehat nem is irjuk felul. A bolti sort,
 * amelyhez nincs OS-termek (kotes-sor, utana egyertelmu SKU-par), nem bantja, csak megszamolja.
 */
export type LeftoverKindService = Pick<
  MedusaShippingAttributesService,
  "listShopShippingAttributes" | "osProductOfShop" | "clearLeftoverKind"
>;

export interface LeftoverKindEntry {
  osProductId: string;
  medusaProductId: string;
  /** a bolti sor, ahogy allt, es hogy mi tortent vele */
  flags: string;
  /** `unchanged`: iras elott ujra olvasva a sor mar nem torlendo */
  action: "planned" | "applied" | "unchanged";
}

export interface LeftoverKindReport {
  /** hany szallitasi-jellemzo sort adott a bolt */
  rows: number;
  /** ezek kozul hanyon allt fajta */
  carrying: number;
  /** hanyon all az OS altal szarmaztatott (jelolt) csak bolti atvetel (commerce #724, kartya c603774e) */
  derivedPickup: number;
  entries: LeftoverKindEntry[];
  /** fajtat viselo bolti sor, amihez nincs OS-termek: nem nyultunk hozzajuk */
  unpaired: number;
}

export async function clearLeftoverKinds(
  service: LeftoverKindService,
  options: {
    /** az OS-termek NEM torlendo (celpont a fo koron, vagy elo allat besorolasa van) */
    skip(osProductId: string): boolean;
    /**
     * OS-termek -> bolti termek (SKU-par), a kotes-sor mellett. LUSTA: csak akkor hivodik (egyszer), ha van fajtat viselo
     * bolti sor, amihez nincs kotes-sor; a bolt SKU-listaja lapozott olvasas, ures koron nem kell (barracuda, #2353).
     */
    pairing: () => Promise<ReadonlyMap<string, string>>;
    /** ha megadott, csak ezekre az OS-termekekre szukit */
    only?: readonly string[];
    apply: boolean;
    /** a fajta torlese (alapbol igaz) */
    kind?: boolean;
    /**
     * A SZARMAZTATOTT CSAK BOLTI ATVETEL LEVETELE (kartya c603774e), alapbol KI. Csak ott, ahol a bolti sor `pickup_only` igaz
     * ES az OS jelolte (kezi ertek, jelolo nelkul, soha), az OS-termek nem celpont (`skip`) es a `keep` sem tartja meg
     * (a profil-sora kimondja az atvetelt: az tudatos ertek, nem levezetett).
     */
    pickup?: { keep(osProductId: string): boolean };
  },
): Promise<LeftoverKindReport> {
  const rows = await service.listShopShippingAttributes();
  const wantKind = options.kind ?? true;
  const carrying = rowsCarryingKind(rows);
  const derivedPickup = rowsCarryingDerivedPickup(rows);
  const candidates = new Set<(typeof rows)[number]>([
    ...(wantKind ? carrying : []),
    ...(options.pickup ? derivedPickup : []),
  ]);
  let shopToOs: Map<string, string> | null = null;
  const bySku = async (shopProductId: string): Promise<string | null> => {
    if (!shopToOs)
      shopToOs = new Map(
        [...(await options.pairing())].map(([os, shop]) => [shop, os]),
      );
    return shopToOs.get(shopProductId) ?? null;
  };
  const entries: LeftoverKindEntry[] = [];
  let unpaired = 0;
  for (const row of candidates) {
    const osProductId =
      (await service.osProductOfShop(row.product_id)) ??
      (await bySku(row.product_id));
    if (!osProductId) {
      unpaired++;
      continue;
    }
    if (options.skip(osProductId)) continue;
    if (options.only?.length && !options.only.includes(osProductId)) continue;
    const clear = {
      kind: wantKind && carrying.includes(row),
      pickup:
        !!options.pickup &&
        derivedPickup.includes(row) &&
        !options.pickup.keep(osProductId),
    };
    if (!clear.kind && !clear.pickup) continue;
    const outcome = await service.clearLeftoverKind(row, options.apply, clear);
    entries.push({
      osProductId,
      medusaProductId: outcome.medusaProductId,
      flags: outcome.flags,
      action: outcome.action,
    });
  }
  return {
    rows: rows.length,
    carrying: carrying.length,
    derivedPickup: derivedPickup.length,
    entries,
    unpaired,
  };
}

/** Az elo allat besorolasu OS-termekek: a harom gyoker reszfajaba tartozo besorolas barmelyik sorabol. */
export async function liveAnimalProductIds(database: {
  category: {
    findMany(
      args: unknown,
    ): Promise<{ id: string; name: string; parentId: string | null }[]>;
  };
  productCategory: {
    findMany(
      args: unknown,
    ): Promise<{ productId: string; categoryId: string }[]>;
  };
}): Promise<Set<string>> {
  const kategoriak = await database.category.findMany({
    select: { id: true, name: true, parentId: true },
  });
  const eloAllatIds = liveAnimalSubtreeIds(kategoriak);
  if (!eloAllatIds.size) return new Set();
  const besorolasok = await database.productCategory.findMany({
    where: { categoryId: { in: [...eloAllatIds] } },
    select: { productId: true, categoryId: true },
  });
  return new Set(besorolasok.map((sor) => sor.productId));
}

/** A jelentes sorai: egy sor termekenkent, es egy osszegzo, hogy a kimenet kimondja, mit latott. */
export function describeLeftoverKinds(
  report: LeftoverKindReport,
  apply: boolean,
): string {
  const sorok = report.entries.map(
    (e) =>
      `${e.osProductId}: ${
        e.action === "applied"
          ? "most állítottuk be"
          : e.action === "unchanged"
            ? "közben megváltozott, nem nyúltunk hozzá"
            : "KIKÜLDENÉNK"
      } -> ${e.medusaProductId} (${e.flags})\n`,
  );
  sorok.push(
    `Boltban maradt élő állat fajta: a bolt ${report.rows} szállítási-jellemző sort adott, ${report.carrying}-n áll fajta, ` +
      `${report.entries.filter((e) => e.action !== "unchanged").length} ${apply ? "törölve" : "törlendő"}, ${report.unpaired} OS-termék nélkül (nem nyúltunk hozzá).` +
      // a meglévő mondat változatlan marad (a napló és a tesztek arra illeszkednek): a származtatott átvétel külön tagmondat
      (report.derivedPickup
        ? ` Az OS által jelölt, származtatott bolti átvétel: ${report.derivedPickup} sor.`
        : "") +
      "\n",
  );
  return sorok.join("");
}
