import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  OFFLINE_GRACE_MS,
  canStartOffline,
  describeOfflineStart,
} from "./offline-grace";

/**
 * A KAPU, AMI MA MINDENT ZAR.
 *
 * Balazs kepernyokepe (repulogep uzemmod, 2026-09-02 23:31): az app EL SEM
 * INDUL halozat nelkul. Ez a modul dönti el, mikor szabad megis -- es a hatart
 * O adta meg, 24 oraban.
 */

const MOST = new Date("2026-09-03T12:00:00Z").getTime();
const ora = (n: number) => new Date(MOST - n * 60 * 60 * 1000).toISOString();

describe("a 24 órás offline beengedés", () => {
  it("friss ellenőrzéssel ENGED", () => {
    const v = canStartOffline({ lastVerifiedAt: ora(2), now: MOST });
    assert.equal(v.allowed, true);
  });

  it("a határon BELÜL enged, a határon TÚL nem", () => {
    /*
      A HATAR MAGA AZ ALLITAS. Enelkul egy "mindig enged" es egy "mindig tilt"
      valtozat is atmenne a szomszedos allitasokon.
    */
    assert.equal(
      canStartOffline({ lastVerifiedAt: ora(23), now: MOST }).allowed,
      true,
    );
    assert.equal(
      canStartOffline({ lastVerifiedAt: ora(25), now: MOST }).allowed,
      false,
    );
  });

  it("a határ pontosan 24 óra", () => {
    assert.equal(OFFLINE_GRACE_MS, 24 * 60 * 60 * 1000);
  });

  it("ha MÉG SOHA nem ellenőriztük online, NEM enged", () => {
    /*
      EZ A LEGFONTOSABB AG. Egy meglevo telepitesen a tarolt munkamenetben nincs
      `lastVerifiedAt` -- a mezo ma szuletik. A hianyabol NEM kovetkezik, hogy a
      munkamenet friss, csak az, hogy nem tudjuk.

      A ket teves irany ara nem egyforma: a felesleges ellenorzes egy varakozas,
      a teves beengedes egy visszavont munkamenettel valo tovabbdolgozas.
    */
    const v = canStartOffline({ lastVerifiedAt: null, now: MOST });
    assert.equal(v.allowed, false);
    assert.equal(v.allowed === false && v.reason, "never-verified");
  });

  it("olvashatatlan időbélyeg ugyanaz, mint a hiányzó", () => {
    const v = canStartOffline({ lastVerifiedAt: "ez nem dátum", now: MOST });
    assert.equal(v.allowed, false);
    assert.equal(v.allowed === false && v.reason, "never-verified");
  });

  it("JÖVŐBELI időbélyeg NEM enged be", () => {
    /*
      MI PIROSIT: egy `ageMs <= grace` alaku vizsgalat. Egy elore allitott ora
      vagy egy serult ertek negativ kort adna, es AZ MINDEN hataron atmenne --
      hatarozatlan idore nyitva hagyva a kaput.
    */
    const v = canStartOffline({ lastVerifiedAt: ora(-5), now: MOST });
    assert.equal(v.allowed, false);
  });

  it("a két tiltó ok KÜLÖN mondatot kap", () => {
    // A teendo mas: az egyikhez egyszer kell csatlakozni, a masik utan is
    // ugyanugy. Egy kozos mondat elrejtene, hogy az elso feloldhato.
    const soha = describeOfflineStart(
      canStartOffline({ lastVerifiedAt: null, now: MOST }),
    );
    const lejart = describeOfflineStart(
      canStartOffline({ lastVerifiedAt: ora(30), now: MOST }),
    );
    assert.notEqual(soha, lejart);
    assert.match(soha, /még nem volt sikeres szerver-ellenőrzés/);
    assert.match(lejart, /24 óránál régebbi/);
  });
});
