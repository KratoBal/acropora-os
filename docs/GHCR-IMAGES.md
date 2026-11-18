# Images built on GitHub, pulled by Coolify (GHCR)

Task `t-20261117-ghcr-kepek`, card 0529e916. Decision of 2026-11-17: the production and stage images of `api`, `web` and `partner` are **built by
GitHub Actions and pushed to GHCR; Coolify only pulls them**. Nothing is built on the server any more.

## Why

On 2026-11-17 (10:20 to 11:38 UTC) two parallel builds (the production `api` and `web`) froze the 8 GB production host: the OS and the game went
down, and a power-off was needed. The repository is public, the standard GitHub runner is free and has no minutes quota, and the images hold no
secret, so the build moves to where memory is not a problem.

## What is built

`.github/workflows/images.yml`, after the CI workflow succeeded for a push to `main` (a pull request never publishes). The same Dockerfile and the
same build context (the repository root) as the CI's `docker-build-scan` and as Coolify, so an image is the one the CI scanned.

| Image (`ghcr.io/kratobal/…`) | App     | Environment-specific                                              |
| ---------------------------- | ------- | ----------------------------------------------------------------- |
| `acropora-os-api`            | api     | no: one image for stage and production                            |
| `acropora-os-web-stage`      | web     | yes: `API_URL` is read when the image is built (`next.config.ts`) |
| `acropora-os-web-prod`       | web     | yes                                                               |
| `acropora-os-partner-stage`  | partner | yes                                                               |
| `acropora-os-partner-prod`   | partner | yes                                                               |

The tag is `sha-<the full 40-character commit>`, never `latest`. A deploy names the exact commit; a rollback names the previous one. `jatek` and
`reefclub` are not covered by this change.

## What the owner does (one list)

1. **Push the workflow file** `images.yml` (the fleet's key cannot push a workflow file).
2. **Set two repository variables** (Settings, Secrets and variables, Actions, Variables; they are not secrets): `STAGE_API_URL` and
   `PROD_API_URL`. Each is the **same value as the `API_URL` of that environment's `web` application in Coolify** (the internal address of its
   `api`, not the public domain). The values are not in the repository on purpose: nobody can read them from the Coolify side, and a public address
   typed in place of the internal one would be a new fault. **An empty variable stops the web and partner jobs before the build.**
3. **After the first publication, check the package visibility** (a package page under the owner's packages, Package settings). The images hold no
   secret, so a **public** package needs no pull credential in Coolify. The default may be private: making it public is the owner's step.

## The switch in Coolify, per application, one at a time

Recorded before the change (2026-11-17): `exchange/ghcr/coolify-beallitas-elotte-2026-11-17.json` (build pack, Dockerfile, base directory, target,
commands, health check, ports, the keys of the environment variables). Measured then: **no application has a pre-deployment command** (all ten are
null), so the host-side `docker build --target builder` of `docs/COOLIFY.md` is not in use.

1. Change the application to the **Docker Image** type: image `ghcr.io/kratobal/<image above>`, tag `sha-<commit>`.
2. **Remove the `RELEASE_COMMIT_SHA=${SOURCE_COMMIT}` variable** (api). An application that pulls a pre-built image has no source commit on the
   platform, so the variable would resolve to empty, and an empty runtime variable overrides the image's own default (the Dockerfile now sets
   `RELEASE_COMMIT_SHA` from the build argument): `currentReleaseCommitSha()` would be null and the stock diagnostics would report "cannot validate".
3. The runtime variables stay as they are (the image holds none). The `api` entrypoint still runs the migration before the process starts.
4. Deploy, then **measure**: `GET /health` is 200; `runtimeCommit` **equals** the commit in the tag; `imageCommit` equals it too (`commitSourceState`
   `match` is by construction now, so the measure is the equality with the tag, not the word).

**Order:** stage `api`, measured; then stage `web` and `partner`; only then production, application by application, **one deploy at a time** (the
day this change exists for was two builds at once).

**Rollback, one step:** set the previous `sha-` tag and deploy, or write the recorded build settings back (the file above) to return to a Coolify
build; add the `RELEASE_COMMIT_SHA=${SOURCE_COMMIT}` variable back in that case.

## Not measured when this was written

- The workflow itself: it can run only after it is on `main`. The shell steps (the empty-variable guard, the image name in lower case, the build
  arguments) were run locally with sample values, and `apps/api/src/common/images-workflow.spec.ts` measures the file's shape against the
  Dockerfiles; the first run on `main` is the measurement of the rest.
- How long GitHub takes to build each image, how Coolify's "Docker Image" mode pulls and swaps, and the package visibility after the first push.
