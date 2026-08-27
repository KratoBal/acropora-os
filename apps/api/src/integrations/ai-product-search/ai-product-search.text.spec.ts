import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainText } from "./ai-product-search.text.js";

describe("the description a model is allowed to read", () => {
  it("returns null for an absent description, and for one that was only markup", () => {
    // Null rather than "" so that absence keeps looking like absence all the
    // way into the projection, which already uses null for it.
    assert.equal(plainText(null), null);
    assert.equal(plainText(undefined), null);
    assert.equal(plainText("   "), null);
    assert.equal(plainText("<p></p>"), null);
  });

  it("cleans text whose flag claims it is NOT html", () => {
    /**
     * The measured case, and the reason this function looks at content
     * rather than at `descriptionShortIsHtml`: 774 products on the live
     * catalogue carry literal tags while the flag says plain text. The flag
     * is UNAS's statement about its own content, not our measurement of it.
     *
     * Nothing in this test passes a flag, and that is the assertion.
     */
    assert.equal(plainText("Elso sor<br>Masodik sor"), "Elso sor\nMasodik sor");
  });

  it("keeps sentences apart instead of gluing them together", () => {
    // Stripping every tag to nothing would produce "Elso sorMasodik sor",
    // which is worse than the markup it removed.
    assert.equal(
      plainText("<p>Elso sor</p><p>Masodik sor</p>"),
      "Elso sor\nMasodik sor",
    );
  });

  it("removes inline tags without touching the words around them", () => {
    assert.equal(
      plainText("A <strong>Balling</strong> rendszer <em>alap</em>oldata."),
      "A Balling rendszer alapoldata.",
    );
  });

  it("does not eat arithmetic that only looks like a tag", () => {
    // "<" followed by a space is not markup, and a description that says a
    // value is below a threshold must survive intact.
    assert.equal(plainText("Nitrat < 10 mg/l"), "Nitrat < 10 mg/l");
  });

  it("decodes the entities that actually turn up, including accented ones", () => {
    assert.equal(plainText("s&oacute;&nbsp;&amp;&nbsp;v&iacute;z"), "só & víz");
    assert.equal(plainText("22&nbsp;kg v&#246;dr&#246;s"), "22 kg vödrös");
    assert.equal(plainText("22 kg v&#xF6;dr&#xF6;s"), "22 kg vödrös");
  });

  it("leaves an entity it cannot decode visible rather than guessing", () => {
    // A visible `&#999999999;` is a bug report. A silent replacement
    // character is a bug that nobody files.
    assert.equal(plainText("ar &#999999999; ertek"), "ar &#999999999; ertek");
    assert.equal(plainText("&nemletezo; szo"), "&nemletezo; szo");
  });

  it("keeps a label and its value on one line, and never glues them", () => {
    /**
     * The live shape, measured: the animal descriptions are two-cell rows
     * where the label carries its own colon. A space between cells keeps the
     * pair readable; a line break would cut it in half.
     *
     * The second case is the one that does not occur in today's catalogue -
     * sixteen sampled descriptions, not one without whitespace between the
     * cells - and is asserted anyway, because the day it appears is not a
     * day anybody will be looking.
     */
    assert.equal(
      plainText(
        "<table><tr><td><b>Tartása:</b></td> <td>közepesen nehéz</td></tr></table>",
      ),
      "Tartása: közepesen nehéz",
    );
    assert.equal(
      plainText("<tr><td>Magyar neve:</td><td>Leopárd gömbhal</td></tr>"),
      "Magyar neve: Leopárd gömbhal",
    );
  });

  it("collapses runs of whitespace but keeps paragraph breaks", () => {
    assert.equal(plainText("<p>Elso</p>\n\n\n<p>Masodik</p>"), "Elso\nMasodik");
    assert.equal(plainText("sok     szokoz"), "sok szokoz");
  });
});
