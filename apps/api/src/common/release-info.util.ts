/// Commit SHA-k are deliberately NOT read from `.git`: a production image does
/// not ship it, and an on-disk checkout would be weaker evidence than the
/// image's build-time identity. `RELEASE_IMAGE_COMMIT_SHA` is set by the
/// Dockerfile from its build ARG; `RELEASE_COMMIT_SHA` comes from the running
/// process environment. Keeping them separate makes a deployment-platform
/// override, omission, or disagreement observable in `/health`.
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
  return validCommit(process.env.RELEASE_COMMIT_SHA);
}

function validCommit(value: string | undefined): string | null {
  value = value?.trim();
  if (!value) return null;
  if (!FULL_COMMIT_SHA_PATTERN.test(value)) return null;
  return value;
}

export type ReleaseCommitSourceState =
  "match" | "mismatch" | "image-missing" | "runtime-missing" | "both-missing";

export function releaseCommitSourceState(
  imageCommit: string | null,
  runtimeCommit: string | null,
): ReleaseCommitSourceState {
  if (imageCommit === null && runtimeCommit === null) return "both-missing";
  if (imageCommit === null) return "image-missing";
  if (runtimeCommit === null) return "runtime-missing";
  return imageCommit === runtimeCommit ? "match" : "mismatch";
}

export function releaseCommitSources() {
  const imageCommit = validCommit(process.env.RELEASE_IMAGE_COMMIT_SHA);
  const runtimeCommit = currentReleaseCommitSha();
  const commitSourceState = releaseCommitSourceState(
    imageCommit,
    runtimeCommit,
  );
  return { imageCommit, runtimeCommit, commitSourceState } as const;
}
