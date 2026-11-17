#!/usr/bin/env bash
# retry-on-timeout.sh <seconds> <command...>
#
# Runs the command with a time limit, and when the LIMIT cut it (not when the command failed by itself) runs it ONE more time with
# the same limit. Why: acropora-os #2663 (2026-11-17), a `pnpm install --frozen-lockfile` layer took 1083 s instead of about a
# minute because the runner's network stalled, the 20 minute job limit cancelled the run, and a rerun of the same commit was
# green. A stall is a timing fault, so it is the only thing retried: a command that FAILS (a lockfile that does not match, a
# type error) is not run twice, its failure is the answer and shows once.
#
# Exit status: the command's own, except that a command cut twice exits 124 (the limit) or 137 (killed after the grace).
# RETRY_KILL_AFTER (seconds, default 15) is the grace between the polite stop and the kill, so a command that ignores the polite
# stop is still ended; a test sets it to 1.
set -uo pipefail

limit="${1:?usage: retry-on-timeout.sh <seconds> <command...>}"
shift
[ "$#" -gt 0 ] || { echo "retry-on-timeout.sh: no command given" >&2; exit 2; }

attempt() {
  timeout --kill-after="${RETRY_KILL_AFTER:-15}" "$limit" "$@"
}

attempt "$@"
code=$?
# 124: the limit stopped it; 137: it ignored that and was killed after the grace (128 + 9)
if [ "$code" -eq 124 ] || [ "$code" -eq 137 ]; then
  echo "::warning::'$*' was cut after ${limit}s (exit ${code}); running it once more"
  attempt "$@"
  code=$?
fi
exit "$code"
