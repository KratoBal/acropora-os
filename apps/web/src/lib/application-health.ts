import { releaseCommitSources } from "./release-info";

/** The web counterpart of the API's applicationHealth: only self-description. */
export function applicationHealth() {
  const release = releaseCommitSources();
  return {
    status: "ok" as const,
    version: "0.1.0",
    // Compatibility field: the running process is the value this instance
    // actually reports. The paired fields below retain the image evidence.
    commit: release.runtimeCommit,
    ...release,
  };
}
