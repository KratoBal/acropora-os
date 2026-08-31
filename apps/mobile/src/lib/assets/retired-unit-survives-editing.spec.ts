import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { unitLevels, type PartnerUnitLike } from "../partners/site-tree";
import {
  assetEditFormFrom,
  buildAssetPatch,
  hasAssetChanges,
  type EditableAsset,
} from "./asset-edit";

/**
 * A KIVEZETETT HELYSZINEN ALLO ESZKOZ SZERKESZTESE: AZ EGYETLEN UT, AMIN EGY
 * MENTES FELULIRHAT EGY JO ERTEKET.
 *
 * A tobbi mobil hiba zavaro: rossz listat vagy rossz sorrendet mutat, es a
 * felhasznalo latja. EZ nem latszik: ha a beallitott helyszin eltunik a
 * valasztobol, a kepernyo ugy nez ki, mintha nem lenne helyszin -- es a
 * kovetkezo mentes elveszi. Az eszkoz utana egy MASIK helyen all, es semmi nem
 * mondja meg, hogy valaha mashol allt.
 *
 * AMIERT NEM A KEPERNYOT RENDERELJUK: a mobil csomag `node --test`-tel fut
 * forditott JS-en, es NINCS React Native renderelo (merve 2026-08-31: nulla
 * `.spec.tsx`, es sem `@testing-library/react-native`, sem `react-test-renderer`,
 * sem `jest-expo` nincs a fatan -- a workspace-ben allo `@testing-library/react`
 * a WEBES csomage). Egy renderelt teszt tehat uj fuggoseget es uj futtatot
 * kivanna, ami dontes, nem teszt.
 *
 * ERRE A KOCKAZATRA VISZONT NINCS IS SZUKSEG RA. Az ut HAROM tiszta fuggvenyen
 * megy at, es mindharom kulon is, egyutt is merheto:
 *
 *   1. BETOLTES  `assetEditFormFrom`  a form `unitId`-ja az eszkozbol jon
 *   2. MEGJELENITES `unitLevels`      a lanc ATMEGY a kivezetett csomoponton,
 *                                     es KIVALASZTOTTKENT mutatja
 *   3. MENTES    `buildAssetPatch`    a `departmentId` CSAK akkor megy ki, ha
 *                                     az ertek VALTOZOTT
 *
 * A ket vedelem FUGGETLEN: a 2. arra ved, hogy a felhasznalo lassa es ne irja
 * at; a 3. arra, hogy egy erintetlen mentes akkor se kuldjon, ha a 2. valaha
 * elromlana. Ezert all mindkettore kulon allitas, es a vegen a HARMOM egyutt.
 */

const RETIRED_UNIT = "unit-kivezetett";

const units: PartnerUnitLike[] = [
  {
    id: "unit-gyoker",
    parentId: null,
    code: "BIO",
    name: "Biodóm",
    isActive: true,
  },
  {
    id: RETIRED_UNIT,
    parentId: "unit-gyoker",
    code: "FOK",
    name: "Fókamedence",
    isActive: false,
  },
];

const asset = {
  updatedAt: "2026-08-31T10:00:00.000Z",
  ownerType: "SUPPLIER",
  owner: { type: "SUPPLIER", id: "sup-1" },
  unit: { id: RETIRED_UNIT, name: "Fókamedence" },
  status: "ACTIVE",
  criticality: "NORMAL",
  manufacturer: null,
  model: null,
  serialNumber: null,
  inventoryNumber: null,
  description: null,
  notes: null,
} as unknown as EditableAsset;

describe("kivezetett helyszínen álló eszköz szerkesztése", () => {
  it("1. a betöltött form a MEGLÉVŐ helyszínt hozza", () => {
    assert.equal(assetEditFormFrom(asset).unitId, RETIRED_UNIT);
  });

  /**
   * EZ AZ AZ ALLITAS, AMI ELBUKIK, ha valaki a lancbol kiszuri a kivezetett
   * csomopontot -- es ez ma DONTES, nem veletlen: a valaszthatosag szur, a lanc
   * nem. Egy kesobbi "takaritas" ezt egy sorral elveheti.
   */
  it("2. a lánc ÁTMEGY a kivezetett csomóponton, és kiválasztottként mutatja", () => {
    const levels = unitLevels(units, assetEditFormFrom(asset).unitId);
    const showing = levels.find((level) => level.selectedId === RETIRED_UNIT);
    assert.ok(showing, "a kivezetett helyszín egyetlen szinten sem választott");
    assert.ok(
      showing.options.some((option) => option.id === RETIRED_UNIT),
      "a kivezetett helyszín nem szerepel a felkínált sorok között",
    );
  });

  it("3. érintetlen mentés NEM küld helyszínt", () => {
    const form = assetEditFormFrom(asset);
    const patch = buildAssetPatch(asset, form);
    assert.equal("departmentId" in patch, false);
    assert.equal(hasAssetChanges(asset, form), false);
  });

  /**
   * A HAROM EGYUTT: ez az allitas az, ami a felhasznalo szemszogebol igaz.
   * Betolt, lat, ment -- es az ertek ugyanaz marad.
   */
  it("a három lépés együtt: a beállított helyszín túléli a szerkesztést", () => {
    const form = assetEditFormFrom(asset);
    const levels = unitLevels(units, form.unitId);
    assert.ok(levels.some((level) => level.selectedId === RETIRED_UNIT));
    assert.equal("departmentId" in buildAssetPatch(asset, form), false);
  });

  /**
   * ES A MASIK IRANY, hogy a fenti ne csak azert legyen zold, mert a mentes
   * SOHA nem kuld helyszint: ha a felhasznalo TENYLEG mast valaszt, kimegy.
   */
  it("kontroll: ha a felhasználó mást választ, a helyszín KIMEGY", () => {
    const form = { ...assetEditFormFrom(asset), unitId: "unit-gyoker" };
    assert.equal(buildAssetPatch(asset, form).departmentId, "unit-gyoker");
  });
});
