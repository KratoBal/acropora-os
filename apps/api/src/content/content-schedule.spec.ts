import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SCHEDULE_HORIZON_DAYS,
  SCHEDULE_WARNING_DAY,
  scheduleStanding,
  scheduleTargetFor,
} from "./content-schedule.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const ANCHOR = new Date("2026-09-01T10:00:00.000Z");

const at = (days: number, hours = 0) =>
  new Date(ANCHOR.getTime() + days * DAY_MS + hours * HOUR_MS);

describe("where a scheduled post is aimed", () => {
  /**
   * A +29 NAP NEM ÓVATOSSÁG, HANEM A MÉRT HATÁR: a Graph API a +30 napot
   * elutasítja, a +29-et elfogadja. Ha ez a szám elcsúszik, az ütemezés nem
   * lassabb lesz, hanem ELHASAL -- és a poszt sehol nem lesz.
   */
  it("aims at the far end of the window the API accepts", () => {
    assert.equal(SCHEDULE_HORIZON_DAYS, 29);
    assert.equal(scheduleTargetFor(ANCHOR).getTime(), at(29).getTime());
  });
});

describe("the fuse on a scheduled post", () => {
  it("is running while there is still time", () => {
    const standing = scheduleStanding({ scheduleAnchoredAt: ANCHOR }, at(10));

    assert.equal(standing.standing, "running");
  });

  /**
   * A HATÁR ELÉRÉSE MÁR A KÉSŐBBI ÁLLAPOT. Egy `>` itt azt jelentené, hogy a
   * 25. nap pontos pillanatában még „fut", és a figyelmeztetés csak a következő
   * ellenőrzéskor menne ki -- ami órákkal odébb lehet, a türelmi idő pedig
   * mindössze kettő.
   */
  it("warns from the twenty-fifth day, not after it", () => {
    const justBefore = scheduleStanding(
      { scheduleAnchoredAt: ANCHOR },
      new Date(at(SCHEDULE_WARNING_DAY).getTime() - 1),
    );
    const exactly = scheduleStanding(
      { scheduleAnchoredAt: ANCHOR },
      at(SCHEDULE_WARNING_DAY),
    );

    assert.equal(justBefore.standing, "running");
    assert.equal(exactly.standing, "warning");
  });

  it("expires two hours after the warning, not sooner", () => {
    const withinGrace = scheduleStanding(
      { scheduleAnchoredAt: ANCHOR },
      at(SCHEDULE_WARNING_DAY, 1),
    );
    const afterGrace = scheduleStanding(
      { scheduleAnchoredAt: ANCHOR },
      at(SCHEDULE_WARNING_DAY, 2),
    );

    assert.equal(withinGrace.standing, "warning");
    assert.equal(afterGrace.standing, "expired");
  });

  /**
   * A NAPTÁRNAK KÉT DÁTUMA VAN, és ez az állítás mondja ki: amikorra ütemezve
   * van (29. nap), és amikor a MI határidőnk lejár rajta (25. nap). A kettő
   * négy nappal tér el, és a felület nem mutathatja őket egynek.
   */
  it("has a deadline four days before the post would go out", () => {
    const standing = scheduleStanding({ scheduleAnchoredAt: ANCHOR }, ANCHOR);
    assert.equal(standing.standing, "running");
    if (standing.standing !== "running") return;

    const target = scheduleTargetFor(ANCHOR);
    const daysBetween = (target.getTime() - standing.warnAt.getTime()) / DAY_MS;

    assert.equal(daysBetween, 4);
  });

  /**
   * A DÁTUM MOZDÍTÁSA ÚJRAINDÍTJA A GYÚJTÓZSINÓRT, A SZÖVEGMÓDOSÍTÁS NEM.
   *
   * Ezt a modell úgy éri el, hogy a horgony NEM az utolsó szerkesztés, hanem az
   * utolsó dátum-mozdítás. Ha a szerkesztés is átírná, egy vesszőhiba javítása
   * újraindítaná a határidőt, és a szabály elvesztené az értelmét: a
   * semmittevés megint kitehetné a posztot.
   */
  it("restarts from the moved date, so the fuse follows the decision", () => {
    const movedOnDay20 = at(20);
    const standing = scheduleStanding(
      { scheduleAnchoredAt: movedOnDay20 },
      at(26),
    );

    // A 26. nap az EREDETI horgonyhoz képest már figyelmeztetés lenne; a
    // mozdított horgonyhoz képest a hatodik nap, tehát még fut.
    assert.equal(standing.standing, "running");
  });
});
