import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import { Prisma, prisma } from "@acropora/database";

import {
  describeBrandMergePlan,
  planBrandMerge,
  type BrandMergePlan,
  type BrandSide,
} from "./brand-merge.js";
import { normalizeBrandName } from "./brands.repository.js";

/**
 * KET MARKA OSSZEVONASA -- EGYSZER FUTO PARANCS, TERV ALAPERTELMEZESSEL.
 *
 * Hasznalat:
 *   pnpm --filter @acropora/api brands:merge --from <id> --into <id>
 *   ... --apply --actor <letezo felhasznalo azonositoja>
 *
 * A PARANCS NEM DONTI EL AZ IRANYT. A hivo adja meg, a terv MIND A KET oldal
 * termekszamat kiirja, es a vegrehajtas csak azutan johet. Egy "9 termek mozdul"
 * sor onmagaban akkor is helyesnek latszik, ha forditva hivtuk.
 */

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

const slugify = (value: string) => normalizeBrandName(value).replace(/ /g, "-");

export async function runBrandMergeCli(
  argv: readonly string[],
  out: CliOutput,
  deps: {
    side(brandId: string): Promise<BrandSide | null>;
    actorExists(actorId: string): Promise<boolean>;
    apply(plan: BrandMergePlan, actorId: string): Promise<void>;
  },
): Promise<number> {
  const ertek = (nev: string) => {
    const i = argv.indexOf(nev);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };
  const fromId = ertek("--from");
  const intoId = ertek("--into");
  const apply = argv.includes("--apply");
  const actorId = ertek("--actor");

  if (!fromId || !intoId) {
    out.stderr(
      "Meg kell nevezni MIND A KETTŐT: --from <márka azonosító> --into <márka azonosító>.\n" +
        "Az irányt a hívó adja meg; a parancs nem találgat.\n",
    );
    return 1;
  }

  const from = await deps.side(fromId);
  const into = await deps.side(intoId);
  if (!from || !into) {
    out.stderr(
      `Nincs ilyen márka: ${!from ? fromId : intoId}. A futás EL SEM INDULT.\n`,
    );
    return 1;
  }

  const plan = planBrandMerge(from, into);
  out.stdout(describeBrandMergePlan(plan));

  if (plan.refusals.length) return 1;

  if (!apply) {
    out.stdout("\nEz a futás semmit nem írt. A végrehajtáshoz: --apply\n");
    return 0;
  }
  if (!actorId) {
    out.stderr(
      "Az íráshoz meg kell nevezni, KI indítja: --actor <felhasználó azonosítója>.\n",
    );
    return 1;
  }
  if (!(await deps.actorExists(actorId))) {
    out.stderr(`Nincs ilyen felhasználó: ${actorId}. Az írás EL SEM INDULT.\n`);
    return 1;
  }

  await deps.apply(plan, actorId);
  out.stdout(
    `\nÖsszevonva. Mozdult termék: ${plan.moveProducts}, átkerült alias: ` +
      `${plan.moveAliases.length}.\n`,
  );
  return 0;
}

/**
 * A TRANZAKCIO TORZSE KULON FUGGVENY, ES EZ NEM STILUS.
 *
 * A sorrendet acrobot kulon kerte kalibralni: "rontsd el ugy, hogy a forras
 * archivalasa a NEV-ALIAS lepes ELE kerul". Ez a rontas csak akkor tud pirosra
 * valtani, ha a hivasi sorrend MERHETO -- amig a torzs a `prisma` peldanyt
 * kozvetlenul hasznalta egy `c8 ignore` blokkban, semmilyen teszt nem latta.
 *
 * Ez a lapunk otodik esete a rontas utani zoldre: nem a rontas rossz es nem az
 * allitas halott, hanem a KOD all olyan helyen, ahova a meres nem er el. Annak
 * egyetlen javitasa van: elmozditani a kodot.
 */
export interface MergeTransaction {
  product: { updateMany(args: unknown): Promise<{ count: number }> };
  brandAlias: {
    update(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<unknown>;
    findMany(
      args: unknown,
    ): Promise<{ alias: string; normalizedAlias: string; brandId: string }[]>;
  };
  brand: {
    update(args: unknown): Promise<unknown>;
    findMany(
      args: unknown,
    ): Promise<{ id: string; name: string; normalizedName: string }[]>;
  };
  auditLog: { create(args: unknown): Promise<unknown> };
  domainEvent: { create(args: unknown): Promise<unknown> };
}

/* c8 ignore start -- a belepesi pont: a merheto resz a `runBrandMergeCli`. */
async function side(brandId: string): Promise<BrandSide | null> {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      isActive: true,
      aliases: { select: { id: true, alias: true, normalizedAlias: true } },
    },
  });
  if (!brand) return null;
  return {
    ...brand,
    productCount: await prisma.product.count({ where: { brandId } }),
  };
}

/**
 * A SORREND KOTOTT, ES MINDEGYIK LEPES A KOVETKEZOT TESZI LEHETOVE.
 *
 *   1. termekek       amig itt allnak, a forras nem uritheto
 *   2. aliasok        a nem utkozok atkerulnek
 *   3. ATNEVEZES      EZ SZABADITJA FEL a forras nevenek kulcsat
 *   4. nev aliaskent  csak a 3. UTAN lehetseges: elotte a forras birtokolja
 *   5. archivalas     a vegen, mert addig a forras meg "el"
 *   6. zaro ellenorzes
 *
 * A 4. lepes a 3. ELOTT elhasalna, es epp ezert all a sorrend TESZTBEN is: egy
 * leirt sorrend nem vedelem.
 */
async function applyPlan(plan: BrandMergePlan, actorId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) =>
      mergeInTransaction(tx as unknown as MergeTransaction, plan, actorId),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
/* c8 ignore stop */

export async function mergeInTransaction(
  tx: MergeTransaction,
  plan: BrandMergePlan,
  actorId: string,
): Promise<void> {
  {
    {
      await tx.product.updateMany({
        where: { brandId: plan.from.id },
        data: { brandId: plan.into.id },
      });
      for (const alias of plan.moveAliases)
        await tx.brandAlias.update({
          where: { id: alias.id },
          data: { brandId: plan.into.id },
        });
      await tx.brand.update({
        where: { id: plan.from.id },
        data: {
          name: plan.retiredName,
          normalizedName: normalizeBrandName(plan.retiredName),
          slug: slugify(plan.retiredName),
        },
      });
      if (plan.nameAsAlias)
        await tx.brandAlias.create({
          data: {
            brandId: plan.into.id,
            alias: plan.nameAsAlias,
            normalizedAlias: normalizeBrandName(plan.nameAsAlias),
            source: "MERGE",
            isPreferred: false,
          },
        });
      await tx.brand.update({
        where: { id: plan.from.id },
        data: { isActive: false, archivedAt: new Date() },
      });

      /**
       * A ZARO ORZO: A MOZGATAS KELETKEZTETHETI AZT, AMIT TILT.
       *
       * Egy normalizalt kulcs nem lehet egyszerre az egyik marka NEVE es a masik
       * ALIASA -- onnantol a visszatoltes nem tudja eldonteni, melyikhez tartozik
       * egy nyers ertek. Ez az ellenorzes a tranzakcio VEGEN all, nem az elejen:
       * az elejen meg nem letezik az az allapot, amit tiltunk.
       */
      const nevek = await tx.brand.findMany({
        select: { id: true, name: true, normalizedName: true },
      });
      const nevHez = new Map(nevek.map((b) => [b.normalizedName, b]));
      const utkozok = await tx.brandAlias.findMany({
        where: { normalizedAlias: { in: [...nevHez.keys()] } },
        select: { alias: true, normalizedAlias: true, brandId: true },
      });
      const valodi = utkozok.filter(
        (a) => nevHez.get(a.normalizedAlias)!.id !== a.brandId,
      );
      if (valodi.length)
        throw new Error(
          "MERGE_WOULD_LEAVE_AMBIGUOUS_KEY: " +
            valodi
              .map(
                (a) =>
                  `"${a.normalizedAlias}" (a(z) "${nevHez.get(a.normalizedAlias)!.name}" NEVE és egy másik márka ALIASA)`,
              )
              .join(", "),
        );

      const metadata = {
        fromId: plan.from.id,
        fromName: plan.from.name,
        retiredName: plan.retiredName,
        intoId: plan.into.id,
        intoName: plan.into.name,
        movedProducts: plan.moveProducts,
        movedAliases: plan.moveAliases.map((a) => a.alias),
      } satisfies Prisma.JsonObject;
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "brand.merged",
          entityType: "Brand",
          entityId: plan.into.id,
          metadata,
        },
      });
      await tx.domainEvent.create({
        data: {
          id: randomUUID(),
          eventType: "brand.merged",
          aggregateType: "Brand",
          aggregateId: plan.into.id,
          actorUserId: actorId,
          payload: metadata,
          occurredAt: new Date(),
        },
      });
    }
  }
}

/* c8 ignore start -- a belepesi pont */
async function main(): Promise<void> {
  const out: CliOutput = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  };
  process.exitCode = await runBrandMergeCli(process.argv.slice(2), out, {
    side,
    actorExists: async (actorId: string) =>
      (await prisma.user.count({ where: { id: actorId } })) === 1,
    apply: applyPlan,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
/* c8 ignore stop */
