/// The running build's own commit SHA - deliberately NOT read from `.git`
/// (a production container image does not ship a `.git` directory, and
/// even if it did, trusting an on-disk `.git` at runtime would be a much
/// weaker guarantee than a value baked in at build/deploy time). Instead
/// read from a single environment variable that a real deploy pipeline is
/// expected to set (e.g. from CI's own `${{ github.sha }}` context) -
/// see docs/INVENTORY-CONSISTENCY.md's "Release evidence" section for the
/// exact deploy-time wiring this still needs.
///
/// Checkpoint 8: this is now ALSO baked in at Docker build time (see
/// apps/api/Dockerfile's `RELEASE_COMMIT_SHA` build ARG, wired from CI's
/// `${{ github.sha }}` in .github/workflows/ci.yml's docker-build jobs),
/// so the image itself carries its own commit identity independent of
/// whatever runtime environment variables a deploy platform (e.g.
/// Coolify) happens to be configured to set. A runtime env var, if a
/// deploy platform sets one too, would simply need to agree with the
/// baked-in value - this function has no way to tell the two apart and
/// does not need to, since both are meant to be `github.sha` for the same
/// release.
///
/// Returns null, never a guessed/empty-string value, when unset OR when
/// the value is not a well-formed full git commit SHA - callers
/// (stock-diagnostics.service.ts::activationReadiness) MUST treat null as
/// "cannot validate any release evidence", not as a wildcard match. A
/// malformed value (wrong length, non-hex characters, obviously-fake
/// placeholder text) is deliberately treated identically to "unset": the
/// checkpoint 8 requirement is that malformed values are REJECTED, not
/// that they get a distinct error path a caller might accidentally treat
/// as more trustworthy than "unconfigured".
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export function currentReleaseCommitSha(): string | null {
  const value = process.env.RELEASE_COMMIT_SHA?.trim();
  if (!value) return null;
  if (!FULL_COMMIT_SHA_PATTERN.test(value)) return null;
  return value;
}
