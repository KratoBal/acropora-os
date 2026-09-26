import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  base64Url,
  buildMimeMessage,
  encodeHeaderWord,
  formatMailFrom,
  MailBuildError,
  mailHtmlDocument,
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

/**
 * A FELADO FEJLEC NEVVEL -- Balazs kerdese, 2026-09-24 17:04 UTC: "es a
 * felado nevenel mi lesz?"
 */
describe("formatMailFrom", () => {
  it("ures nev mellett a CIM megy valtozatlanul, idezojel nelkul", () => {
    assert.equal(formatMailFrom("", "info@acropora.hu"), "info@acropora.hu");
    assert.equal(formatMailFrom("   ", "info@acropora.hu"), "info@acropora.hu");
  });

  it("ASCII nev idezojeles alakban all, a cim a szogletes zarojelben", () => {
    assert.equal(
      formatMailFrom("Acropora", "info@acropora.hu"),
      '"Acropora" <info@acropora.hu>',
    );
  });

  /**
   * A BELSO IDEZOJEL ES BACKSLASH ESCAPE-ELVE MEGY -- kulonben a nev sajat
   * idezojele zarna le a quoted-stringet, es a maradek szoveg a fejlecbe
   * szivarogna, mint egy MASODIK mezo.
   */
  it("a nev belsejeben allo idezojelet escape-eli", () => {
    assert.equal(
      formatMailFrom('Acropora "Csapat"', "info@acropora.hu"),
      '"Acropora \\"Csapat\\"" <info@acropora.hu>',
    );
  });

  /**
   * EKEZETES NEV RFC 2047 KODOLT SZOKENT MEGY, ES A CIM NEM KODOLT -- ha a
   * teljes fejlecet kodolnank, a `<...>` resz is base64-be kerulne, es a
   * fogado nem tudna addr-spec-kent ertelmezni.
   */
  it("ekezetes nevnel a NEV kodolt, a CIM soha", () => {
    const fejlec = formatMailFrom(
      "Acropora Ügyfélszolgálat",
      "info@acropora.hu",
    );
    assert.match(fejlec, /^=\?UTF-8\?B\?/);
    assert.match(fejlec, / <info@acropora\.hu>$/);
    const [, kodoltNev] = fejlec.match(/^(.*) <info@acropora\.hu>$/) ?? [];
    assert.equal(
      Buffer.from((kodoltNev ?? "").slice(10, -2), "base64").toString("utf8"),
      "Acropora Ügyfélszolgálat",
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
  it("csatolmány nélkül a levél BETŰRE ugyanaz marad", () => {
    /*
      A TELJES UZENET, KARAKTERRE. Nem `match`, nem `doesNotMatch`.

      acrobot kerese (2026-09-22 00:04), es az elso valtozatom NEM ezt csinalta:
      azt allitottam, hogy a level EGYRESZES (van `text/plain`, nincs
      `multipart`, nincs `Content-Disposition`). Az GYENGEBB, mint a neve: egy
      ATRENDEZETT fejlec-sorrend vagy egy UJ fejlec atmenne rajta.

      Ez a level az, amit a `WORKSHEET_SIGNED` ut MA kuld. Egy csendes
      valtozas rajta minden mai levelet maskepp mutatna a fogado oldalan, es
      SEMMI nem hibazna tole -- ezert all itt a teljes szoveg, nem egy minta.
    */
    assert.equal(
      buildMimeMessage(LEVEL, FELADO),
      [
        "From: ticket@acropora.hu",
        "To: nyito@partner.hu",
        "Subject: [HJ-2026-001] Szivattyu zug",
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("Kedves Nóra!", "utf8").toString("base64"),
      ].join(`${CR}${LF}`),
    );
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

/**
 * A FORMAZOTT LEVEL SZERKEZETE (2026-09-26, Balazs kerese).
 *
 * A HATARJELEK ROGZITETTEK, tehat a TELJES kimenet karakterre allithato -- ugyanaz
 * az ok, mint a fenti "BETURE ugyanaz" allitasnal: egy atrendezett resz vagy egy
 * felcserelt sorrend egy `match`-en atmenne.
 */
describe("buildMimeMessage: HTML és szöveg együtt", () => {
  const CRLF = `${CR}${LF}`;
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const HTML = "<p>Kedves <strong>Nóra</strong>!</p>";
  const FEJLEC = [
    "From: ticket@acropora.hu",
    "To: nyito@partner.hu",
    "Subject: [HJ-2026-001] Szivattyu zug",
    "MIME-Version: 1.0",
  ];
  const ALTERNATIVA = [
    "--ALT",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64("Kedves Nóra!"),
    "--ALT",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(mailHtmlDocument(HTML)),
    "--ALT--",
  ];

  /**
   * A SZOVEG ELOL, A HTML UTOLSOKENT. Az RFC 2046 szerint az utolso a
   * preferalt; forditott sorrendben a HTML-t erto levelezo is a szoveget mutatna.
   */
  it("csatolmány nélkül: multipart/alternative, szöveg elöl, HTML utoljára", () => {
    assert.equal(
      buildMimeMessage({ ...LEVEL, html: HTML }, FELADO, "KULSO", "ALT"),
      [
        ...FEJLEC,
        'Content-Type: multipart/alternative; boundary="ALT"',
        "",
        ...ALTERNATIVA,
      ].join(CRLF),
    );
  });

  it("csatolmánnyal: a két alternatíva a mixed első része, utána a csatolmány", () => {
    const bajtok = new Uint8Array([1, 2, 3]);
    assert.equal(
      buildMimeMessage(
        {
          ...LEVEL,
          html: HTML,
          attachments: [
            {
              filename: "a.pdf",
              contentType: "application/pdf",
              bytes: bajtok,
            },
          ],
        },
        FELADO,
        "KULSO",
        "ALT",
      ),
      [
        ...FEJLEC,
        'Content-Type: multipart/mixed; boundary="KULSO"',
        "",
        "--KULSO",
        'Content-Type: multipart/alternative; boundary="ALT"',
        "",
        ...ALTERNATIVA,
        "--KULSO",
        "Content-Type: application/pdf",
        "Content-Transfer-Encoding: base64",
        'Content-Disposition: attachment; filename="a.pdf"',
        "",
        Buffer.from(bajtok).toString("base64"),
        "--KULSO--",
      ].join(CRLF),
    );
  });

  /**
   * A MAI CSATOLMANYOS LEVEL (vizmeres, hibajegy-csomag) HTML NELKUL BETURE
   * UGYANAZ MARAD. A fenti keszlet ezt csak mintakkal allitotta; a HTML-ag
   * atrendezte a torzs-reszt, tehat itt a teljes szoveg all.
   */
  it("csatolmánnyal, HTML nélkül a levél BETŰRE a régi alakban marad", () => {
    const bajtok = new Uint8Array([1, 2, 3]);
    assert.equal(
      buildMimeMessage(
        {
          ...LEVEL,
          attachments: [
            {
              filename: "a.pdf",
              contentType: "application/pdf",
              bytes: bajtok,
            },
          ],
        },
        FELADO,
        "KULSO",
        "ALT",
      ),
      [
        ...FEJLEC,
        'Content-Type: multipart/mixed; boundary="KULSO"',
        "",
        "--KULSO",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
        "",
        b64("Kedves Nóra!"),
        "--KULSO",
        "Content-Type: application/pdf",
        "Content-Transfer-Encoding: base64",
        'Content-Disposition: attachment; filename="a.pdf"',
        "",
        Buffer.from(bajtok).toString("base64"),
        "--KULSO--",
      ].join(CRLF),
    );
  });

  /**
   * A MASODIK RETEG: nyers HTML-re NEM tisztit, hanem DOB. Egy csendben
   * megtisztitott torzs elrejtene, hogy egy hivo kihagyta a tisztitast.
   */
  it("tisztítatlan HTML-re nem épül levél", () => {
    for (const html of [
      "<p>a<script>alert(1)</script></p>",
      '<p onclick="x()">a</p>',
      '<a href="javascript:alert(1)">a</a>',
    ])
      assert.throws(
        () => buildMimeMessage({ ...LEVEL, html }, FELADO),
        (hiba: unknown) =>
          hiba instanceof MailBuildError &&
          hiba.code === "MAIL_HTML_UNSANITIZED",
        html,
      );
  });

  it("a keret betűtípust ad, és a töredéket változatlanul tartalmazza", () => {
    const dok = mailHtmlDocument(HTML);
    assert.ok(dok.startsWith("<!DOCTYPE html>"));
    assert.ok(dok.includes(`\n${HTML}\n`));
    assert.doesNotMatch(dok, /<style/);
  });
});
