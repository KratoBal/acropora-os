/**
 * THE REEFCLUB API ADDRESS THE BUILD BAKES INTO THE REWRITE (next.config.ts).
 *
 * Order: the `REEFCLUB_API_URL` setting, then the same key in the repo's root
 * `.env`; on a GitHub Actions runner only, a loopback placeholder; otherwise
 * the build stops. It is never `API_URL`: that is the INTERNAL API, and
 * falling back to it would route the public `/rc/v1` prefix to it.
 *
 * WHY THE PLACEHOLDER IS GITHUB-ACTIONS-ONLY AND NOT `CI`: the Dockerfile sets
 * `CI=true` in every stage, so a `CI` check would let an image build without
 * the address pass silently; the Dockerfile's own `test -n` guard and this
 * rule stay separate. The `verify` job (turbo build on the runner) has no
 * ReefClub container to point at, and its build never calls the rewrite.
 */
export const GITHUB_ACTIONS_PLACEHOLDER = "http://127.0.0.1:3002";

export function resolveReefClubApiUrl(
  env: Record<string, string | undefined>,
  readRootEnv: () => string | null,
): string {
  const strip = (value: string) =>
    value.replace(/^(["'])(.*)\1$/, "$2").replace(/\/$/, "");

  const configured = env.REEFCLUB_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const rootEnv = readRootEnv();
  if (rootEnv) {
    const value = rootEnv
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("REEFCLUB_API_URL="))
      ?.slice("REEFCLUB_API_URL=".length)
      .trim();
    if (value) return strip(value);
  }

  if (env.GITHUB_ACTIONS === "true") return GITHUB_ACTIONS_PLACEHOLDER;

  throw new Error(
    "REEFCLUB_API_URL is required when building @acropora/reefclub.",
  );
}
