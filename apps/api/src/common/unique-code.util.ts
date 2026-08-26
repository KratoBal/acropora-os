import { generateCode, randomCodeSuffix } from "./code-generator.util.js";
import { isPrismaUniqueConstraintViolation } from "./prisma-error.util.js";

/// Mints a document code and retries the WRITE if that exact code was already
/// taken.
///
/// WHAT IT RETRIES, AND WHAT IT DOES NOT. Only `persist` runs again, with a
/// FRESH code each attempt. It is not "retry the method": whatever validation
/// or reading happened before the call stays where it is, runs once, and is
/// unaffected. Callers should pass the smallest closure that performs the
/// write.
///
/// WHY THE CODE IS MINTED IN HERE rather than by the caller: a retry is only
/// worth anything if the second attempt draws a different tail. A code computed
/// outside and handed in would be re-used on every attempt, and the retry would
/// fail identically five times.
///
/// WHY THE RETRY CANNOT LIVE INSIDE THE TRANSACTION. PostgreSQL aborts a
/// transaction as soon as one statement in it fails, so a duplicate key cannot
/// be "caught and retried" around the failing insert - the surrounding
/// transaction is already unusable. The retry therefore has to sit outside, and
/// `persist` is expected to be one complete, self-contained write (its own
/// `$transaction` call if it needs one). This is the same rule the sibling
/// helper for serialization conflicts states, arrived at from the same
/// constraint.
///
/// WHY ONLY THIS FIELD. A `P2002` says some unique constraint fired, not which
/// one. Retrying a duplicate e-mail address would loop five times and then
/// surface the same business error later than it should - so the violation is
/// matched against the code column by name, and every other unique constraint
/// is rethrown on the first attempt, untouched.
///
/// WHY NO BACKOFF, unlike the serialization-conflict helper. There, two
/// transactions are contending and waiting helps them separate. Here nothing is
/// contended: the previous attempt lost to a code that already exists, and the
/// next draw is independent of it. A delay would only add latency to the rarest
/// path.
export type UniqueCodeOptions = {
  /// The document family's prefix, e.g. "ESZK".
  prefix: string;
  /// The column the code is written to, e.g. "assetNumber". A `P2002` on any
  /// other column is not this helper's business.
  field: string;
  /// How many codes to try before giving up. Beyond this the original database
  /// error is rethrown unchanged - deliberately today's behaviour, so the worst
  /// case after this change is no worse than the worst case before it.
  maxAttempts?: number;
  /// Test seam only. See `generateCode`.
  randomSuffix?: () => string;
};

const DEFAULT_MAX_ATTEMPTS = 5;

export async function withUniqueCode<T>(
  options: UniqueCodeOptions,
  persist: (code: string) => Promise<T>,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new Error(
      `A probalkozasok szamanak legalabb 1-nek kell lennie, kapott: ${maxAttempts}.`,
    );

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const code = generateCode(
      options.prefix,
      options.randomSuffix ?? randomCodeSuffix,
    );
    try {
      return await persist(code);
    } catch (error) {
      const isTakenCode = isPrismaUniqueConstraintViolation(
        error,
        options.field,
      );
      if (!isTakenCode || attempt >= maxAttempts) throw error;
    }
  }
}
