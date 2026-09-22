import type { Prisma } from "@acropora/database";

/**
 * KET WHERE-RESZLET OSSZEFUZESE UGY, HOGY EGYIK SE NYELJE EL A MASIKAT.
 *
 * MIERT LETEZIK EZ A FAJL (merve 2026-09-22, sajat hiba, a kapuk NEM fogtak meg):
 * a lista where-je objektum-literalba SZORJA a reszleteket. Ket olyan szoro,
 * ami ugyanarra a KULCSRA ir, a masodik szorasnal NEMAN felulirja az elsot --
 * es ez pontosan az a hiba, amit a `assetLabelWhere` fejlece mar leir, EGY
 * SZINTTEL LEJJEBB (ott ket AG irt ugyanarra a `label` kulcsra).
 *
 * MOST EGGYEL FELJEBB ALLT ELO UGYANAZ: a matrica-szuro ES a kategoria-szuro
 * IS `{ AND: [...] }` alakot ad vissza, ha ket aga van. Ket szoras, ugyanaz a
 * kulcs -- a matrica-feltetel CSENDBEN eltunt volna egy
 * `label=without&labelCode=X&category=without&categoryId=Y` hivasnal.
 *
 * ES AMIERT EGYIK KAPU SEM SZOLT: a fordito a szoras-utkozest nem latja (a
 * kulcs futasidoben all elo), a teszteknek pedig egyik sem kombinalta a ket
 * szurot. A hiba nem ures listat adott volna, hanem egy ERTELMES, NEM URES
 * valaszt a MASIK kerdesre -- ugyanaz az alak, amit a matrica-szuronel mar
 * egyszer megfizettunk.
 *
 * AZ `AND` CSAK AKKOR KERUL BE, HA TENYLEG KET ERDEMI RESZ VAN. Egy resszel a
 * visszaadott objektum BETURE ugyanaz, mint korabban, tehat a meglevo hivasok
 * lekerdezese nem valtozik attol, hogy ez a fuggveny bekerult.
 */
export function mergeAssetWhere(
  ...parts: Prisma.AssetWhereInput[]
): Prisma.AssetWhereInput {
  const erdemi = parts.filter((part) => Object.keys(part).length > 0);
  if (erdemi.length === 0) return {};
  if (erdemi.length === 1) return erdemi[0]!;
  return { AND: erdemi };
}
