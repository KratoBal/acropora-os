/**
 * A KIMENO LEVEL NYERS ALAKJA -- TISZTA FUGGVENYBEN, HOGY MERHETO LEGYEN.
 *
 * Halozat es hitelesites nelkul all ossze, tehat a biztonsagi allitasok
 * (fejlec-injekcio, kodolas) egyseg-szinten merhetok. A Gmail-adapter ennyit
 * tesz hozza: elkuldi.
 */
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
export function buildMimeMessage(
  mail: OutgoingMail,
  from: string,
  boundary: string = hatarjel(),
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
    URES CIMZETT-LISTA NEM MEHET. A `To:` fejlec ilyenkor uresen allna, es a
    level vagy elszallna a szolgaltatonal, vagy -- rosszabb -- CSENDBEN
    sehova nem menne. A hivo oldalan all ra kapu (`no-recipient`), ez a
    masodik reteg.
  */
  if (mail.to.length === 0) throw new MailBuildError("MAIL_NO_RECIPIENT");

  /*
    A TORZS BASE64-BEN MEGY. Ket okbol: az ekezetes szoveg igy nem serul a
    kozbenso szervereken, es a hosszu sorok sem torik el. A `text/plain` pedig
    nem izles: HTML-t NEM kuldunk, tehat nincs olyan ertek, amit escape-elni
    kellene -- a felulet hianya erosebb vedelem, mint a helyes escape-eles.
  */
  const fejlec = [
    `From: ${from}`,
    `To: ${mail.to.join(", ")}`,
    `Subject: ${encodeHeaderWord(mail.subject)}`,
    "MIME-Version: 1.0",
  ];
  const torzsBase64 = Buffer.from(mail.text, "utf8").toString("base64");

  /*
    CSATOLMANY NELKUL A LEVEL ALAKJA VALTOZATLAN.

    Ez nem takarekossag: a mai, mukodo ut (`WORKSHEET_SIGNED`) ezen megy, es egy
    folosleges `multipart/mixed` burok megvaltoztatna a kimenetet minden olyan
    levelnel, aminek semmi koze ehhez a valtozashoz. Allitas is all ra.
  */
  const csatolmanyok = mail.attachments ?? [];
  if (csatolmanyok.length === 0)
    return [
      ...fejlec,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      torzsBase64,
    ].join("\r\n");

  const reszek = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    torzsBase64,
  ];
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
