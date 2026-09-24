import { describe, expect, it } from "vitest";

import {
  KIHAGYAS_OKA,
  KULDES_KIHAGYAS_OKA,
} from "./maintenance-package-mail-skip-reason";

/**
 * A KET TABLA VISZONYA, ES NEM A SZOVEGUK -- a hibajegyes
 * `handover-mail-skip-reason.test.ts` mintája, öt kontra hét okkal (a
 * karbantartási úton nincs `no-department`).
 */
describe("a kihagyasi okok ket tablaja (karbantartas)", () => {
  it("a kozos ot ok szovege BETURE ugyanaz a ket tablaban", () => {
    for (const [ok, szoveg] of Object.entries(KIHAGYAS_OKA)) {
      expect(KULDES_KIHAGYAS_OKA[ok as keyof typeof KIHAGYAS_OKA]).toBe(szoveg);
    }
  });

  it("az elonezet OT okot ismer, a kuldes HETET", () => {
    expect(Object.keys(KIHAGYAS_OKA)).toHaveLength(5);
    expect(Object.keys(KULDES_KIHAGYAS_OKA)).toHaveLength(7);
  });

  it("a ket tobblet a no-sender es a no-job", () => {
    const tobblet = Object.keys(KULDES_KIHAGYAS_OKA).filter(
      (ok) => !(ok in KIHAGYAS_OKA),
    );
    expect(tobblet.sort()).toEqual(["no-job", "no-sender"]);
  });
});
