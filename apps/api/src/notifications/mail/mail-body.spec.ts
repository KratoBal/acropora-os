import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainTextToRichHtml, richHtmlToText } from "@acropora/rich-text";
import { MAIL_TEMPLATE_VARIABLES } from "@acropora/types";

import { DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE } from "./aquarium-measurement-mail.service.js";
import { mailBodyFields, renderMailBody } from "./mail-body.js";
import {
  DEFAULT_MATERIAL_REQUEST_CREATED_TEMPLATE,
  DEFAULT_MATERIAL_REQUEST_RECEIVED_TEMPLATE,
  DEFAULT_SERVICE_JOB_OPENED_TEMPLATE,
  DEFAULT_WORKSHEET_SEND_FOR_SIGNATURE_TEMPLATE,
  DEFAULT_WORKSHEET_SIGNED_TEMPLATE,
} from "./ticket-mail.service.js";

describe("renderMailBody", () => {
  it("bodyHtml nélkül a szöveges motor fut, HTML nincs", () => {
    const torzs = renderMailBody(
      { body: "Kedves {{cimzett}}!", bodyHtml: null },
      { cimzett: "Anna" },
    );
    assert.deepEqual(torzs, { ok: true, text: "Kedves Anna!" });
    assert.deepEqual(mailBodyFields({ text: "a" }), { text: "a" });
  });

  /**
   * A LINK CIME ERTEKBOL JON, ES A TISZTITAS A BEHELYETTESITES UTAN FUT. Ha
   * forditva lenne, egy `javascript:` ertek atmenne a mar tisztitott sablonon.
   */
  it("az értékből jövő javascript: cím kiesik, a felirat marad", () => {
    const torzs = renderMailBody(
      { body: "x", bodyHtml: '<p><a href="{{jegy_linkje}}">Megnyitás</a></p>' },
      { jegy_linkje: "javascript:alert(1)" },
    );
    assert.deepEqual(torzs, {
      ok: true,
      html: "<p><a>Megnyitás</a></p>",
      text: "Megnyitás",
    });
  });

  it("a szöveges változat a HTML-ből készül, nem a tárolt body-ból", () => {
    const torzs = renderMailBody(
      { body: "RÉGI SZÖVEG", bodyHtml: "<p>Új <em>{{cimzett}}</em></p>" },
      { cimzett: "Anna" },
    );
    assert.deepEqual(torzs, {
      ok: true,
      html: "<p>Új <em>Anna</em></p>",
      text: "Új Anna",
    });
  });
});

/**
 * A MEGLEVO SABLONOK ATVITELE: A HAT ALAPERTELMEZES ODA-VISSZA UTJA.
 *
 * Adat-migracio nincs: a szerkeszto a szoveget alakitja HTML-le, es mentes utan
 * a szoveges level a HTML-bol keszul. Ha ez az ut nem adna vissza karakterre a
 * mai szoveget, az atallas csendben atirna a leveleket -- es senki nem venne
 * eszre, mert mindket valtozat ertelmes.
 */
describe("a hat alapértelmezett sablon oda-vissza útja", () => {
  const nevek = MAIL_TEMPLATE_VARIABLES.map((v) => v.name);
  const linkek = MAIL_TEMPLATE_VARIABLES.filter((v) => v.kind === "link").map(
    (v) => v.name,
  );
  const SABLONOK = {
    DEFAULT_WORKSHEET_SIGNED_TEMPLATE,
    DEFAULT_SERVICE_JOB_OPENED_TEMPLATE,
    DEFAULT_WORKSHEET_SEND_FOR_SIGNATURE_TEMPLATE,
    DEFAULT_MATERIAL_REQUEST_CREATED_TEMPLATE,
    DEFAULT_MATERIAL_REQUEST_RECEIVED_TEMPLATE,
    DEFAULT_AQUARIUM_MEASUREMENT_RESULT_TEMPLATE,
  };
  it("hat sablon áll a listán", () => {
    assert.equal(Object.keys(SABLONOK).length, 6);
  });
  for (const [nev, sablon] of Object.entries(SABLONOK))
    it(nev, () => {
      const html = plainTextToRichHtml(sablon.body, { variables: nevek });
      assert.equal(
        richHtmlToText(html, { hrefPlaceholders: linkek }),
        sablon.body,
      );
    });
});
