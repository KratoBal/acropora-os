// @ts-check
const { getDefaultConfig } = require("expo/metro-config");

/**
 * A WEBES EXPORT A `.wasm` FÁJLON ÁLL MEG, ÉS NEM AZÉRT, MERT HIÁNYZIK.
 *
 * MÉRVE 2026-08-29: az `npx expo export --platform web` ezzel hasal el:
 *
 *     Unable to resolve module ./wa-sqlite/wa-sqlite.wasm
 *       from node_modules/expo-sqlite/web/worker.ts
 *
 * A fájl viszont OTT VAN: `node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm`,
 * 621 492 bájt. Nem hiányzik és nem sérült -- a Metro nem ismeri fel a
 * kiterjesztést. Sem az `@expo/metro-config` alapértékei, sem a `metro-config`
 * `defaults.js`-e nem sorolja a `wasm`-ot (mindkettőre nulla találat), és a
 * projektnek eddig nem volt saját Metro-konfigurációja.
 *
 * A HIBAÜZENET ITT KÉT KÜLÖNBÖZŐ DOLGOT TAKAR ugyanazzal a szöveggel: a
 * "nem tudom feloldani" ugyanúgy szól egy hiányzó fájlra, mint egy fel nem
 * ismert kiterjesztésre. Az elsőt csomag-telepítés javítja, a másodikat ez a
 * fájl -- és a kettőt csak az különbözteti meg, ha valaki MEGNÉZI, ott van-e.
 *
 * EZÉRT `assetExts` ÉS NEM `sourceExts`: a `.wasm` bináris eszköz, nem
 * fordítandó forrás. A `sourceExts` alá téve a Metro megpróbálná értelmezni.
 */
const config = getDefaultConfig(__dirname);

config.resolver.assetExts = [...config.resolver.assetExts, "wasm"];

module.exports = config;
