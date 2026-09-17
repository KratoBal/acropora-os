#!/usr/bin/env bash
# ANSWERS: Milyen paranccsal megy ki egy levegobol erkezo (OTA) frissites, es
# MIT kell latnia a telepitett keszuleknek ahhoz, hogy atvegye.
#
# === MIERT LETEZIK EZ A FAJL ===
#
# 2026-09-17-en egy frissites SIKERT jelentett, es NEM ERT EL egyetlen
# keszuleket sem. Nem hibaval: nem tortent semmi. Az ok egy kornyezeti valtozo
# volt, amit a BUILD megkap es a KIADAS nem:
#
#     apps/mobile/app.config.js:20
#     const value = process.env.APP_VARIANT ?? "development";
#
# A valtozat donti el a bundleIdentifier / package / scheme / name erteket. Mind
# nativ azonosito, tehat mind benne van az ujjlenyomatban, ami a runtimeVersion
# politika (app.config.js:76-78). Ha a kiadas a "development" agra esik, MAS
# hasht szamol, es az expo-updates nem veszi at a csomagot.
#
# Merve aznap, ugyanazon a fan, `@expo/fingerprint` 0.20.6, `--platform ios`:
#
#     APP_VARIANT nincs        3f496632...   <- ezt szamolta a kiadas
#     APP_VARIANT=production   ba70c226...   <- ezt varta a telepitett build
#
# Mind a ket megfigyelt ertek reprodukalhato volt, es a `--debug` kimenet 93
# forrasabol PONTOSAN EGY tert el: az `expoConfig`.
#
# === MIERT NEM AZ eas.json-BAN ALL EZ ===
#
# Mert ott nem allhat. A telepitett `@expo/eas-json` sajat tipusa:
#
#     export type ProfileType = 'build' | 'submit';
#
# A semat kozvetlenul betoltve, kalibralva: a mai eas.json ERVENYES, ugyanaz egy
# `update` szekcioval `"update" is not allowed`. A build profilok gondosan
# megadjak a kornyezetet; a kiadasnak NINCS HOL megneznie. Ez a fajl az a hely.
#
# === HASZNALAT ===
#
#   scripts/mobil-frissites.sh                 <- MER: kiirja a parancsot es a
#                                                 vart runtimeVersion erteket
#   scripts/mobil-frissites.sh --kiadom        <- KIAD. Eles muvelet.
#
# Az ALAPERTELMEZETT ag SZANDEKOSAN nem ad ki semmit. Egy kiadas a felhasznalok
# telefonjara megy, es a lapunk szerint ami sikeres futas utan barmit hagy maga
# utan, az muvelet, nem meres. Igy ez a fajl LEFUTTATHATO -- egy szabaly, aminek
# nincs mert eszkoze, rosszabb a hianyzo szabalynal.
set -uo pipefail

MOBIL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/apps/mobile"
VALTOZAT="${APP_VARIANT:-production}"
KORNYEZET="${EAS_ENVIRONMENT:-production}"
CSATORNA="${EAS_CHANNEL:-production}"

KIADOM=0
[ "${1:-}" = "--kiadom" ] && KIADOM=1

if [ ! -d "$MOBIL" ]; then
  echo "FAIL: nem talalom a mobil csomagot: $MOBIL" >&2
  exit 3
fi

echo "--- mobil-frissites | valtozat=$VALTOZAT kornyezet=$KORNYEZET csatorna=$CSATORNA ---"

# A VART UJJLENYOMAT. Ezt a szamot kell viselnie a telepitett buildnek ahhoz,
# hogy a frissitest atvegye -- tehat a kiadas utan ez az ellenorzes, nem a
# "sikeres" kiiras. Platformonkent szamol, mert a build is ugy.
FP="$MOBIL/node_modules/@expo/fingerprint/bin/cli.js"
if [ -f "$FP" ]; then
  for p in ios android; do
    h=$(cd "$MOBIL" && APP_VARIANT="$VALTOZAT" node "$FP" fingerprint:generate . --platform "$p" 2>/dev/null \
        | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).hash)}catch{console.log('(nem olvashato)')}})")
    printf "  vart runtimeVersion  %-8s %s\n" "$p" "$h"
  done
  echo "  (android: a google-services.json a fingerprint resze, es gitignore alatt all --"
  echo "   fejlesztoi gepen ezert MAS szamot ad, mint a build gepen. Az ios a mervado innen.)"
else
  echo "  vart runtimeVersion: NEM MERHETO (nincs @expo/fingerprint; futtass npm ci-t a mobil csomagban)"
fi

# A commit-uzenet ROVIDITVE megy: egy teljes cim zarojelekkel es idezojelekkel
# olvashatatlanna teszi a kiirt parancsot, es epp azt kell masolhatova tenni.
UZENET="$(cd "$MOBIL" && git log --format=%h -1 2>/dev/null || echo frissites)"

PARANCS=(npx --yes eas-cli@latest update
  --channel "$CSATORNA"
  --environment "$KORNYEZET"
  --message "$UZENET"
  --non-interactive)

echo
echo "--- a kiadasi parancs ---"
# `printf %q` MASOLHATO alakot ad. Enelkul a kiirt sor ugy NEZ KI, mint egy
# parancs, es bemasolva MAST csinal -- ezt a fajl elso futtatasa fogta meg,
# amikor a commit-cim szokozei es zarojelei idezojel nelkul kerultek a sorba.
printf "  cd %q\n" "$MOBIL"
printf "  APP_VARIANT=%q" "$VALTOZAT"
printf " %q" "${PARANCS[@]}"
printf "\n"
echo
echo "  A KET RESZ, AMI NELKUL NEM TALAL CELBA:"
echo "    APP_VARIANT=$VALTOZAT   a runtimeVersion ezen mulik (lasd a fejlecet)"
echo "    --environment           a sugo szerint KOTELEZO Expo SDK 55 folott"

if [ "$KIADOM" -eq 0 ]; then
  echo
  echo "MERES MOD: nem adtam ki semmit. Eles kiadashoz: --kiadom"
  exit 0
fi

echo
echo "KIADAS INDUL."
cd "$MOBIL" || exit 3
APP_VARIANT="$VALTOZAT" "${PARANCS[@]}"
