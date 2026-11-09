/// Makes the stage-only password hash for `STAGE_ANON_PASSWORD_HASH` (task stage-anonim-proba; runbook: docs/stage-anonymization.md).
///
/// Run by the stage operator on the HOST: `STAGE_ANON_PASSWORD=<the password> pnpm --filter @acropora/database stage:hash-password`.
/// The password comes from the ENVIRONMENT (never from an argument, which would stay in the shell history and in the process
/// list), and only the HASH is printed, on one line, so it can be captured: `STAGE_ANON_PASSWORD_HASH=$(...)`. The hash uses the
/// application's own scheme, so the trial can log in with the password after the anonymization put this hash on every account.
import {
  hashStagePassword,
  MIN_STAGE_PASSWORD_LENGTH,
} from "../src/stage-anonymization/stage-password.js";

const password = process.env.STAGE_ANON_PASSWORD;
if (!password) {
  console.error("STAGE_ANON_PASSWORD is not set");
  process.exit(2);
}
if (password.length < MIN_STAGE_PASSWORD_LENGTH) {
  console.error(
    `STAGE_ANON_PASSWORD must be at least ${MIN_STAGE_PASSWORD_LENGTH} characters`,
  );
  process.exit(2);
}
console.log(await hashStagePassword(password));
