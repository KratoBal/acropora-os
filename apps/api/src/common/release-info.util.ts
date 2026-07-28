/// The running build's own commit SHA - deliberately NOT read from `.git`
/// (a production container image does not ship a `.git` directory, and
/// even if it did, trusting an on-disk `.git` at runtime would be a much
/// weaker guarantee than a value baked in at build/deploy time). Instead
/// read from a single environment variable that a real deploy pipeline is
/// expected to set (e.g. from CI's own `${{ github.sha }}` context) -
/// see docs/INVENTORY-CONSISTENCY.md's "Release evidence" section for the
/// exact deploy-time wiring this still needs (documented as a plan, not
/// implemented this checkpoint - see that section for why).
///
/// Returns null, never a guessed/empty-string value, when unset - callers
/// (stock-diagnostics.service.ts::activationReadiness) MUST treat that as
/// "cannot validate any release evidence", not as a wildcard match.
export function currentReleaseCommitSha(): string | null {
  const value = process.env.RELEASE_COMMIT_SHA?.trim();
  return value && value.length > 0 ? value : null;
}
