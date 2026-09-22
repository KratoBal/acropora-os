import type { Prisma } from "@acropora/database";

/**
 * A KATEGORIA SZERINTI SZUKITES -- KET KULON KERDES, KET KULON MEZO.
 *
 * Ugyanaz az alak, mint a matrica-szuronel (`asset-label-filter.ts`), es nem
 * kenyelembol: ott is KET dolgot kerdezhetunk, es a ketto MAS.
 *
 *   `categoryId`   EGY KONKRET kategoria eszkozei
 *   `category`     VAN-E kategoriaja egyaltalan
 *
 * === MIERT KELL A „NINCS" AG, ES MIERT EPP MOST ===
 *
 * Az atvezeto migracio azt a sort hagyja `NULL`-on, aminek a szoveges erteke
 * egyetlen kategoriara sem illeszkedett. Ez SZANDEKOS: egy automatikusan
 * felvett kategoria pont azt hozna vissza, ami miatt a torzsadat letrejott.
 *
 * De ettol keletkezik egy halmaz, amit valakinek VEGIG KELL JARNIA -- es egy
 * szandekosan megengedett allapot CSENDBEN halmozodik, ha semmi nem tudja
 * megkerdezni. Ez a szuro teszi megkerdezhetove.
 *
 * ES UGYANEZ ALL A FELVITELRE: a kategoria elhagyhato mezo, tehat uj sor is
 * keletkezhet kategoria nelkul.
 */
export function assetCategoryWhere(
  category: "with" | "without" | undefined,
  categoryId: string | undefined,
): Prisma.AssetWhereInput {
  const agak: Prisma.AssetWhereInput[] = [];
  if (category === "without") agak.push({ categoryId: null });
  else if (category === "with") agak.push({ categoryId: { not: null } });
  if (categoryId) agak.push({ categoryId });

  if (agak.length === 0) return {};
  if (agak.length === 1) return agak[0]!;
  /**
   * A KETTO EGYUTT IS MEGADHATO, ES AKKOR `AND`. Ellentmondo par (`without` es
   * egy konkret azonosito) URES halmazt ad -- es ez a HELYES: a kerdes maga
   * ellentmondasos, es egy „valasszunk egyet" feloldas azt allitana, hogy
   * ertettuk, amit kerdeztek.
   */
  return { AND: agak };
}
