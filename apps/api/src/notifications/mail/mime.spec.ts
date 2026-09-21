import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  base64Url,
  buildMimeMessage,
  encodeHeaderWord,
  MailBuildError,
} from "./mime.js";

const FELADO = "ticket@acropora.hu";
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

const LEVEL = {
  to: "nyito@partner.hu",
  subject: "[HJ-2026-001] Szivattyu zug",
  text: "Kedves Nóra!",
};

describe("a fejlec kodolasa", () => {
  it("a tiszta ASCII targyat NEM kodolja", () => {
    assert.equal(encodeHeaderWord("Pump noise"), "Pump noise");
  });

  /**
   * AZ EKEZETES TARGY KODOLT SZOKENT MEGY. Nyersen a fogado oldalan
   * olvashatatlan lehet, es az a hiba a VEVO postafiokjaban jelenik meg.
   */
  it("az ekezetes targyat RFC 2047 kodolt szokent adja", () => {
    const kodolt = encodeHeaderWord("Szivattyú zúg");
    assert.match(kodolt, /^=\?UTF-8\?B\?/);
    assert.equal(
      Buffer.from(kodolt.slice(10, -2), "base64").toString("utf8"),
      "Szivattyú zúg",
    );
  });
});

describe("a nyers level osszeallitasa", () => {
  it("a torzs base64-ben all, es a targy a fejlecben", () => {
    const nyers = buildMimeMessage(LEVEL, FELADO);
    assert.match(nyers, /^From: ticket@acropora\.hu/);
    assert.match(nyers, /To: nyito@partner\.hu/);
    assert.match(nyers, /Subject: \[HJ-2026-001\] Szivattyu zug/);
    const torzs = nyers.split(`${CR}${LF}${CR}${LF}`)[1] ?? "";
    assert.equal(Buffer.from(torzs, "base64").toString("utf8"), "Kedves Nóra!");
  });

  /**
   * HTML-T NEM KULDUNK, ES EZ ALLITAS IS, NEM CSAK SZANDEK. A felulet hianya
   * erosebb vedelem, mint a helyes escape-eles: nincs olyan ertek, amit el
   * lehetne felejteni megtisztitani.
   */
  it("a level SIMA SZOVEG, nem HTML", () => {
    const nyers = buildMimeMessage(LEVEL, FELADO);
    assert.match(nyers, /Content-Type: text\/plain; charset="UTF-8"/);
    assert.ok(!nyers.toLowerCase().includes("text/html"));
  });

  /**
   * A MASODIK RETEG: ITT DOBUNK, NEM TISZTITUNK.
   *
   * Az osszeallito a sajat szovegen javit; ez a reteg mar nem tudja, mi volt a
   * szandek, tehat egy csendben megtisztitott fejlec elrejtene, hogy valaki
   * rossz adatot adott at. A harom mezore HAROM kulon kod jar, mert a teendo
   * is mas.
   */
  it("sortores a CIMZETTBEN megallitja a level epiteset", () => {
    assert.throws(
      () =>
        buildMimeMessage(
          { ...LEVEL, to: `a@b.hu${CR}${LF}Bcc: x@y.hu` },
          FELADO,
        ),
      (hiba: unknown) =>
        hiba instanceof MailBuildError &&
        hiba.code === "MAIL_HEADER_INJECTION_TO",
    );
  });

  it("sortores a TARGYBAN megallitja a level epiteset", () => {
    assert.throws(
      () =>
        buildMimeMessage({ ...LEVEL, subject: `Zúg${LF}Bcc: x@y.hu` }, FELADO),
      (hiba: unknown) =>
        hiba instanceof MailBuildError &&
        hiba.code === "MAIL_HEADER_INJECTION_SUBJECT",
    );
  });

  it("sortores a FELADOBAN is megallitja", () => {
    assert.throws(
      () => buildMimeMessage(LEVEL, `ticket@acropora.hu${LF}Bcc: x@y.hu`),
      (hiba: unknown) =>
        hiba instanceof MailBuildError &&
        hiba.code === "MAIL_HEADER_INJECTION_FROM",
    );
  });

  /**
   * A LEGKOZELEBBI TEVESZTES: a TORZSBEN allo sortores TELJESEN RENDES.
   * Egy tul szeles orzo minden tobbsoros levelet elutasitana -- vagyis epp a
   * hasznalhato leveleket.
   */
  it("a TORZSBEN allo sortores nem akadaly", () => {
    const nyers = buildMimeMessage(
      { ...LEVEL, text: `Első sor${LF}${LF}Második sor` },
      FELADO,
    );
    const torzs = nyers.split(`${CR}${LF}${CR}${LF}`)[1] ?? "";
    assert.match(
      Buffer.from(torzs, "base64").toString("utf8"),
      /Első sor[\s\S]*Második sor/,
    );
  });
});

describe("base64url", () => {
  it("nem tartalmaz olyan jelet, amit az URL ujraertelmezne", () => {
    const kodolt = base64Url("a?b>c~dÿ+/=");
    assert.ok(!kodolt.includes("+"));
    assert.ok(!kodolt.includes("/"));
    assert.ok(!kodolt.includes("="));
  });
});
