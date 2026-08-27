import {
  generateCode,
  randomCodeSuffix,
  type CodeStamp,
} from "./code-generator.util.js";
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
  /// The column, or columns, a retry is worth trying for. Usually one, e.g.
  /// "assetNumber". A `P2002` on any other column is not this helper's
  /// business.
  ///
  /// SEVERAL COLUMNS WHEN ONE WRITE MINTS SEVERAL CODES. Creating a supplier
  /// writes the supplier's own code AND a mirrored customer row with a customer
  /// number, both unique, in one transaction - so the transaction can lose on
  /// either. Retrying is right for both, and for the same reason it is right at
  /// all: EVERY code in there is minted inside the retried closure, so a second
  /// attempt draws fresh values for all of them. It is two independent redraws,
  /// not the same write hopefully going through this time.
  ///
  /// The list stays explicit on purpose. There is no "retry any unique
  /// violation" shape, because a business collision - an e-mail address already
  /// in use - would then be retried five times and surface the same error later
  /// than it should.
  field: string | readonly string[];
  /// How many codes to try before giving up. Beyond this the original database
  /// error is rethrown unchanged - deliberately today's behaviour, so the worst
  /// case after this change is no worse than the worst case before it.
  maxAttempts?: number;
  /// Test seam only. See `generateCode`.
  randomSuffix?: () => string;
  /// MELYIK ORA SZERINT ALLJON A BELYEG. Alapertelmezes: `utc`, vagyis a mai,
  /// valtozatlan alak -- minden csalad ezt hasznalja, kiveve ahol egy EMBER
  /// olvassa le a szamot. Ma egyetlen ilyen van, az eszkozszam: az kerul
  /// cimkere. A tobbi (BESZ, POS) kulso rendszerbe is kimegy, es azok alakjat
  /// ez a kor SZANDEKOSAN nem valtoztatja.
  stamp?: CodeStamp;
};

const DEFAULT_MAX_ATTEMPTS = 5;

/// The same retry, for the writes that mint their code THEMSELVES, deeper down.
///
/// WHY A SECOND ENTRY POINT RATHER THAN ONE. `withUniqueCode` hands the code
/// in, because at those sites nobody else would draw it. At these sites the
/// code is already drawn inside the write - `syncWorksheetMirror` mints the
/// mirror's customer number, `postInventoryMovement` is handed a freshly minted
/// movement number - and a code handed in from out here would either be unused
/// or would have to be threaded through several layers that have no business
/// knowing about it. Running the write again is enough: every one of those
/// draws happens inside `persist`, so a second attempt redraws all of them.
///
/// WHAT `persist` MUST BE, and this is the load-bearing part: one complete,
/// self-contained write - its own `$transaction` if it needs one. It must NOT
/// be a fragment of somebody else's transaction. PostgreSQL marks a transaction
/// unusable after its first failed statement, so a retry INSIDE one cannot
/// succeed: it would spend the attempts, log as if we had tried, and hand the
/// caller the same error later than before. The rule that follows is checkable
/// rather than a matter of taste: a function that takes a
/// `Prisma.TransactionClient` runs in somebody else's transaction, so it never
/// gets this wrapper - the caller that OPENED the transaction does.
export type TakenCodeRetryOptions = {
  /// The column, or columns, a retry is worth trying for - same meaning, and
  /// same deliberate explicitness, as `UniqueCodeOptions.field`.
  field: string | readonly string[];
  /// How many attempts before the original database error is rethrown
  /// unchanged.
  maxAttempts?: number;
};

export async function retryOnTakenCode<T>(
  options: TakenCodeRetryOptions,
  persist: () => Promise<T>,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new Error(
      `A probalkozasok szamanak legalabb 1-nek kell lennie, kapott: ${maxAttempts}.`,
    );

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await persist();
    } catch (error) {
      const fields =
        typeof options.field === "string" ? [options.field] : options.field;
      const isTakenCode = fields.some((field) =>
        isPrismaUniqueConstraintViolation(error, field),
      );
      if (!isTakenCode || attempt >= maxAttempts) throw error;
    }
  }
}

export async function withUniqueCode<T>(
  options: UniqueCodeOptions,
  persist: (code: string) => Promise<T>,
): Promise<T> {
  // The minting sits INSIDE the retried closure on purpose: that is the whole
  // reason a second attempt is worth anything. A code drawn out here would be
  // reused by every attempt and would lose to the same row five times.
  return retryOnTakenCode(
    { field: options.field, maxAttempts: options.maxAttempts },
    () =>
      persist(
        generateCode(
          options.prefix,
          options.randomSuffix ?? randomCodeSuffix,
          options.stamp,
        ),
      ),
  );
}
