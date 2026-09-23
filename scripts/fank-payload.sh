#!/usr/bin/env bash
# Vekony burok a scripts/fank-payload.mjs korul -- a tenyleges logika ott van,
# lasd a fajl sajat fejleceben a teljes indoklast es a kapcsolok listajat.
#
# Hasznalat:
#   scripts/fank-payload.sh LSS22 --kihagy 563 --units exchange/fank-units.json
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/fank-payload.mjs" "$@"
