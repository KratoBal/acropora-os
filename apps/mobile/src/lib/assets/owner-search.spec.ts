import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OWNER_PICKER_LIMIT,
  filterOwners,
  matchesOwnerSearch,
  type SearchableOwner,
} from "./owner-search";

/**
 * A KIEMELÉS AKKOR JÓ, HA UGYANAZT CSINÁLJA, MINT AMI A KÉPERNYŐN ÁLLT.
 *
 * Ezek az állítások NEM azt mondják, hogy a szűrés szabálya helyes. Azt
 * mondják, hogy a MAI viselkedés rögzítve van, mert a kiemelés önmagában nem
 * bizonyítja: egy `useMemo`-ból kivett három sor pontosan olyan csendben tud
 * elmozdulni, mint amilyen csendben eddig védtelen volt.
 *
 * Ezért a határeset (a név és a kód HATÁRÁN fekvő keresés) is itt áll, holott
 * vitatható, hogy szándék-e. Ha egyszer megváltoztatjuk, ez a sor pirosra vált,
 * és akkor DÖNTÉS lesz belőle, nem mellékhatás.
 */

const owner = (displayName: string, code: string): SearchableOwner => ({
  displayName,
  code,
});

const owners = [
  owner("Fánk Kft.", "A-1"),
  owner("Görbe Bálna Zrt.", "B-2"),
  owner("Tenger Alatti Kft.", "C-3"),
];

describe("matchesOwnerSearch", () => {
  it("üres keresésre mindenkit átenged", () => {
    for (const needle of ["", "   "])
      assert.equal(matchesOwnerSearch(owners[0]!, needle), true, `[${needle}]`);
  });

  it("a névre és a kódra egyaránt talál", () => {
    assert.equal(matchesOwnerSearch(owners[0]!, "Fánk"), true);
    assert.equal(matchesOwnerSearch(owners[0]!, "A-1"), true);
  });

  it("a kis- és nagybetű nem számít, és a keresés széleit levágja", () => {
    assert.equal(matchesOwnerSearch(owners[1]!, "GÖRBE"), true);
    assert.equal(matchesOwnerSearch(owners[1]!, "  görbe  "), true);
  });

  /**
   * A NÉV ÉS A KÓD EGY SZÖVEGKÉNT keresődik, szóközzel összefűzve, tehát egy
   * olyan keresés is talál, ami a kettő HATÁRÁN fekszik. Ez a mai viselkedés,
   * és azért áll itt, hogy a megváltoztatása döntés legyen.
   */
  it("a név és a kód határán fekvő keresésre is talál", () => {
    assert.equal(matchesOwnerSearch(owners[0]!, "Kft. A-1"), true);
  });

  it("amire nem illik, arra nemet mond", () => {
    assert.equal(matchesOwnerSearch(owners[0]!, "Görbe"), false);
  });
});

describe("filterOwners", () => {
  it("a keresésre illő sorokat adja vissza", () => {
    assert.deepEqual(
      filterOwners(owners, "kft").map((item) => item.code),
      ["A-1", "C-3"],
    );
  });

  it("üres keresésre a teljes listát adja, a korlát alatt", () => {
    assert.deepEqual(filterOwners(owners, "").length, owners.length);
  });

  /**
   * A KORLÁT MÉRÉSE, KONTROLLAL. Egy `slice` állítása attól is teljesülne, hogy
   * a bemenet eleve rövidebb, ezért a bemenet hossza ELŐSZÖR szólal meg: ha az
   * nem HALADJA MEG a korlátot, a vágásról szóló sor nem bizonyít semmit.
   */
  it("a korlátnál többet nem ad vissza", () => {
    const many = Array.from({ length: OWNER_PICKER_LIMIT + 5 }, (_unused, i) =>
      owner(`Vevő ${i}`, `V-${i}`),
    );
    assert.ok(
      many.length > OWNER_PICKER_LIMIT,
      "kontroll: enélkül a vágás akkor is zöld lenne, ha nem vágna",
    );
    assert.equal(filterOwners(many, "").length, OWNER_PICKER_LIMIT);
    assert.equal(filterOwners(many, "vevő").length, OWNER_PICKER_LIMIT);
  });

  it("a bemenetet nem írja át", () => {
    const input = [...owners];
    filterOwners(input, "kft");
    assert.deepEqual(input, owners);
  });
});
