/// Commit SHA-kat szándékosan nem `.git`-ből olvasunk: a production image nem
/// hordoz checkoutot. A `RELEASE_IMAGE_COMMIT_SHA` a Docker build ARG-jából
/// beégetett képazonosság, a `RELEASE_COMMIT_SHA` pedig a futó folyamat
/// környezete. A két külön forrás teszi láthatóvá a platform felülírását,
/// hiányát vagy eltérését a web `/health` végpontján.
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function validCommit(value: string | undefined): string | null {
  value = value?.trim();
  if (!value) return null;
  return FULL_COMMIT_SHA_PATTERN.test(value) ? value : null;
}

export function currentReleaseCommitSha(): string | null {
  return validCommit(process.env.RELEASE_COMMIT_SHA);
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
