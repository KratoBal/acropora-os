/**
 * A VEVONEK KIADHATO TENY-KULCSOK (SEO P0 PR 2): az aktiv, `public`
 * definiciok kulcsai. Minden teny-olvaso ezt koti be (10. dontes), es egy teny,
 * aminek nincs definicioja, nem kiadhato.
 */
export interface PublicDefinitionsTable {
  attributeDefinition: {
    findMany(args: unknown): Promise<{ key: string }[]>;
  };
}

/*
  A LEKERDEZES A HIVASBAN ALL, NEM EGY KONSTANSBAN: a repo or-tesztje
  (`unas-prisma-select-mezok.spec.ts`) csak a Prisma-hivasban allo `select`-et
  veti ossze a semaval. A repository ugyanezt irja (`knowledge.repository.ts`).
*/
/**
 * A NATÍV CÉLÚ TÉNY-KULCSOK (SEO P0 PR 8, C2: egy érték egy helyre): az aktív
 * definíciók, amelyeknek van `medusaNativeField`-je. Ezek tényei a Medusa
 * változat-mezőibe mennek (tömeg, méretek), vagy nem is tények (EAN), tehát a
 * termékismeretbe nem.
 */
export async function nativeFieldKeys(
  db: PublicDefinitionsTable,
): Promise<ReadonlySet<string>> {
  const rows = await db.attributeDefinition.findMany({
    where: { medusaNativeField: { not: null }, isActive: true },
    select: { key: true },
  });
  return new Set(rows.map((row) => row.key));
}

export async function publicFieldKeys(
  db: PublicDefinitionsTable,
): Promise<ReadonlySet<string>> {
  const rows = await db.attributeDefinition.findMany({
    where: { public: true, isActive: true },
    select: { key: true },
  });
  return new Set(rows.map((row) => row.key));
}
