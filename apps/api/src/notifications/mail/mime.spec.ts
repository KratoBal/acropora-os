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
  to: ["nyito@partner.hu"],
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
          { ...LEVEL, to: [`a@b.hu${CR}${LF}Bcc: x@y.hu`] },
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

/**
 * A TOBBRESZES LEVEL -- A CSATOLMANY UTJA.
 *
 * A csomag a lezart hibajegy melle kerul (Balazs specje, 2026-09-18). A
 * MIME-oldal itt dol el, halozat es hitelesites nelkul, tehat merheto.
 */
describe("buildMimeMessage: csatolmány és több címzett", () => {
  const CSOMAG = {
    filename: "hibajegy-HJ-2026-009.zip",
    contentType: "application/zip",
    bytes: new Uint8Array([80, 75, 3, 4, 0, 0]),
  };

  /**
   * A MAI UT ALAKJA NEM VALTOZIK -- ES EZ A KESZLET LEGFONTOSABB ALLITASA.
   *
   * A `WORKSHEET_SIGNED` level ma egyreszes. Egy folosleges `multipart/mixed`
   * burok MINDEN ilyen levelet megvaltoztatna, pedig azoknak semmi kozuk ehhez
   * a valtozashoz. Enelkul az allitas nelkul a regresszio NEMA lenne: a level
   * kimenne, csak maskepp nezne ki a fogado oldalan.
   */
  it("csatolmány nélkül a levél EGYRÉSZES marad", () => {
    const nyers = buildMimeMessage(LEVEL, FELADO);
    assert.match(nyers, /^Content-Type: text\/plain; charset="UTF-8"$/m);
    assert.doesNotMatch(nyers, /multipart\/mixed/);
    assert.doesNotMatch(nyers, /Content-Disposition/);
  });

  it("üres csatolmány-lista ugyanaz, mint a hiányzó", () => {
    assert.equal(
      buildMimeMessage({ ...LEVEL, attachments: [] }, FELADO),
      buildMimeMessage(LEVEL, FELADO),
    );
  });

  it("csatolmánnyal többrészes lesz, a határjellel", () => {
    const nyers = buildMimeMessage(
      { ...LEVEL, attachments: [CSOMAG] },
      FELADO,
      "HATAR",
    );
    assert.match(nyers, /Content-Type: multipart\/mixed; boundary="HATAR"/);
    assert.match(nyers, /^--HATAR$/m);
    assert.match(nyers, /^--HATAR--$/m);
    assert.match(
      nyers,
      /Content-Disposition: attachment; filename="hibajegy-HJ-2026-009.zip"/,
    );
    assert.match(nyers, /Content-Type: application\/zip/);
  });

  /**
   * A CSATOLMANY BAJTJAI BASE64-BEN MENNEK, es az allitas a KONKRET erteket
   * nezi, nem azt, hogy "van ott valami". Egy ures vagy elcsuszott kodolas
   * ugyanugy base64-nek latszana.
   */
  it("a csatolmány bájtjai base64-ben mennek át", () => {
    const nyers = buildMimeMessage(
      { ...LEVEL, attachments: [CSOMAG] },
      FELADO,
      "HATAR",
    );
    assert.match(
      nyers,
      new RegExp(Buffer.from(CSOMAG.bytes).toString("base64")),
    );
  });

  it("több címzett vesszővel elválasztva áll a fejlécben", () => {
    const nyers = buildMimeMessage(
      { ...LEVEL, to: ["egy@partner.hu", "ketto@partner.hu"] },
      FELADO,
    );
    assert.match(nyers, /^To: egy@partner\.hu, ketto@partner\.hu$/m);
  });

  /**
   * SORTORES BARMELYIK CIMZETTBEN MEGALLIT -- ES EZ AZ ALLITAS NEVE PONTOS,
   * A KORABBI INDOKLASA VISZONT NEM VOLT AZ.
   *
   * Eloszor azt irtam ide, hogy ez az allitas azt meri, hogy az ellenorzes
   * CIMZETTENKENT fut. A kalibracio megcafolta: az egyenkenti ellenorzest
   * osszefuzottre cserelve ez az allitas ZOLD MARADT -- mert a `", "` mente
   * osszefuzott szovegben a sortores megmarad, tehat ugyanugy elkapjuk.
   *
   * AMIT TEHAT VALOBAN MER: hogy egy rossz cim a MASODIK helyen is megallitja
   * a levelet. Ez ertekes (a lista tobb elemu is lehet), de NEM az ellenorzes
   * SZERKEZETEROL szol. A tomb valodi haszna a darabszam es az elvalaszto --
   * azokra kulon allitas all.
   */
  it("sortörés BÁRMELYIK címzettben megállítja a levelet", () => {
    assert.throws(
      () =>
        buildMimeMessage(
          {
            ...LEVEL,
            to: ["jo@partner.hu", `rossz@partner.hu${LF}Bcc: x@y.hu`],
          },
          FELADO,
        ),
      (hiba: unknown) =>
        hiba instanceof MailBuildError &&
        hiba.code === "MAIL_HEADER_INJECTION_TO",
    );
  });

  /**
   * A FAJLNEV IS FEJLECBE KERUL. Ma a jegyszambol keletkezik, tehat ma
   * artalmatlan -- de a `Content-Disposition` ugyanolyan fejlec, mint a `To:`,
   * es egy sortores benne ugyanugy uj fejlecet nyitna.
   */
  it("sortörés a FÁJLNÉVBEN megállítja a levelet", () => {
    assert.throws(
      () =>
        buildMimeMessage(
          {
            ...LEVEL,
            attachments: [{ ...CSOMAG, filename: `a.zip${LF}Bcc: x@y.hu` }],
          },
          FELADO,
        ),
      (hiba: unknown) =>
        hiba instanceof MailBuildError &&
        hiba.code === "MAIL_HEADER_INJECTION_ATTACHMENT",
    );
  });

  /**
   * URES CIMZETT-LISTA A MASODIK RETEG.
   *
   * Az elso a hivo oldalan all (`no-recipient` kapu). Ez akkor is all, ha
   * valaki egy MASIK hivot ir melle -- ugyanaz a ketretegu gondolat, mint a
   * fejlec-injekcional.
   */
  it("üres címzett-listára nem épül levél", () => {
    assert.throws(
      () => buildMimeMessage({ ...LEVEL, to: [] }, FELADO),
      (hiba: unknown) =>
        hiba instanceof MailBuildError && hiba.code === "MAIL_NO_RECIPIENT",
    );
  });
});
