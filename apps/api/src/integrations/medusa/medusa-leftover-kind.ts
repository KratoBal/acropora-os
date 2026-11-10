import { liveAnimalSubtreeIds } from "./medusa-livestock.policy.js";
import { rowsCarryingKind } from "./medusa-shipping-attributes.policy.js";
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
 * azon a termeken, aminek az OS-ben NINCS elo allat besorolasa. A tobbi zaszlo valtozatlanul visszamegy. A bolti sort,
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
  action: "planned" | "applied";
}

export interface LeftoverKindReport {
  /** hany szallitasi-jellemzo sort adott a bolt */
  rows: number;
  /** ezek kozul hanyon allt fajta */
  carrying: number;
  entries: LeftoverKindEntry[];
  /** fajtat viselo bolti sor, amihez nincs OS-termek: nem nyultunk hozzajuk */
  unpaired: number;
}

export async function clearLeftoverKinds(
  service: LeftoverKindService,
  options: {
    /** az OS-termek NEM torlendo (celpont a fo koron, vagy elo allat besorolasa van) */
    skip(osProductId: string): boolean;
    /** OS-termek -> bolti termek (SKU-par), a kotes-sor mellett */
    osToShop: ReadonlyMap<string, string>;
    /** ha megadott, csak ezekre az OS-termekekre szukit */
    only?: readonly string[];
    apply: boolean;
  },
): Promise<LeftoverKindReport> {
  const rows = await service.listShopShippingAttributes();
  const carrying = rowsCarryingKind(rows);
  const shopToOs = new Map<string, string>(
    [...options.osToShop].map(([os, shop]) => [shop, os]),
  );
  const entries: LeftoverKindEntry[] = [];
  let unpaired = 0;
  for (const row of carrying) {
    const osProductId =
      (await service.osProductOfShop(row.product_id)) ??
      shopToOs.get(row.product_id) ??
      null;
    if (!osProductId) {
      unpaired++;
      continue;
    }
    if (options.skip(osProductId)) continue;
    if (options.only?.length && !options.only.includes(osProductId)) continue;
    const outcome = await service.clearLeftoverKind(row, options.apply);
    entries.push({
      osProductId,
      medusaProductId: outcome.medusaProductId,
      flags: outcome.flags,
      action: outcome.action,
    });
  }
  return { rows: rows.length, carrying: carrying.length, entries, unpaired };
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
        e.action === "applied" ? "most állítottuk be" : "KIKÜLDENÉNK"
      } -> ${e.medusaProductId} (${e.flags})\n`,
  );
  sorok.push(
    `Boltban maradt élő állat fajta: a bolt ${report.rows} szállítási-jellemző sort adott, ${report.carrying}-n áll fajta, ` +
      `${report.entries.length} ${apply ? "törölve" : "törlendő"}, ${report.unpaired} OS-termék nélkül (nem nyúltunk hozzá).\n`,
  );
  return sorok.join("");
}
