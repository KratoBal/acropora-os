import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  extractCapasuliReports,
  problemFingerprint,
} from "./capasuli-extractor.js";
import {
  capasuliConfig,
  describeCapasuliSync,
} from "./capasuli-gmail.config.js";
const fixture = readFileSync(
  new URL(
    "../../src/service-drafts/fixtures/capasuli-2026-10-03.txt",
    import.meta.url,
  ),
  "utf8",
);
describe("Cápasuli template extraction", () => {
  it("produces exactly pump+pipes with the three photos, and a separate LCD", () => {
    const r = extractCapasuliReports(fixture);
    assert.equal(r.length, 1);
    assert.equal(r[0]!.reportDate.toISOString().slice(0, 10), "2026-10-03");
    const items = r[0]!.problems;
    assert.equal(items.length, 2);
    assert.match(items[0]!.text, /És a felette/);
    assert.deepEqual(items[0]!.attachmentNames, [
      "IMG_0843.jpeg",
      "IMG_0844.jpeg",
      "IMG_0846.jpeg",
    ]);
    assert.match(items[1]!.text, /LCD/);
    assert.equal(items[1]!.attachmentNames.length, 0);
    assert(!items.some((i) => /tojás|MgCl2|Merülés/.test(i.text)));
  });
  it("an Android Outlook mail: no draft from the bullet lines or the client footer", () => {
    const android = readFileSync(
      new URL(
        "../../src/service-drafts/fixtures/capasuli-2026-09-24-android.txt",
        import.meta.url,
      ),
      "utf8",
    );
    const items = extractCapasuliReports(android)[0]!.problems;
    assert.deepEqual(
      items.map((i) => i.text.slice(0, 20)),
      ["Az elkülönítő bioszű", "A szokásos helyeken "],
    );
    assert(!items.some((i) => /Outlook|^\W*$/u.test(i.text)));
  });
  it("links the biofilter lift reported again without the tank name", () => {
    const later = extractCapasuliReports(
      "Cápasuli: 2026. szeptember 26.\nNap folyamán felmerülő hibák, intézkedések:  volt.\nPlusz a bioszűrő felnyomója lassan beleesik a rájamedence technikai tartályába.\nAndroidos Outlookból<https://aka.ms/AAb9ysg> küldve",
    )[0]!.problems;
    assert.equal(later.length, 1);
    assert.equal(later[0]!.repeatKey, "elkulonito-bioszuro-felnyomo-motor");
  });
  it("recognises quoted reports and stable deduplication independent of names", () => {
    const a = extractCapasuliReports(fixture)[0]!;
    const b = extractCapasuliReports(
      fixture
        .replaceAll("[NEV]", "Másik Né v")
        .split("\n")
        .map((l) => "> > " + l)
        .join("\n"),
    )[0]!;
    assert.equal(a.problems[0]!.fingerprint, b.problems[0]!.fingerprint);
  });
  it("finds a technical request hidden in work, but excludes routine work", () => {
    const r = extractCapasuliReports(
      "Cápasuli: 2026. szeptember 30.\nNap során történt fontosabb események, munkák: volt\nA sókeverő szivattyú szűrőkosarát kitisztítottuk. Lehet egy csere ráférne.\nSózó feltöltve.\nNap folyamán felmerülő hibák, intézkedések: nem volt.",
    );
    assert.equal(r[0]!.problems.length, 1);
    assert.match(r[0]!.problems[0]!.text, /csere/);
  });
  it("keeps a technical request split across lines, without routine photos", () => {
    const text =
      "Cápasuli: 2026. szeptember 30.\nNap során történt fontosabb események, munkák: volt\nA sókeverő szivattyú szűrőkosarát kitisztítottuk.\nLehet egy csere ráférne.\n[repair.jpeg]\nSózó feltöltve.\n[routine.jpeg]";
    const [report] = extractCapasuliReports(text);
    assert.equal(report!.problems.length, 1);
    assert.match(report!.problems[0]!.text, /kitisztítottuk\.\nLehet/);
    assert.deepEqual(report!.problems[0]!.attachmentNames, ["repair.jpeg"]);
  });
  it("links clearly repeated motor descriptions without merging report days", () => {
    const r = extractCapasuliReports(
      "Cápasuli: 2026. szeptember 24.\nNap folyamán felmerülő hibák, intézkedések: volt\nAz elkülönítő bioszűrőjének a felnyomó motorja kis híján leesik a tartó konzolokról.\nSürgős rögzítést igényel.\nCápasuli: 2026. szeptember 26.\nNap folyamán felmerülő hibák, intézkedések: volt\nAz elkülönítő bioszűrőjének felnyomó motorja még mindig nincs rögzítve.",
    );
    assert.equal(r.length, 2);
    assert.equal(r[0]!.problems.length, 1);
    assert.equal(r[0]!.problems[0]!.repeatKey, r[1]!.problems[0]!.repeatKey);
  });
  it("rejects invalid dates and bodies without the template", () => {
    assert.deepEqual(extractCapasuliReports("Re: szivattyú csere"), []);
    assert.deepEqual(extractCapasuliReports("Cápasuli: 2026. február 31."), []);
  });
  it("normalises superficial punctuation for a reply copy", () =>
    assert.equal(
      problemFingerprint("Szivattyú csere! (A név)"),
      problemFingerprint("szivattyu csere."),
    ));
});
describe("Cápasuli sync configuration", () => {
  it("defaults off and does not borrow another mailbox's credentials", () => {
    const c = capasuliConfig({
      GMAIL_FOXPOST_CLIENT_ID: "x",
      GMAIL_FOXPOST_CLIENT_SECRET: "x",
      GMAIL_FOXPOST_REFRESH_TOKEN: "x",
    });
    assert.equal(c.enabled, false);
    assert.equal(c.configured, false);
    assert.equal(c.user, "balazs@acropora.hu");
    assert.equal(c.query, 'from:zoobudapest.com subject:"napi jelentő"');
  });
  it("distinguishes an invalid switch and missing credentials", () => {
    assert.match(
      describeCapasuliSync(
        capasuliConfig({ GMAIL_CAPASULI_SYNC_ENABLED: "yes" }),
      ),
      /UNRECOGNISED/,
    );
    assert.match(
      describeCapasuliSync(
        capasuliConfig({ GMAIL_CAPASULI_SYNC_ENABLED: " TRUE " }),
      ),
      /missing/,
    );
  });
  it("enables only with complete dedicated keys and validates interval", () => {
    const c = capasuliConfig({
      GMAIL_CAPASULI_SYNC_ENABLED: " TRUE ",
      GMAIL_CAPASULI_CLIENT_ID: "a",
      GMAIL_CAPASULI_CLIENT_SECRET: "b",
      GMAIL_CAPASULI_REFRESH_TOKEN: "c",
      GMAIL_CAPASULI_SYNC_INTERVAL_MINUTES: "-1",
    });
    assert.equal(c.enabled, true);
    assert.equal(c.intervalMinutes, 60);
  });
});
