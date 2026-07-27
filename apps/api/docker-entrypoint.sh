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

echo "docker-entrypoint: running prisma migrate deploy..."
node "$(dirname "$0")/docker-entrypoint-migrate.cjs"
echo "docker-entrypoint: migrations applied, starting API..."

exec node dist/main.js
