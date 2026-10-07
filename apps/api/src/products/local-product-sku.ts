import { Prisma } from "@acropora/database";

/**
 * THE LOCAL PRODUCT SKU (`ACR-L-000123`), shared by every path that creates
 * an OS-owned product: the purchase invoice's "new local product" and the
 * quote BOM's "create product" (#1582 P1). One sequence, one format, so two
 * paths can never hand out the same code.
 */
const LOCAL_PRODUCT_SKU_PREFIX = "ACR-L-";
const LOCAL_PRODUCT_SKU_PAD_LENGTH = 6;

export function formatLocalProductSku(value: bigint): string {
  return `${LOCAL_PRODUCT_SKU_PREFIX}${value
    .toString()
    .padStart(LOCAL_PRODUCT_SKU_PAD_LENGTH, "0")}`;
}

/** Any client that can run raw SQL: a Prisma transaction, or a test double. */
export interface RawQueryClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): PromiseLike<T>;
}

export async function nextLocalProductSku(
  transaction: RawQueryClient,
): Promise<string> {
  const rows = await transaction.$queryRaw<Array<{ value: bigint }>>(
    Prisma.sql`SELECT nextval('"LocalProductSkuSequence"') AS value`,
  );
  const value = rows[0]?.value;
  if (value === undefined) throw new Error("LOCAL_PRODUCT_SKU_SEQUENCE_FAILED");
  return formatLocalProductSku(value);
}
