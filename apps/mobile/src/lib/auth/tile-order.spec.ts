import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { launcherModules, MODULE_ORDER } from "../home/modules";
import { HOME_PRESETS, homeModules } from "../home/presets";
import { TILE_ENTRY, type TileCode } from "./tile-visibility";

/**
 * A SZERVIZES SORRENDJE BALÁZS KÉRÉSE (2026-09-16, Discord): "A sorrend ugy
 * legyen szervizes jogosultsaggal, hogy Hibajegyek, Munkalapok, Eszkozok,
 * Partnerek".
 *
 * WHERE THE ORDER LIVES SINCE THE MOBILE HOME V1 (phase 1). The tiles are no
 * longer ten `ModuleCard` lines in `app/index.tsx`, so the order is no longer
 * read from the screen's source. It lives in two lists, and both keep the
 * request:
 *
 * - `MODULE_ORDER`, the Modulok screen's order, for every module;
 * - the service view's `modules`, the order the Home leads with.
 *
 * The request is kept by the same two things as before: the order of the list
 * and what the SERVICE role is served. If either moves, the request breaks
 * silently, so both are measured here.
 */
function lathato(kod: TileCode, ertekek: readonly string[]): boolean {
  return ertekek.includes(TILE_ENTRY[kod]);
}

/**
 * A SZERVIZES MENÜJE: the entries Balázs's request named. The service role is
 * also served `material-requests-pending` and `aquariums` since then; this
 * list measures the stated request, not the full menu (that is pinned by the
 * full order below).
 */
const SZERVIZES_MENU = [
  "service-jobs",
  "service-assets",
  "worksheets",
  "partners",
];

describe("a csempék sorrendje", () => {
  it("POZITÍV KONTROLL: minden csempe pontosan egyszer szerepel a sorban", () => {
    // Without this, an empty or partial list would pass every check below.
    assert.deepEqual(
      [...MODULE_ORDER].sort(),
      (Object.keys(TILE_ENTRY) as TileCode[]).sort(),
    );
  });

  it("a szervizes ezt a négyet látja a Modulok alatt, EBBEN a sorrendben", () => {
    assert.deepEqual(
      launcherModules((kod) => lathato(kod, SZERVIZES_MENU)),
      ["HJ", "MU", "ES", "PA"],
      "Balázs kérése: Hibajegyek, Munkalapok, Eszközök, Partnerek",
    );
  });

  it("és a kezdőlap szerviz nézete is ebben a sorrendben vezet", () => {
    assert.deepEqual(
      homeModules(HOME_PRESETS.service, (kod) => lathato(kod, SZERVIZES_MENU)),
      ["HJ", "MU", "ES", "PA"],
      "Balázs kérése: Hibajegyek, Munkalapok, Eszközök, Partnerek",
    );
  });

  /**
   * TESTVÉR-KONTROLL: the launcher's full order is pinned, so a module moved
   * without a word turns this red. The modules with no screen (BE, TE, NAV)
   * stand last: they are never drawn (`route: null`), so their place is only
   * where they will appear the day they get a screen.
   */
  it("a teljes sorrend rögzített", () => {
    assert.deepEqual(MODULE_ORDER, [
      "HJ",
      "MU",
      "AI",
      "ES",
      "AK",
      "RE",
      "PA",
      "BE",
      "TE",
      "NAV",
    ]);
  });
});
