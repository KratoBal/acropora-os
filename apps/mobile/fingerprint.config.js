// @ts-check
const { SourceSkips } = require("@expo/fingerprint");

/**
 * AZ OTA-RUNTIME (runtimeVersion policy: fingerprint) NEM FÜGGHET A package.json `scripts` MEZŐJÉTŐL.
 *
 * MÉRVE 2026-11-13 (kártya 2be4f497): az @expo/fingerprint alapból a package.json `scripts` mezőjét is beleszámolja
 * (forrás: `packageJson:scripts`). A #2393 (2026-11-10) csak a `test` szkriptet írta át, mégis új runtime-ot adott, és az azóta
 * kiadott OTA-k egyike sem találta a már telepített buildet. A két állapot ujjlenyomata a `scripts` forrás kihagyásával azonos.
 *
 * A DEFAULT_SOURCE_SKIPS-t NEM írjuk felül, hanem megtartjuk: a konfigurációban megadott `sourceSkips` az alapértelmezést CSERÉLI
 * (Options.js), nem bővíti.
 *
 * A KOCKÁZAT, AMIT EZ ELVESZ (barracuda, #2525): a `PackageJsonScriptsAll` MINDEN szkriptet kivesz, a natívra hatókat is. Ma nincs a mobil
 * package.json-ban `postinstall` vagy `eas-build-*` horog (a mainen lemérve). Ha valaha olyan szkript kerül bele, ami a natív kódot
 * változtatja (postinstall-javítás, `eas-build-post-install`), az ujjlenyomat NEM látja, és egy OTA rossz binárisra mehet: akkor ezt a
 * kihagyást szűkíteni kell.
 *
 * FIGYELEM, EZ A NATÍV BUILDEKRE IS HAT: a kihagyás megváltoztatja az ujjlenyomatot, tehát az első nativ build, ami már ezt a fájlt
 * tartalmazza, új runtime-ot kap. Ezért csak a KÖVETKEZŐ nativ builddel együtt mehet ki, nem egy OTA-val.
 *
 * @type {import("@expo/fingerprint").Config}
 */
module.exports = {
  sourceSkips:
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun |
    SourceSkips.PackageJsonScriptsAll,
};
