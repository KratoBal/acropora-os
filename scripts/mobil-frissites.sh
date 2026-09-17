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
# EZ A KET ALAK VAN, ES MAS NINCS. A valtozat, a kornyezet es a csatorna
# KORNYEZETI VALTOZOBOL jon (APP_VARIANT, EAS_ENVIRONMENT, EAS_CHANNEL), nem
# kapcsolobol -- egy `--kornyezet production` alaku argumentum CSENDBEN
# ELDOBODIK. Merve 2026-09-17: ket futast hasonlitottam ossze, az egyiket ezzel
# az argumentummal, es ugyanazt kaptam -- nem azert, mert nem szamit, hanem mert
# EGY alakot futtattam ketszer. A fejlec sora (`kornyezet=...`) megmondja, mi
# ment at; ezt kell megnezni, mielott ket futast osszevetunk.
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
    # A HIBAT NEM NYELJUK EL. Az elso alakom `2>/dev/null`-lal ment, es a
    # kimenet csak annyit mondott, hogy "(nem olvashato)" -- holott a valodi ok
    # egy megnevezett `EACCES` volt a titok-fajlon. Egy elnyelt hibaüzenet
    # ugyanolyan nema, mint a hiany, csak magabiztosabbnak latszik.
    nyers=$(cd "$MOBIL" && APP_VARIANT="$VALTOZAT" node "$FP" fingerprint:generate . --platform "$p" 2>&1)
    h=$(printf '%s' "$nyers" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).hash)}catch{console.log('')}})")
    if [ -z "$h" ]; then
      h="(nem szamolhato) $(printf '%s' "$nyers" | tail -1)"
    fi
    printf "  vart runtimeVersion  %-8s %s\n" "$p" "$h"
  done
  # AZ ANDROID SZAM AKKOR MERVADO, HA A TITOK OLVASHATO -- ES EZT MEGMERJUK,
  # NEM FELTETELEZZUK.
  #
  # Az elso alakom azt irta ide, hogy "fejlesztoi gepen mas szamot ad". Ez rossz
  # okot nevezett meg: a kulonbseg nem a gepen mulik, hanem azon, hogy a futtato
  # felhasznalo OLVASSA-E a titkot. Ugyanezen a gepen, masik felhasznalo alatt a
  # szkript a HELYES android erteket adta (merve 2026-09-17), mig itt nem -- a
  # fajl modja `-rw-------`.
  #
  # Amiert ez nem szorszalhasogatas: a regi mondat azt uzente a kovetkezo
  # olvasonak, hogy hagyja figyelmen kivul az android szamot. Ha az valojaban
  # helyes, azzal epp azt az ellenorzest dobjuk el, amivel az android kiadas
  # utolag igazolhato.
  # ES AZ IOS SZAM A TITOKTOL FUGGETLEN -- EZ MERVE VAN, NEM FELTEVES.
  #
  # Harom allapot ugyanazon a fan (2026-09-17, nautilus). Csak a
  # google-services.json ter el, minden mas azonos:
  #
  #   a fajl HIANYZIK                ios ba70c226   android 2c93a755
  #   egy PLACEHOLDER all ott        ios ba70c226   android 1ecf6378
  #   a VALODI fajl all ott          ios ba70c226   android a5666bdb
  #                                  (a harmadik acrobot merese, az o fajan)
  #
  # Harom kulonbozo android szam, es az ios MIND A HAROMSZOR AZONOS. Ebbol ket
  # dolog kovetkezik: a fajl tenyleg benne van az android ujjlenyomatban (a
  # placeholder megmozditotta), es az IOS SZAM BARHOL MERHETO -- akkor is, ahol
  # a titok nem elerheto.
  #
  # ES AMI NEM MAGYARAZZA: az `--environment` kapcsolo. Az a KIADO ag
  # parancsaban all, a mero ag nem hiv `eas`-t egyaltalan -- csak a helyi
  # `@expo/fingerprint` binarist. A kornyezet itt az EAS_ENVIRONMENT valtozobol
  # jon, es a szamot nem erinti.
  TITOK="${GOOGLE_SERVICES_JSON:-$MOBIL/google-services.json}"
  if [ -r "$TITOK" ]; then
    echo "  (android: a google-services.json OLVASHATO ($TITOK), tehat az android szam is mervado)"
  else
    echo "  (android: a google-services.json NEM olvashato innen ($TITOK) -- a fingerprint"
    echo "   resze, tehat az android szam MAS, mint ott, ahol a titok elerheto. Az ios a mervado.)"
  fi
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
