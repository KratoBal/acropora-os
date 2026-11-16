import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMAIL_CTA_STYLE, sanitizeRichHtml } from "@acropora/rich-text";

import {
  buildMimeMessage,
  mailHtmlDocument,
} from "../notifications/mail/mime.js";
import {
  closingForMail,
  CONFIRMATION_BUTTON,
  CONFIRMATION_SUBJECT,
  LEGACY_CONFIRMATION_SUBJECTS,
  renderConfirmationMail,
} from "./game-confirmation-mail.js";

/*
  WHAT TURNS THIS RED (the giveaway's confirmation mail, in the "email" profile: acrobot, 2026-11-06 00:52). A body the
  sender's gate would refuse (the builder throws MAIL_HTML_UNSANITIZED when the body is not its own sanitized output);
  the confirm button missing or not a button (the frame writes the inline style only for `data-cta`); the link, the
  question, the choice label or the closing time missing; the closing time in the wrong zone (Budapest, not UTC); a
  value not escaped; a FREE-TEXT answer quoted at all (it reaches a stranger's inbox from our sender, and no filter
  held: barracuda, #2263 review); the plain-text twin saying something the HTML does not.
*/
const LINK = "https://jatek-teszt.acropora.hu/megerosites?token=abc_DEF-123";
const CLOSES = new Date("2026-11-13T22:59:59Z");
const full = renderConfirmationMail({
  link: LINK,
  prompt: "Melyik a legismertebb zátonyépítő korall?",
  choiceLabel: "Acropora",
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

  // WHAT TURNS THIS RED (Balázs, 2026-11-06 evening, exchange/jatek/szovegjavitas-balazs-2026-11-06.md, LEVEL): the subject or
  // the two sentences reading as before ("A játékod akkor érvényes, ha megerősíted." / "A megerősítés a kérdés zárásáig
  // érvényes:"); the test mail not using the same template (it calls the same function; the subject is the same constant).
  it("carries Balázs's subject and the two rewritten sentences, and not the old ones", () => {
    assert.equal(
      CONFIRMATION_SUBJECT,
      "Erősítsd meg a részvételed: Acropora karácsonyi nyereményjáték",
    );
    assert.ok(
      LEGACY_CONFIRMATION_SUBJECTS.includes(
        "Erősítsd meg a játékodat: Acropora karácsonyi nyereményjáték",
      ),
    );
    const m = renderConfirmationMail({
      link: LINK,
      prompt: "Kérdés?",
      closesAt: new Date("2026-11-13T22:59:59Z"),
    });
    for (const text of [m.html, m.text]) {
      assert.match(text, /Kérünk, hogy erősítsd meg részvételed:/);
      assert.match(text, /Megerősíteni eddig az időpontig tudsz:/);
      assert.match(text, /\(budapesti idő\)/);
      assert.doesNotMatch(text, /A játékod akkor érvényes/);
      assert.doesNotMatch(text, /zárásáig érvényes/);
    }
  });

  it("escapes what it is given: a question or a label with markup does not become markup", () => {
    const m = renderConfirmationMail({
      link: LINK,
      prompt: 'Mi az <b>"a" & b</b>?',
      choiceLabel: "ez & az",
    });
    assert.ok(!m.html.includes("<b>"));
    assert.match(m.html, /&lt;b&gt;/);
    assert.match(m.html, /ez &amp; az/);
    assert.ok(
      m.text.includes('Mi az <b>"a" & b</b>?'),
      "the text twin shows it as plain characters",
    );
  });

  it("without the details it still carries the link, and leaves the question, the choice line and the closing out", () => {
    const m = renderConfirmationMail({ link: LINK });
    assert.match(m.html, /data-cta=""/);
    assert.doesNotMatch(
      m.html,
      /A heti kérdés|A beküldött válaszod|Megerősíteni eddig/,
    );
    assert.ok(m.text.includes(LINK));
  });
});

describe("the answer in the mail", () => {
  it("a choice's label is shown (our own text), a missing or blank one leaves the line out", () => {
    assert.match(
      renderConfirmationMail({ link: LINK, choiceLabel: "Montipora" }).html,
      /A beküldött válaszod: <strong>Montipora<\/strong>/,
    );
    for (const nincs of [undefined, null, "", "   "])
      assert.doesNotMatch(
        renderConfirmationMail({ link: LINK, choiceLabel: nincs }).html,
        /A beküldött válaszod/,
      );
  });

  it("the input has no field for a free-text answer: the mail cannot carry one", () => {
    // a free answer cannot be handed over by a field called `answer`: it does not exist
    const m = renderConfirmationMail({
      link: LINK,
      prompt: "Kérdés?",
      ...({ answer: "nyeremeny-acropora.hu/atvetel 06 30 123 4567" } as object),
    });
    assert.doesNotMatch(m.html, /nyeremeny-acropora|06 30/);
    assert.doesNotMatch(m.text, /nyeremeny-acropora|06 30/);
    assert.doesNotMatch(m.html, /A beküldött válaszod/);
  });
});
