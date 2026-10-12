import type { Prisma } from "@acropora/database";

import {
  lockRedirectWrites,
  PrismaRedirectStore,
} from "../products/redirect/redirect.repository.js";
import { webshopBrandPath } from "../products/redirect/redirect-path.js";
import {
  writeRedirect,
  type WriteRedirectInput,
} from "../products/redirect/redirect-writer.js";

/**
 * A MÁRKA SLUG-CSERÉJE (t11, barracuda #1678 C pontja). A márka slugja a nevéből
 * jön, tehát egy átnevezés a `/hu/marka/{slug}` címet is cseréli. Eddig a régi
 * cím átirányítás nélkül 404 lett; mostantól ugyanaz történik, mint a
 * kategóriánál (`store-category-load.repository.ts`):
 *
 * - a régi slug `SlugHistory` (`BRAND`) sorba kerül, és többé SENKI MÁS nem
 *   kaphatja meg (`SLUG_TAKEN`): egy régi cím nem kaphat új tulajdonost;
 * - a márka a SAJÁT régi slugját visszakaphatja (A → B → A), ilyenkor a
 *   történet-sora törlődik;
 * - `/hu/marka/régi` → `/hu/marka/új` 301 íródik, a lánc- és körszabállyal, a
 *   szokásos záron; a projekció ezt a listát viszi ki a boltba.
 *
 * A tranzakciót a hívó adja: a csere a márka frissítésével együtt íródik vagy
 * marad el.
 */
export type BrandSlugTx = Pick<Prisma.TransactionClient, "slugHistory">;

export interface BrandSlugDeps<T> {
  lock: (tx: T) => Promise<void>;
  write: (tx: T, input: WriteRedirectInput) => Promise<unknown>;
}

const alapFuggosegek: BrandSlugDeps<Prisma.TransactionClient> = {
  lock: lockRedirectWrites,
  write: (tx, input) => writeRedirect(new PrismaRedirectStore(tx), input),
};

/** Egy új vagy átnevezett márka slugja nem lehet MÁSIK márka régi slugja. */
export async function assertBrandSlugFree(
  tx: BrandSlugTx,
  slug: string,
  brandId: string | null,
): Promise<void> {
  const foglalt = await tx.slugHistory.findFirst({
    where: {
      entityType: "BRAND",
      slug,
      ...(brandId ? { entityId: { not: brandId } } : {}),
    },
    select: { id: true },
  });
  if (foglalt) throw new Error("SLUG_TAKEN");
}

export async function applyBrandSlugChange<T extends BrandSlugTx>(
  tx: T,
  input: { brandId: string; from: string; to: string; actorId?: string | null },
  deps: BrandSlugDeps<T> = alapFuggosegek as unknown as BrandSlugDeps<T>,
): Promise<boolean> {
  if (input.from === input.to) return false;
  await deps.lock(tx);
  await tx.slugHistory.deleteMany({
    where: { entityType: "BRAND", entityId: input.brandId, slug: input.to },
  });
  await tx.slugHistory.create({
    data: {
      entityType: "BRAND",
      entityId: input.brandId,
      slug: input.from,
      replacedById: input.actorId ?? null,
    },
  });
  await deps.write(tx, {
    source: webshopBrandPath(input.from),
    destination: webshopBrandPath(input.to),
    reason: "SLUG_CHANGE",
    entityType: "BRAND",
    entityId: input.brandId,
    createdById: input.actorId ?? null,
    onExisting: "replace",
    destinationIsLive: true,
  });
  return true;
}
