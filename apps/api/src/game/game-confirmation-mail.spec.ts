import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMAIL_CTA_STYLE, sanitizeRichHtml } from "@acropora/rich-text";

import {
  buildMimeMessage,
  mailHtmlDocument,
} from "../notifications/mail/mime.js";
import {
  answerForMail,
  closingForMail,
  CONFIRMATION_BUTTON,
  renderConfirmationMail,
} from "./game-confirmation-mail.js";

/*
  WHAT TURNS THIS RED (the giveaway's confirmation mail, in the "email" profile: acrobot, 2026-11-06 00:52). A body the
  sender's gate would refuse (the builder throws MAIL_HTML_UNSANITIZED when the body is not its own sanitized output);
  the confirm button missing or not a button (the frame writes the inline style only for `data-cta`); the link, the
  question, the answer or the closing time missing; the closing time in the wrong zone (Budapest, not UTC); a value
  not escaped; the player's answer quoted when it is long or carries a link or an address (it reaches a stranger's
  inbox from our sender); the plain-text twin saying something the HTML does not.
*/
const LINK = "https://jatek-teszt.acropora.hu/megerosites?token=abc_DEF-123";
const CLOSES = new Date("2026-11-13T22:59:59Z");
const full = renderConfirmationMail({
  link: LINK,
  prompt: "Melyik a legismertebb zátonyépítő korall?",
  answer: "Acropora",
  closesAt: CLOSES,
});

describe("the confirmation mail body", () => {
  it("carries the title, the question, the answer, the button with the link, the closing time and the ignore line", () => {
    assert.match(full.html, /<h2>Acropora karácsonyi nyereményjáték<\/h2>/);
    assert.match(
      full.html,
      /<strong>Melyik a legismertebb zátonyépítő korall\?<\/strong>/,
    );
    assert.match(full.html, /A beküldött válaszod: <strong>Acropora<\/strong>/);
    assert.match(
      full.html,
      new RegExp(
        `<p data-align="center" data-cta=""><a href="${LINK.replace(/[.?]/g, "\\$&")}">${CONFIRMATION_BUTTON}</a></p>`,
      ),
    );
    assert.match(full.html, /23:59<\/strong> \(budapesti idő\)/);
    assert.match(
      full.html,
      /Ha nem te küldted be ezt a választ, nincs teendőd/,
    );
  });

  it("the closing time is Budapest time, not UTC (22:59 UTC is 23:59 in November)", () => {
    assert.equal(closingForMail(CLOSES), "2026. november 13., 23:59");
    // summer time: the same instant of the clock reads one hour later
    assert.equal(
      closingForMail(new Date("2026-07-01T10:00:00Z")),
      "2026. július 1., 12:00",
    );
  });

  it("is its own sanitized output, so the sender's gate lets it through, and the frame makes the button inline-styled", () => {
    assert.equal(
      sanitizeRichHtml(full.html, { allowCidImages: true }),
      full.html,
    );
    assert.doesNotThrow(() =>
      buildMimeMessage(
        {
          to: ["jatekos@example.com"],
          subject: "x",
          html: full.html,
          text: full.text,
        },
        "ticket@acropora.hu",
      ),
    );
    const dokumentum = mailHtmlDocument(full.html);
    assert.ok(
      dokumentum.includes(EMAIL_CTA_STYLE),
      "the button gets the frame's inline style",
    );
    assert.match(dokumentum, /<a href="[^"]*megerosites[^"]*" style=/);
  });

  it("the plain-text twin comes from the same HTML and carries the link, the question, the answer and the closing time", () => {
    assert.match(
      full.text,
      new RegExp(`${CONFIRMATION_BUTTON}: ${LINK.replace(/[.?]/g, "\\$&")}`),
    );
    assert.ok(full.text.includes("Melyik a legismertebb zátonyépítő korall?"));
    assert.ok(full.text.includes("A beküldött válaszod: Acropora"));
    assert.ok(full.text.includes("2026. november 13., 23:59"));
    assert.ok(full.text.includes("nincs teendőd"));
    assert.doesNotMatch(full.text, /<|&amp;|&lt;/);
  });

  it("escapes what it is given: a question or an answer with markup does not become markup", () => {
    const m = renderConfirmationMail({
      link: LINK,
      prompt: 'Mi az <b>"a" & b</b>?',
      answer: "ez & az",
    });
    assert.ok(!m.html.includes("<b>"));
    assert.match(m.html, /&lt;b&gt;/);
    assert.match(m.html, /ez &amp; az/);
    assert.ok(
      m.text.includes('Mi az <b>"a" & b</b>?'),
      "the text twin shows it as plain characters",
    );
  });

  it("without the details it still carries the link, and leaves the question, the answer and the closing out", () => {
    const m = renderConfirmationMail({ link: LINK });
    assert.match(m.html, /data-cta=""/);
    assert.doesNotMatch(m.html, /A heti kérdés|A beküldött válaszod|zárásáig/);
    assert.ok(m.text.includes(LINK));
  });
});

describe("the answer shown in the mail", () => {
  it("is quoted when it is short and plain, with the white space collapsed", () => {
    assert.equal(
      answerForMail("  Acropora   millepora "),
      "Acropora millepora",
    );
    assert.equal(
      answerForMail("Kék tang (Paracanthurus)"),
      "Kék tang (Paracanthurus)",
    );
  });

  it("is NOT quoted when it carries a link, an address or markup, or when it is long or empty", () => {
    for (const rossz of [
      "https://rossz.example/megerosit",
      "nézd meg: www.rossz.example",
      "ir@pelda.hu",
      "<b>x</b>",
      "x".repeat(121),
      "   ",
      "",
    ])
      assert.equal(answerForMail(rossz), null, rossz);
    assert.equal(answerForMail(undefined), null);
    assert.equal(answerForMail(null), null);
    assert.equal(answerForMail("x".repeat(120)), "x".repeat(120));
  });

  it("drops control characters", () => {
    assert.equal(answerForMail("a\u0000b\u0007c\nd"), "a b c d");
  });

  it("a rejected answer is left out of the mail, the rest of the mail stays", () => {
    const m = renderConfirmationMail({
      link: LINK,
      prompt: "Kérdés?",
      answer: "http://rossz.example",
    });
    assert.doesNotMatch(m.html, /A beküldött válaszod/);
    assert.doesNotMatch(m.text, /rossz\.example/);
    assert.match(m.html, /A heti kérdés/);
  });
});
