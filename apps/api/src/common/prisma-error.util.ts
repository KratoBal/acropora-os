/// Structural (non-`instanceof`) Prisma error helpers.
///
/// Every call site that used to write
/// `error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && ...`
/// relied on `instanceof` successfully narrowing `error` from `unknown` to
/// `Prisma.PrismaClientKnownRequestError` for the rest of the check. In this
/// repo's current environment, `.prisma/client` (the code Prisma's CLI
/// generates from schema.prisma) has never been produced - `prisma generate`
/// cannot run in this sandbox (see docs/INVENTORY-CONSISTENCY.md /
/// project memory) - so `@prisma/client`'s re-export of
/// `PrismaClientKnownRequestError` does not resolve to a real class type at
/// typecheck time. TypeScript's `instanceof` narrowing requires the
/// right-hand operand to have a genuine construct signature; when it
/// doesn't, TS performs NO narrowing at all, and every subsequent
/// `error.code`/`error.meta` access is flagged `TS18046: 'error' is of type
/// 'unknown'`. This is a real, reproducible gap (confirmed to affect every
/// file in the codebase using this pattern), not something addressed by
/// `skipLibCheck` or any other tsconfig option.
///
/// Rather than paper over that with `any`/`@ts-ignore`, the helpers below
/// check the error's own shape directly, via `typeof`/`in` narrowing on
/// `unknown` - which TypeScript DOES narrow correctly without needing to
/// resolve the generated Prisma class at all. This is not merely a
/// workaround for the missing generated client: a real
/// `Prisma.PrismaClientKnownRequestError` instance has exactly this shape
/// (`code: string`, `meta?: { target?: unknown }`), so these helpers keep
/// working identically once `prisma generate` is eventually run in a real
/// environment - they just no longer depend on it.
function getPrismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function getPrismaErrorMetaTarget(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("meta" in error)) return undefined;
  const meta = (error as { meta: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  if (!("target" in meta)) return undefined;
  return (meta as { target: unknown }).target;
}

/// True when `error` is a Prisma error with exactly this `code` (e.g.
/// "P2002" for any unique-constraint violation, regardless of which
/// field/index was hit) - for call sites that don't need to distinguish
/// which unique constraint fired, unlike isPrismaUniqueConstraintViolation
/// below.
export function isPrismaErrorCode(error: unknown, code: string): boolean {
  return getPrismaErrorCode(error) === code;
}

/// True when `error` is a Prisma P2002 (unique constraint violation) whose
/// `meta.target` mentions `targetField` - e.g. the name of the unique
/// column/index that was violated. `target` can be a string or a string
/// array depending on the underlying database driver, so the check
/// stringifies it first rather than assuming either shape.
export function isPrismaUniqueConstraintViolation(
  error: unknown,
  targetField: string,
): boolean {
  if (getPrismaErrorCode(error) !== "P2002") return false;
  const target = getPrismaErrorMetaTarget(error);
  return JSON.stringify(target ?? "").includes(targetField);
}
