import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  handLabel,
  measurementReport,
  type MeasuredItem,
} from "./capasuli-jev-measure.js";

/**
 * A VAK MÉRÉS ÖSSZESÍTÉSE (brief: hány nekünk szólót engedett át, hány nem
 * nekünk szólót szűrt ki, és minden tévedés NÉVVEL). MI PIROSÍT: ha egy
 * tévedés a számokban elbújik a neve nélkül; ha egy kézi címke ékezet vagy
 * betűméret miatt nem illik; ha a kimenetben e-mail-cím marad.
 */
describe("a vak mérés", () => {
  it("a kézi címke ékezettől és betűmérettől függetlenül illik", () => {
    assert.equal(
      handLabel("A BIOSZŰRŐ FELNYOMÓ motorja leesett")?.label,
      "OURS",
    );
    assert.equal(handLabel("Tető beázás a medence felett")?.label, "NOT_OURS");
    assert.equal(handLabel("Köszönjük a munkát"), null);
  });

  it("a tévedések névvel, a számok mellett", () => {
    const item = (
      title: string,
      kind: string | null,
      confidence = 0.9,
    ): MeasuredItem => ({
      reportDate: "2026-09-24",
      title,
      rule: handLabel(title),
      verdict: kind ? { kind, confidence } : null,
    });
    const report = measurementReport(
      [
        item("Bioszűrő felnyomó motor leesett", "OUR_TECHNICAL_FAULT"),
        item("Venturi szivattyú takarítás", "NOT_A_FAULT"),
        item("Biodóm ajtó beragad", "NOT_OURS"),
        item("Nyitvatartás módosul", "OUR_TECHNICAL_FAULT"),
        item("Tető beázás", "NOT_OURS", 0.5),
        item("valaki@zoobudapest.com írt", null),
      ],
      0.7,
    );
    assert.match(
      report,
      /Nekünk szóló, piszkozat lett: 1 \/ 2\. TÉVESEN KISZŰRVE: 2026-09-24 venturi szivattyú takarítás\./,
    );
    assert.match(
      report,
      /Nem nekünk szóló, kiszűrve: 1 \/ 3\. TÉVESEN ÁTENGEDVE: 2026-09-24 nyitvatartás; 2026-09-24 tető beázás\./,
    );
    assert.match(report, /besorolás nélkül 1/);
    assert.doesNotMatch(report, /@/);
  });
});
