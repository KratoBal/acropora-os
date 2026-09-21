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
export function buildMimeMessage(mail: OutgoingMail, from: string): string {
  for (const [nev, ertek] of [
    ["to", mail.to],
    ["subject", mail.subject],
    ["from", from],
  ] as const)
    if (hasHeaderInjection(ertek))
      throw new MailBuildError(`MAIL_HEADER_INJECTION_${nev.toUpperCase()}`);

  /*
    A TORZS BASE64-BEN MEGY. Ket okbol: az ekezetes szoveg igy nem serul a
    kozbenso szervereken, es a hosszu sorok sem torik el. A `text/plain` pedig
    nem izles: HTML-t NEM kuldunk, tehat nincs olyan ertek, amit escape-elni
    kellene -- a felulet hianya erosebb vedelem, mint a helyes escape-eles.
  */
  return [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeaderWord(mail.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(mail.text, "utf8").toString("base64"),
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
