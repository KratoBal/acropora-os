/**
 * WHAT THE NATIVE FINGERPRINT LEAVES OUT (card 44aca07f, acrobot 63056).
 *
 * `runtimeVersion` follows the `fingerprint` policy (app.config.js): a change of the native surface gives a new runtime, and the
 * builds on the phones stop taking updates until a new build. Measured 2026-11-26 (@expo/fingerprint 0.20.6, APP_VARIANT=production):
 * #2393 (240ec9fee) only rewrote the `test` script in package.json, and both fingerprints moved (ios a6c2a631 -> ee84249d, android
 * d7b68532 -> 7a25867a); of the 124 sources exactly one differed, `packageJson:scripts`. A test or lint script never reaches the
 * phone, so it must not decide whether an update reaches it.
 *
 * `PackageJsonScriptsAll` replaces the default skip (`PackageJsonAndroidAndIosScriptsIfNotContainRun`, which it covers): no script
 * counts. Dependencies, app.config, the native config plugins and the assets still do.
 *
 * Adding this file is itself a fingerprint change: it goes in with the next native build, not on its own.
 */
/** @type {import("@expo/fingerprint").Config} */
module.exports = {
  sourceSkips: ["PackageJsonScriptsAll"],
};
