/**
 * A KIMENO LEVEL NYERS ALAKJA -- TISZTA FUGGVENYBEN, HOGY MERHETO LEGYEN.
 *
 * Halozat es hitelesites nelkul all ossze, tehat a biztonsagi allitasok
 * (fejlec-injekcio, kodolas) egyseg-szinten merhetok. A Gmail-adapter ennyit
 * tesz hozza: elkuldi.
 */
import { sanitizeRichHtml } from "@acropora/rich-text";

import { hasHeaderInjection } from "./mail-header.js";
import type { OutgoingMail } from "./mail.port.js";

export class MailBuildError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MailBuildError";
  }
}

/**
 * AZ EKEZETES TARGY NEM MEHET NYERSEN A FEJLECBE.
 *
 * A level fejlecei tortenetileg ASCII-ak; egy nyers UTF-8 "Szivattyú zúg"
 * targy a fogado oldalan olvashatatlan lehet. Az RFC 2047 kodolt szo
 * (`=?UTF-8?B?...?=`) az a forma, amit minden levelezo ismer.
 *
 * A TISZTA ASCII TARGYAT NEM KODOLJUK: ott a kodolas csak olvashatatlanna
 * tenne a nyers levelet, es semmit nem oldana meg.
 */
export function encodeHeaderWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * A FELADÓ FEJLÉC NÉVVEL -- "display-name <addr-spec>" ALAK, RFC 5322.
 *
 * Balázs kérdése, 2026-09-24 17:04 UTC: "és a feladó nevénél mi lesz?" -- a
 * `From:` fejléc ma PUSZTA cím, név nélkül (`config.user` egyenesen a
 * `buildMimeMessage`-nek megy). Ez a függvény a NÉV+CÍM párt egy kész fejléc-
 * értékké teszi.
 *
 * A KÓDOLÁS CSAK A NÉVRE VONATKOZIK, A CÍMRE SOHA: az RFC 2047 kódolt szó a
 * `<...>` zárójelen KÍVÜL áll. Ha a teljes fejlécet kódolnánk, a cím is
 * base64-be kerülne, és a fogadó nem tudná `addr-spec`-ként értelmezni.
 *
 * ASCII NÉVNÉL IDÉZŐJELES ALAK (RFC 5322 quoted-string, a `"` és a `\`
 * escape-elve) -- nem az `encodeHeaderWord` sima passthrough-ja, mert a
 * display-name-ben szóköz, vessző is állhat, és azok phrase-ként külön
 * atom-ra törnék a nevet. NEM-ASCII névnél az `encodeHeaderWord` kódolt szava
 * megy, idézőjel NÉLKÜL: az RFC 2047 encoded-word már önmagában behatárolt.
 */
export function formatMailFrom(name: string, address: string): string {
  const nev = name.trim();
  if (!nev) return address;
  // eslint-disable-next-line no-control-regex
  const cimke = /^[\x20-\x7E]*$/.test(nev)
    ? `"${nev.replace(/(["\\])/g, "\\$1")}"`
    : encodeHeaderWord(nev);
  return `${cimke} <${address}>`;
}

/**
 * A MASODIK RETEG A FEJLEC-INJEKCIO ELLEN.
 *
 * Az elso reteg a `TicketMailService`-ben all: ott valik a renderelt targy
 * fejlec-ertekke, es ott megy at a `headerSafe`-en. EZ a reteg akkor is all,
 * ha valaki egy MASIK hivot ir melle es elfelejti -- es acrobot kikotese
 * szerint a ket reteget KULON allitas meri, mert kulon is elromolhat.
 *
 * ITT NEM TISZTITUNK, HANEM DOBUNK. A kulonbseg szandekos: a szolgaltatas a
 * SAJAT kimenetén javit, ez a reteg viszont MAR NEM TUDJA, mi volt a szandek --
 * egy csendben megtisztitott fejlec itt elrejtene, hogy valaki rossz adatot
 * adott at.
 */
/**
 * A TOBBRESZES LEVEL HATARJELE.
 *
 * VELETLEN, ES EZ NEM DISZ: a hatarjelnek olyan szonak kell lennie, ami a
 * tartalomban NEM fordul elo. A csatolmany base64-ben megy, tehat csak
 * `A-Za-z0-9+/=` karaktereket tartalmaz -- egy `----=_` kezdetu jel oda
 * szerkezetileg nem illeszkedhet. A veletlen resz a TORZS ellen ved, amit
 * ember ir.
 */
function hatarjel(): string {
  return `----=_Acropora_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * A FAJLNEV IS FEJLECBE KERUL, TEHAT UGYANUGY ELLENORZENDO.
 *
 * A csomag neve ma a jegyszambol keletkezik, tehat ma artalmatlan. De a
 * `Content-Disposition` fejlec ugyanolyan fejlec, mint a `To:` -- egy sortores
 * benne ugyanugy uj fejlecet nyitna. Ez a reteg NEM tisztit, hanem DOB,
 * ugyanabbol az okbol, ami a fajl tetejen all.
 */
/**
 * A FORMAZOTT TORZS KERETE. A torzs TOREDEK (`OutgoingMail.html`), a
 * dokumentumot itt kapja meg.
 *
 * INLINE STILUS, `<style>` BLOKK NELKUL: tobb levelezo a `<head>` stilusait
 * eldobja, az inline `style` attributumot megtartja. A keret csak betutipust
 * es sorkozt ad; minden mas a tartalome.
 */
export function mailHtmlDocument(fragment: string): string {
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"></head>',
    '<body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;">',
    fragment,
    "</body></html>",
  ].join("\n");
}

export function buildMimeMessage(
  mail: OutgoingMail,
  from: string,
  boundary: string = hatarjel(),
  alternativeBoundary: string = hatarjel(),
): string {
  for (const cim of mail.to)
    if (hasHeaderInjection(cim))
      throw new MailBuildError("MAIL_HEADER_INJECTION_TO");
  for (const [nev, ertek] of [
    ["subject", mail.subject],
    ["from", from],
  ] as const)
    if (hasHeaderInjection(ertek))
      throw new MailBuildError(`MAIL_HEADER_INJECTION_${nev.toUpperCase()}`);
  for (const csatolmany of mail.attachments ?? [])
    if (
      hasHeaderInjection(csatolmany.filename) ||
      hasHeaderInjection(csatolmany.contentType)
    )
      throw new MailBuildError("MAIL_HEADER_INJECTION_ATTACHMENT");

  /*
    URES CIMZETT-LISTA NEM MEHET -- ES EZ A MASODIK RETEG. MEGMONDOM, HOL AZ
    ELSO, ES MI TORTENIK, HA CSAK AZ EGYIK MARAD (acrobot kerese, 2026-09-22).

    ELSO RETEG:  `handoverMailDecision` (`handover-mail-recipients.ts`), a
                 `no-recipient` ag. ELOSZOR EZ SZOLAL MEG: a dontes a kuldes
                 elott fut, tehat idaig el sem jutunk.

    HA CSAK AZ ELSO MARAD:  ezen az uton semmi nem romlik el -- de egy MASIK
                 hivo (a munkalap-eljuttatas, a szamla-kuldes) ures listaval
                 hivhatna az epitot, es akkor a `To:` fejlec URESEN allna. A
                 level vagy elszall a szolgaltatonal, vagy -- rosszabb --
                 csendben sehova nem megy.

    HA CSAK A MASODIK MARAD:  a level NEM megy ki hibasan, de az ARA MAS. A
                 szolgaltatas eljutna az epitesig, itt DOBNA, es a nyom
                 `FAILED` lenne egy tiszta `no-recipient` kihagyas helyett. A
                 kezelo egy technikai hibat latna a helyett, hogy "ennek a
                 vevonek nincs aktiv portal-fiokja".

    A KETTO TEHAT NEM UGYANAZ KETSZER: az elso a HELYES OKOT adja, a masodik
    azt zarja ki, hogy egy jovobeli hivo megkerulje.
  */
  if (mail.to.length === 0) throw new MailBuildError("MAIL_NO_RECIPIENT");

  /*
    A HTML TORZS TISZTITOTT KELL LEGYEN -- ES ITT NEM TISZTITUNK, HANEM DOBUNK.

    Ugyanaz a ket-reteg, mint a fejleceknel: az ELSO reteg a kuldesi ut
    (`renderMailBody`), ami a behelyettesites UTAN tisztit. Ez a reteg akkor
    all, ha egy MASIK hivo nyers HTML-t ad at. Egy itt csendben megtisztitott
    torzs elrejtene, hogy valaki kihagyta a tisztitast.

    A MERES: a tisztito a sajat kimenetén nem valtoztat (allitas all ra a
    `@acropora/rich-text` csomagban), tehat ami tiszta, az atmegy valtozatlanul.
  */
  if (mail.html !== undefined && sanitizeRichHtml(mail.html) !== mail.html)
    throw new MailBuildError("MAIL_HTML_UNSANITIZED");

  /*
    A TORZS BASE64-BEN MEGY. Ket okbol: az ekezetes szoveg igy nem serul a
    kozbenso szervereken, es a hosszu sorok sem torik el.

    2026-09-26-IG ITT AZ ALLT, HOGY "HTML-t NEM kuldunk ... a felulet hianya
    erosebb vedelem, mint a helyes escape-eles". Balazs formazott levelet kert,
    tehat a felulet mostantol letezik, ha a hivo `html`-t ad. A vedelem helye:
    az ertekek escape-elese (`renderMailTemplateHtml`), a tisztitas a
    behelyettesites utan (`renderMailBody`), es a fenti dobas. `html` NELKUL a
    level tovabbra is kizarolag `text/plain`, bajtra a regi alakban.
  */
  const fejlec = [
    `From: ${from}`,
    `To: ${mail.to.join(", ")}`,
    `Subject: ${encodeHeaderWord(mail.subject)}`,
    "MIME-Version: 1.0",
  ];
  const torzsBase64 = Buffer.from(mail.text, "utf8").toString("base64");

  /*
    A SZOVEGES RESZ, VAGY -- HA VAN HTML -- A KET ALTERNATIVA EGYUTT.

    A `text/plain` ELOL, a `text/html` UTOLSOKENT: az RFC 2046 szerint az
    utolso alternativa a preferalt, tehat a HTML-t ertő levelezo azt mutatja,
    a tobbi a szoveget. A belso hatarjel KULON veletlen ertek: egy kozos
    elotagu jel nehany elemzonel a kulso resz vegenek latszana.
  */
  const szovegResz = [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    torzsBase64,
  ];
  const torzsResz =
    mail.html === undefined
      ? szovegResz
      : [
          `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
          "",
          `--${alternativeBoundary}`,
          ...szovegResz,
          `--${alternativeBoundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          Buffer.from(mailHtmlDocument(mail.html), "utf8").toString("base64"),
          `--${alternativeBoundary}--`,
        ];

  /*
    CSATOLMANY NELKUL A LEVEL ALAKJA VALTOZATLAN.

    Ez nem takarekossag: a mai, mukodo ut (`WORKSHEET_SIGNED`) ezen megy, es egy
    folosleges `multipart/mixed` burok megvaltoztatna a kimenetet minden olyan
    levelnel, aminek semmi koze ehhez a valtozashoz. Allitas is all ra.
  */
  const csatolmanyok = mail.attachments ?? [];
  if (csatolmanyok.length === 0) return [...fejlec, ...torzsResz].join("\r\n");

  const reszek = [`--${boundary}`, ...torzsResz];
  for (const csatolmany of csatolmanyok) {
    reszek.push(
      `--${boundary}`,
      `Content-Type: ${csatolmany.contentType}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${csatolmany.filename}"`,
      "",
      Buffer.from(csatolmany.bytes).toString("base64"),
    );
  }
  reszek.push(`--${boundary}--`);

  return [
    ...fejlec,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...reszek,
  ].join("\r\n");
}

/** A Gmail API base64url alakban keri a nyers levelet. */
export function base64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
