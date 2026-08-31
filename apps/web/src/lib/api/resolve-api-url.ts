/**
 * WHERE THE WEB BUILD GETS ITS `API_URL`, AND WHY IT LOOKS IN TWO PLACES.
 *
 * In Docker and in CI the value arrives as a real environment variable, and
 * that stays the primary source: an explicit variable always wins here.
 *
 * Locally it does not arrive at all, and the failure that follows is worse
 * than it looks. The repository root `.env` HAS an `API_URL`, but nothing puts
 * it into the build's environment: Next reads `.env` files from the app
 * directory, not from the monorepo root, and Turborepo does not load `.env`
 * files at all - naming a variable in `turbo.json` only passes through and
 * hashes one that is already in the environment, which is why the existing
 * `"env": ["API_URL"]` declaration does not help.
 *
 * So a developer running `pnpm test` at the root gets a red run whose visible
 * line is `Failed: @acropora/web#build`, with the sentence that explains it
 * buried above. It reads as if their own change broke the build.
 *
 * Reading the root `.env` closes that, and reading only ONE KEY out of it is
 * the point. Loading the whole file (Node's `process.loadEnvFile`, dotenv)
 * would pull database credentials and API secrets into a frontend build's
 * environment to obtain a single public URL. Next only inlines `NEXT_PUBLIC_*`
 * into the client bundle, so nothing would leak today - but the reason nothing
 * leaks would be a Next detail rather than anything this file decided.
 */

export const API_URL_ENV_KEY = "API_URL";

/**
 * Pulls one key out of the text of a `.env` file.
 *
 * Deliberately NOT a `.env` parser: no interpolation, no multi-line values, no
 * `export` semantics beyond the prefix. Anything more would be a second,
 * quietly different implementation of a format we do not own.
 */
export const readKeyFromEnvFile = (
  contents: string,
  key: string,
): string | undefined => {
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const statement = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;

    const separator = statement.indexOf("=");

    if (separator === -1 || statement.slice(0, separator).trim() !== key) {
      continue;
    }

    const value = statement
      .slice(separator + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");

    return value.length > 0 ? value : undefined;
  }

  return undefined;
};

export type ResolveApiUrlInput = {
  /** The process environment. An explicit variable always wins. */
  env: Record<string, string | undefined>;
  /** Returns the root `.env` text, or undefined when there is no such file. */
  readRootEnvFile: () => string | undefined;
};

/**
 * The URL the browser's `/api` prefix is rewritten to, without a trailing slash.
 *
 * Throws when neither source has it, and the message names BOTH ways of
 * supplying it. A build-time requirement that only names one of them sends the
 * reader to the wrong place half the time.
 */
export const resolveApiUrl = ({
  env,
  readRootEnvFile,
}: ResolveApiUrlInput): string => {
  const fromEnvironment = env[API_URL_ENV_KEY]?.trim();
  const value =
    fromEnvironment && fromEnvironment.length > 0
      ? fromEnvironment
      : readKeyFromEnvFile(readRootEnvFile() ?? "", API_URL_ENV_KEY);

  if (!value) {
    throw new Error(
      "API_URL is required when building @acropora/web. Pass it as a Docker build argument or environment variable, " +
        "or set API_URL in the repository root .env for a local build.",
    );
  }

  return value.replace(/\/$/, "");
};
