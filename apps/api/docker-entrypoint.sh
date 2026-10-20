#!/bin/sh
# Runs before the API ever starts serving traffic (see the "runner" stage in
# this directory's Dockerfile, and docs/DEPLOYMENT.md Section 5). Applies
# pending Prisma migrations against DATABASE_URL and refuses to start the
# API if that fails - never falls back to `prisma db push`, and never
# starts `node dist/main.js` on a failed migration.
#
# POSIX sh (not bash): the runner stage's base image is Alpine, whose
# /bin/sh is busybox ash.
set -e

# THE REEFCLUB PROCESS (ReefClub plan v6.1, 2.1; slice 6): the same image,
# started with REEFCLUB_PROCESS=true, runs only the ReefClub entry point
# (`dist/main-reefclub.js`, which serves nothing but /rc/v1). It does NOT run
# the migrations: its database role may not, and the internal API's container
# already does. See docs/REEFCLUB-DEPLOYMENT.md. The name is in the REEFCLUB_
# namespace on purpose: the ReefClub process refuses to start with an
# ACROPORA_ name in its environment (`reefclub-environment.ts`).
# Any other value stops the container: a mistyped value on the public
# container must not start the internal API there.
case "${REEFCLUB_PROCESS:-}" in
  "") ;;
  true)
    echo "docker-entrypoint: starting the ReefClub process (no migrations)..."
    exec node dist/main-reefclub.js
    ;;
  *)
    echo "docker-entrypoint: unknown REEFCLUB_PROCESS=\"${REEFCLUB_PROCESS}\" (unset or true); not starting." >&2
    exit 64
    ;;
esac

echo "docker-entrypoint: running prisma migrate deploy..."
node "$(dirname "$0")/docker-entrypoint-migrate.cjs"
echo "docker-entrypoint: migrations applied, starting API..."

exec node dist/main.js
