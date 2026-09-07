import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  derivePickupOnly,
  LIVE_ANIMAL_ROOT_NAMES,
  liveAnimalSubtreeIds,
} from "./medusa-livestock.policy.js";

const FA = [
  { id: "gy1", name: "Korallok", parentId: null },
  { id: "gy1a", name: "SPS", parentId: "gy1" },
  { id: "gy1a1", name: "Acropora", parentId: "gy1a" },
  { id: "gy2", name: "Halak", parentId: null },
  { id: "gy3", name: "Gerinctelenek", parentId: null },
  { id: "mu1", name: "Technika", parentId: null },
  { id: "mu1a", name: "Lámpák", parentId: "mu1" },
];

describe("az élő állat részfa", () => {
  /**
   * A RESZFA A LENYEG, NEM A GYOKER: a stage termekei NEM a gyokeren allnak,
   * hanem alkategoriaban (a harom mai korall az SPS ag alatt). Egy csak-gyoker
   * illesztes mindharmat elengedne.
   */
  it("a gyökereket ÉS a leszármazottaikat is tartalmazza", () => {
    const ids = liveAnimalSubtreeIds(FA);

    for (const id of ["gy1", "gy1a", "gy1a1", "gy2", "gy3"])
      assert.equal(ids.has(id), true, `${id} kimaradt a részfából`);
  });

  it("a műszaki ág nem kerül bele", () => {
    const ids = liveAnimalSubtreeIds(FA);

    assert.equal(ids.has("mu1"), false);
    assert.equal(ids.has("mu1a"), false);
  });

  /**
   * MIND A HAROM NEV SZAMIT.
   *
   * === EGY KORLAT, AMI HAROM ORA ALATT LEJART, ES EZERT ALL ITT MIND A KETTO ===
   *
   * Amikor ezt a tesztet irtam (2026-09-07 kora este), a Halak es a
   * Gerinctelenek alatt NULLA termek allt a boltban, tehat azt a ket agat
   * valodi adaton senki nem tudta kiprobalni -- csak ez az allitas orizte.
   *
   * A TELJES KATALOGUS MIGRACIOJA UTAN (ugyanaznap 20:22, acrobot merese a
   * bolti kategoria-fan) mar 125 hal es 28 gerinctelen all bent, a harom ag
   * unioja 161 termek. A korlat tehat nem tevedes volt, hanem LEJART.
   *
   * Azert marad itt mind a ketto, mert a kulonbseg hasznalhato: ez az allitas
   * azt orzi, hogy a HAROM NEV bent van a szabalyban. Azt NEM, hogy a bolti
   * fa tenyleg ugy all, ahogy hisszuk -- ahhoz egy VALODI termeken kell
   * megnezni, hogy a szarmaztatas bolti atvetelre allitja-e.
   */
  it("mindhárom gyökér-név benne van a szabályban", () => {
    assert.deepEqual(
      [...LIVE_ANIMAL_ROOT_NAMES],
      ["Korallok", "Halak", "Gerinctelenek"],
    );
  });
});

describe("a bolti átvétel származtatása", () => {
  const ELO = liveAnimalSubtreeIds(FA);

  it("élő állat ág alatt kötelező a bolti átvétel", () => {
    assert.equal(derivePickupOnly(["gy1a1"], ELO), true);
  });

  it("műszaki termékre nem", () => {
    assert.equal(derivePickupOnly(["mu1a"], ELO), false);
  });

  /**
   * MINDEN BESOROLAS SZAMIT: a WYSIWYG szabalynal a hat termekbol NEGYNEL csak
   * ALTERNATIV besorolaskent allt a kategoria. Egy elsodleges-szures negyet
   * elengedne, es azok postara kerulnenek.
   */
  it("elég, ha a MÁSODIK besorolás esik az ág alá", () => {
    assert.equal(derivePickupOnly(["mu1a", "gy2"], ELO), true);
  });

  it("besorolás nélkül nincs korlátozás", () => {
    assert.equal(derivePickupOnly([], ELO), false);
  });
});
