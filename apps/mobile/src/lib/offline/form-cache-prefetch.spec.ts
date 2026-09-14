import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideFormCachePrefetch,
  PREFETCH_AFTER_HOURS,
  PREFETCH_UNIT_PARTNER_LIMIT,
} from "./form-cache-prefetch";
import { STALE_AFTER_HOURS } from "./offline-notice";

/**
 * AMIT EZEK AZ ALLITASOK ORIZNEK.
 *
 * A tet nem az, hogy az elotoltes lefut-e, hanem hogy a MASOLAT NE LEGYEN URES
 * akkor, amikor mar nincs halozat. Egy ures masolat es egy nem letezo masolat a
 * telefonon ugyanugy nez ki: nincs mibol valasztani.
 *
 * Az ido itt bemenet, rogzitett `now` ertekkel: a korhatarok nem a futtatas
 * pillanatatol fuggenek.
 */
describe("decideFormCachePrefetch", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");
  const alap = {
    online: true,
    authenticated: true,
    assetsManage: true,
    ownersSyncedAt: null as string | null,
    now,
  };

  it("fut, ha meg soha nem mentettunk masolatot", () => {
    assert.deepEqual(decideFormCachePrefetch(alap), {
      run: true,
      reason: "futhat",
    });
  });

  it("nem fut halozat nelkul, es ez az elso kapu", () => {
    const dontes = decideFormCachePrefetch({ ...alap, online: false });
    assert.equal(dontes.run, false);
    assert.equal(dontes.reason, "offline");
  });

  it("nem fut munkamenet nelkul", () => {
    const dontes = decideFormCachePrefetch({ ...alap, authenticated: false });
    assert.equal(dontes.run, false);
    assert.equal(dontes.reason, "nincs-munkamenet");
  });

  /**
   * UGYANAZ A KAPU, MINT AZ URLAPON. Aki nem vihet fel eszkozt, annal a
   * szerver ugyis megtagadna a listat, es egy 403 a fokepernyon ugyanugy nema
   * lenne -- csak elobb elkoltottunk ra egy hivast.
   */
  it("nem fut jogosultsag nelkul", () => {
    const dontes = decideFormCachePrefetch({ ...alap, assetsManage: false });
    assert.equal(dontes.run, false);
    assert.equal(dontes.reason, "nincs-jogosultsag");
  });

  it("nem fut ujra, ha a masolat a hatarnal frissebb", () => {
    const ora = 60 * 60 * 1000;
    const dontes = decideFormCachePrefetch({
      ...alap,
      ownersSyncedAt: new Date(
        now.getTime() - (PREFETCH_AFTER_HOURS - 1) * ora,
      ).toISOString(),
    });
    assert.equal(dontes.run, false);
    assert.equal(dontes.reason, "friss-a-masolat");
  });

  it("ujra fut, ha a masolat eleri a hatart", () => {
    const ora = 60 * 60 * 1000;
    const dontes = decideFormCachePrefetch({
      ...alap,
      ownersSyncedAt: new Date(
        now.getTime() - PREFETCH_AFTER_HOURS * ora,
      ).toISOString(),
    });
    assert.equal(dontes.run, true);
  });

  /**
   * A KET HATAR VISZONYA AZ ALLITAS, NEM A KET SZAM.
   *
   * Az elotoltesnek SZIGORUAN a kimondas elott kell frissitenie, kulonben a
   * szerelo egy egesz munkanapot vihet ki ugy, hogy a lapja regit mond. Ha
   * valaki barmelyik szamot atirja, ez a sor szol.
   */
  it("a frissites hatara a regi-hatar ALATT van", () => {
    assert.ok(PREFETCH_AFTER_HOURS < STALE_AFTER_HOURS);
  });

  /**
   * A hibas datum ugyanaz, mint a hianyzo: nem tudjuk, mikori a masolat, tehat
   * frissiteni kell. (Az `isCacheStale` ezt mar igy kezeli; itt az a tet, hogy
   * az elotoltes NE dontson mashogy.)
   */
  it("ertelmezhetetlen idopontnal frissit", () => {
    const dontes = decideFormCachePrefetch({
      ...alap,
      ownersSyncedAt: "nem-datum",
    });
    assert.equal(dontes.run, true);
  });
});

describe("PREFETCH_UNIT_PARTNER_LIMIT", () => {
  /**
   * A HATAR A MERT ALLAPOT TOBBSZOROSE. Murena merese szerint (2026-09-04)
   * ketto valaszthato szervizpartner van. Egy egynel-kettonel szorosabb hatar
   * ma is levagna valodi partnereket; ez a sor azt orzi, hogy a hatar OR
   * maradjon, ne szuko.
   */
  it("bosegesen a mai ket partner folott all", () => {
    assert.ok(PREFETCH_UNIT_PARTNER_LIMIT >= 10);
  });
});
